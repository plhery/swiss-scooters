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
import { MAX_SCOOTER_RESULTS } from '@/lib/scooterQuery';

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

  it('accepts oversized bounds and clamps feed work to Switzerland', async () => {
    mocks.fetchScooters.mockResolvedValue({
      vehicles: [],
      meta: {
        partial: false,
        stale: false,
        failedSources: [],
        sources: { national: 'fresh', hopp: 'skipped' },
      },
    });

    const response = await GET(request('?south=-90&north=90&west=-180&east=180'));

    expect(response.status).toBe(200);
    expect(mocks.fetchScooters).toHaveBeenCalledWith(expect.objectContaining({
      bounds: {
        south: 45.7,
        west: 5.7,
        north: 47.95,
        east: 10.75,
      },
      outsideCoverage: false,
    }));
  });

  it('returns 503 with source metadata when all feeds fail', async () => {
    mocks.fetchScooters.mockRejectedValue(
      new ScooterFeedsUnavailableError(['national'])
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get('x-mobility-data-status')).toBe('unavailable');
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      meta: { failedSources: ['national'] },
    });
  });

  it('caps large responses and marks partial results as degraded', async () => {
    mocks.fetchScooters.mockResolvedValue({
      vehicles: Array.from({ length: MAX_SCOOTER_RESULTS + 1 }, (_, index) => vehicle(index)),
      meta: {
        partial: true,
        stale: false,
        failedSources: ['national:lime_zurich'],
        sources: { national: 'partial', hopp: 'fresh' },
      },
    });

    const response = await GET(request());
    const body = (await response.json()) as {
      vehicles: unknown[];
      clusters: unknown[];
      meta: {
        truncated: boolean;
        totalVehicles: number;
        mode: string;
        zoom: number | null;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('x-mobility-data-status')).toBe('partial');
    expect(response.headers.get('cache-control')).toContain('max-age=10');
    expect(body.vehicles).toHaveLength(MAX_SCOOTER_RESULTS);
    expect(body.clusters).toEqual([]);
    expect(body.meta).toMatchObject({
      truncated: true,
      totalVehicles: MAX_SCOOTER_RESULTS + 1,
      mode: 'vehicles',
      zoom: null,
    });
  });

  it('returns server-created clusters for low-zoom requests', async () => {
    mocks.fetchScooters.mockResolvedValue({
      vehicles: [
        vehicle(1),
        { ...vehicle(2), provider: 'voi', lat: 47.37691, lng: 8.54171 },
        { ...vehicle(3), lat: 47.37692, lng: 8.54172 },
      ],
      meta: {
        partial: false,
        stale: false,
        failedSources: [],
        sources: { national: 'fresh', hopp: 'fresh' },
      },
    });

    const response = await GET(request('?zoom=15'));
    const body = (await response.json()) as {
      vehicles: unknown[];
      clusters: Array<{ count: number; providers: Record<string, number> }>;
      providers: Record<string, number>;
      meta: { mode: string; zoom: number | null; totalVehicles: number };
    };

    expect(response.status).toBe(200);
    expect(body.vehicles).toEqual([]);
    expect(body.clusters).toEqual([
      expect.objectContaining({ count: 3, providers: { lime: 2, voi: 1 } }),
    ]);
    expect(body.providers).toEqual({ lime: 2, voi: 1 });
    expect(body.meta).toMatchObject({
      mode: 'clusters',
      zoom: 15,
      totalVehicles: 3,
    });
  });
});
