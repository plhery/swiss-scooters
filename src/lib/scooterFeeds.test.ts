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
  if (url === 'https://sharedmobility.ch/v2/gbfs') {
    return jsonResponse({
      systems: [{
        id: 'lime_zurich',
        url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/gbfs',
      }],
    });
  }
  if (url === 'https://sharedmobility.ch/v2/gbfs/lime_zurich/free_bike_status') {
    return jsonResponse({
      data: {
        bikes: [{
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
  if (url === 'https://sharedmobility.ch/v2/gbfs/lime_zurich/vehicle_types') {
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

  it('loads supported systems from the authenticated national registry', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: 'zurich-scooter@plhery.com',
      });
      const url = String(input);
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not load type metadata for systems outside the requested bounds', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'lime_basel',
            url: 'https://sharedmobility.ch/v2/gbfs/lime_basel/gbfs',
          }],
        });
      }
      if (url.endsWith('/lime_basel/free_bike_status')) {
        return jsonResponse({
          data: {
            bikes: [{
              vehicle_type_id: 'lime-scooter',
              bike_id: 'basel-1',
              lat: 47.56,
              lon: 7.59,
              is_reserved: false,
              is_disabled: false,
            }],
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('vehicle_types'))).toBe(false);
  });
});
