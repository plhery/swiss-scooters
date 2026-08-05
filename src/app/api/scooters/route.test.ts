import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Vehicle } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  fetchScooters: vi.fn(),
  rateLimitAllows: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitAllows: mocks.rateLimitAllows,
}));

vi.mock('@/lib/scooterFeeds', () => {
  class ScooterFeedsUnavailableError extends Error {
    readonly failedSources: string[];

    constructor(failedSources: string[]) {
      super('Every configured scooter feed failed');
      this.name = 'ScooterFeedsUnavailableError';
      this.failedSources = failedSources;
    }
  }

  return {
    fetchScooters: mocks.fetchScooters,
    ScooterFeedsUnavailableError,
  };
});

import { GET } from '@/app/api/scooters/route';
import { ScooterFeedsUnavailableError } from '@/lib/scooterFeeds';

function request(query = ''): NextRequest {
  return new NextRequest(`https://example.com/api/scooters${query}`);
}

function vehicle(index: number): Vehicle {
  return {
    provider: 'lime',
    lat: 47.3769,
    lng: 8.5417,
    battery: 80,
    range_m: 10_000,
    vehicle_id: `lime:${index}`,
    deep_link: null,
    distance_m: index,
  };
}

beforeEach(() => {
  mocks.rateLimitAllows.mockResolvedValue(true);
  mocks.fetchScooters.mockReset();
});

describe('GET /api/scooters', () => {
  it('returns 429 before doing feed work when the client is rate limited', async () => {
    mocks.rateLimitAllows.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.fetchScooters).not.toHaveBeenCalled();
  });

  it('rejects oversized map bounds', async () => {
    const response = await GET(request('?south=40&north=50&west=0&east=10'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Map area is too large. Zoom in to load scooters.',
    });
    expect(mocks.fetchScooters).not.toHaveBeenCalled();
  });

  it('returns 503 with source metadata when all feeds fail', async () => {
    mocks.fetchScooters.mockRejectedValue(
      new ScooterFeedsUnavailableError(['national', 'hopp'])
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get('x-mobility-data-status')).toBe('unavailable');
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      meta: { failedSources: ['national', 'hopp'] },
    });
  });

  it('caps large responses and marks partial results as degraded', async () => {
    mocks.fetchScooters.mockResolvedValue({
      vehicles: Array.from({ length: 5_001 }, (_, index) => vehicle(index)),
      meta: {
        partial: true,
        stale: false,
        failedSources: ['hopp'],
        sources: { national: 'fresh', hopp: 'failed' },
      },
    });

    const response = await GET(request());
    const body = (await response.json()) as {
      vehicles: unknown[];
      meta: { truncated: boolean; totalVehicles: number };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('x-mobility-data-status')).toBe('partial');
    expect(response.headers.get('cache-control')).toContain('max-age=10');
    expect(body.vehicles).toHaveLength(5_000);
    expect(body.meta).toMatchObject({ truncated: true, totalVehicles: 5_001 });
  });
});
