import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchScooters,
  ScooterFeedsUnavailableError,
  type FeedQuery,
} from '@/lib/scooterFeeds';
import { upstreamJsonCache } from '@/lib/upstreamJsonCache';

const query: FeedQuery = {
  lat: 47.3769,
  lng: 8.5417,
  bounds: { south: 47.36, west: 8.52, north: 47.39, east: 8.57 },
  minBattery: 0,
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nationalResponse(url: string): Response | null {
  if (url === 'https://sharedmobility.ch/free_bike_status.json') {
    return jsonResponse({
      data: {
        bikes: [{
          provider_id: 'lime_zurich',
          vehicle_type_id: 'lime-scooter',
          bike_id: 'lime-1',
          lat: 47.377,
          lon: 8.542,
          current_fuel_percent: 0.75,
          current_range_meters: 12_000,
          is_reserved: false,
          is_disabled: false,
        }],
      },
    });
  }
  if (url === 'https://sharedmobility.ch/vehicle_types.json') {
    return jsonResponse({
      data: {
        vehicle_types: [{
          vehicle_type_id: 'lime-scooter',
          form_factor: 'scooter_standing',
          propulsion_type: 'electric',
        }],
      },
    });
  }
  if (url === 'https://sharedmobility.ch/v2/gbfs') {
    return jsonResponse({ systems: [] });
  }
  return null;
}

beforeEach(() => {
  upstreamJsonCache.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  upstreamJsonCache.clear();
  vi.unstubAllGlobals();
});

describe('fetchScooters source health', () => {
  it('returns available national data and marks a Hopp outage as partial', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const response = nationalResponse(String(input));
      if (response) return response;
      throw new Error('Hopp unavailable');
    }));

    const result = await fetchScooters(query);

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({
      provider: 'lime',
      battery: 75,
      range_m: 12_000,
    });
    expect(result.meta).toEqual({
      partial: true,
      stale: false,
      failedSources: ['hopp'],
      sources: { national: 'fresh', hopp: 'failed' },
    });
  });

  it('throws a typed unavailable error when every attempted source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('all feeds unavailable');
    }));

    await expect(fetchScooters(query)).rejects.toMatchObject({
      name: 'ScooterFeedsUnavailableError',
      failedSources: ['national', 'hopp'],
    } satisfies Partial<ScooterFeedsUnavailableError>);
  });

  it('skips Hopp entirely when another provider is explicitly requested', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const response = nationalResponse(String(input));
      if (response) return response;
      throw new Error(`Unexpected URL: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.meta.sources.hopp).toBe('skipped');
    expect(result.meta.partial).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('hopp.bike'))).toBe(false);
  });
});
