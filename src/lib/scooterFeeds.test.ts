import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchScooters,
  ScooterFeedsUnavailableError,
  type FeedQuery,
} from '@/lib/scooterFeeds';
import { upstreamJsonCache } from '@/lib/upstreamJsonCache';

const query: FeedQuery = {
  origin: [47.3769, 8.5417],
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
  if (url === 'https://sharedmobility.ch/v2/gbfs/lime_zurich/gbfs') {
    return jsonResponse({
      data: {
        en: {
          feeds: [
            {
              name: 'free_bike_status',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/free_bike_status',
            },
            {
              name: 'vehicle_types',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/vehicle_types',
            },
          ],
        },
      },
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

function hoppResponse(url: string): Response | null {
  if (url === 'https://api.hopp.bike/gbfs/ch-zurich/gbfs.json') {
    return jsonResponse({
      data: {
        feeds: [
          {
            name: 'free_bike_status',
            url: 'https://api.hopp.bike/gbfs/ch-zurich/en/free_bike_status.json',
          },
          {
            name: 'vehicle_types',
            url: 'https://api.hopp.bike/gbfs/ch-zurich/en/vehicle_types.json',
          },
        ],
      },
    });
  }
  if (url === 'https://api.hopp.bike/gbfs/ch-zurich/en/free_bike_status.json') {
    return jsonResponse({
      data: {
        bikes: [{
          vehicle_type_id: 'hopp-scooter',
          bike_id: 'hopp-1',
          lat: 47.3771,
          lon: 8.5421,
          hopp_battery_level: 68,
          hopp_deeplink: 'https://app.hopp.bike/launch/hopp-1?direct',
          is_reserved: false,
          is_disabled: false,
        }],
      },
    });
  }
  if (url === 'https://api.hopp.bike/gbfs/ch-zurich/en/vehicle_types.json') {
    return jsonResponse({
      data: {
        vehicle_types: [{
          vehicle_type_id: 'hopp-scooter',
          form_factor: 'scooter',
          propulsion_type: 'electric',
        }],
      },
    });
  }
  return null;
}

function publibikeResponse(url: string): Response | null {
  if (url !== 'https://velospot.info/customer/public/api/pbvsng/freeFloating') {
    return null;
  }

  return jsonResponse([
    {
      id: 'publibike-zurich-1',
      latitude: 47.3772,
      longitude: 8.5422,
      type: 5,
    },
  ]);
}

beforeEach(() => {
  upstreamJsonCache.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  upstreamJsonCache.clear();
  vi.unstubAllGlobals();
});

describe('fetchScooters source health', () => {
  it('does no upstream work for a viewport outside Switzerland', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({
      ...query,
      bounds: { south: 48.80, west: 2.25, north: 48.92, east: 2.45 },
      outsideCoverage: true,
    });

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources).toEqual({
      national: 'skipped',
      hopp: 'skipped',
      publibike: 'skipped',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns all available source data as fresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const response = nationalResponse(String(input)) ??
        hoppResponse(String(input)) ??
        publibikeResponse(String(input));
      if (response) return response;
      throw new Error(`Unexpected URL: ${String(input)}`);
    }));

    const result = await fetchScooters(query);

    expect(result.vehicles).toHaveLength(3);
    expect(result.vehicles).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'lime', battery: 75, range_m: 12_000 }),
      expect.objectContaining({
        provider: 'hopp',
        battery: 68,
        deep_link: 'https://app.hopp.bike/launch/hopp-1?direct',
      }),
      expect.objectContaining({
        provider: 'publibike',
        battery: null,
        vehicle_id: 'publibike-freefloating:publibike-zurich-1',
      }),
    ]));
    expect(result.meta).toEqual({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { national: 'fresh', hopp: 'fresh', publibike: 'fresh' },
    });
  });

  it('loads only valid Zürich scooters from the PubliBike app feed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'velospot',
            url: 'https://sharedmobility.ch/v2/gbfs/velospot/gbfs',
          }],
        });
      }
      if (url === 'https://velospot.info/customer/public/api/pbvsng/freeFloating') {
        expect(init?.headers).not.toHaveProperty('Authorization');
        return jsonResponse([
          { id: 'zurich-1', latitude: 47.3772, longitude: 8.5422, type: 5 },
          { id: 'bike-1', latitude: 47.3773, longitude: 8.5423, type: 2 },
          { id: 'other-view', latitude: 47.45, longitude: 8.65, type: 5 },
          { id: 'biel-1', latitude: 47.1441, longitude: 7.267379, type: 5 },
          { latitude: 47.3774, longitude: 8.5424, type: 5 },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['publibike']) });

    expect(result.vehicles).toEqual([{
      provider: 'publibike',
      lat: 47.3772,
      lng: 8.5422,
      battery: null,
      range_m: null,
      vehicle_id: 'publibike-freefloating:zurich-1',
      deep_link: null,
      distance_m: expect.any(Number),
    }]);
    expect(result.meta).toEqual({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { national: 'skipped', hopp: 'skipped', publibike: 'fresh' },
    });
  });

  it('loads only Hopp when it is explicitly requested', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const response = hoppResponse(String(input));
      if (response) return response;
      throw new Error(`Unexpected URL: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['hopp']) });

    expect(result.vehicles).toEqual([
      expect.objectContaining({ provider: 'hopp', battery: 68 }),
    ]);
    expect(result.meta.sources).toEqual({
      national: 'skipped',
      hopp: 'fresh',
      publibike: 'skipped',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('sharedmobility.ch'))).toBe(false);
  });

  it('marks a Hopp outage as partial when national data is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const response = nationalResponse(url) ?? publibikeResponse(url);
      if (response) return response;
      if (url.includes('hopp.bike')) throw new Error('Hopp unavailable');
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const result = await fetchScooters(query);

    expect(result.vehicles).toHaveLength(2);
    expect(result.meta).toMatchObject({
      partial: true,
      failedSources: ['hopp'],
      sources: { national: 'fresh', hopp: 'failed', publibike: 'fresh' },
    });
  });

  it('omits server-calculated distance when no legacy origin is supplied', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const response = nationalResponse(String(input));
      if (response) return response;
      throw new Error(`Unexpected URL: ${String(input)}`);
    }));

    const result = await fetchScooters({
      ...query,
      origin: null,
      providers: new Set(['lime']),
    });

    expect(result.vehicles[0].distance_m).toBeNull();
  });

  it('reports individual system failures as partial without calling fresh data stale', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [
            {
              id: 'lime_zurich',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/gbfs',
            },
            {
              id: 'dott_zurich',
              url: 'https://sharedmobility.ch/v2/gbfs/dott_zurich/gbfs',
            },
          ],
        });
      }
      if (url.includes('/dott_zurich/')) throw new Error('Dott unavailable');
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const result = await fetchScooters({
      ...query,
      providers: new Set(['lime', 'dott']),
    });

    expect(result.vehicles).toHaveLength(1);
    expect(result.meta).toEqual({
      partial: true,
      stale: false,
      failedSources: ['national:dott_zurich'],
      sources: { national: 'partial', hopp: 'skipped', publibike: 'skipped' },
    });
  });

  it('throws a typed unavailable error when every attempted source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('all feeds unavailable');
    }));

    await expect(fetchScooters(query)).rejects.toMatchObject({
      name: 'ScooterFeedsUnavailableError',
      failedSources: ['national', 'hopp', 'publibike'],
    } satisfies Partial<ScooterFeedsUnavailableError>);
  });

  it('loads only the national source when a provider is explicitly requested', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const response = nationalResponse(String(input));
      if (response) return response;
      throw new Error(`Unexpected URL: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.meta.sources.national).toBe('fresh');
    expect(result.meta.sources.hopp).toBe('skipped');
    expect(result.meta.partial).toBe(false);
  });

  it('skips Hopp before discovery when the viewport is outside Zurich', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({
      ...query,
      origin: [46.948, 7.447],
      bounds: { south: 46.92, west: 7.40, north: 46.98, east: 7.49 },
      providers: new Set(['hopp']),
    });

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources).toEqual({
      national: 'skipped',
      hopp: 'skipped',
      publibike: 'skipped',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads supported systems from the authenticated national registry', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: 'swiss-scooters@plhery.com',
      });
      const url = String(input);
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not load any system feeds outside the requested bounds', async () => {
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
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources.national).toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads only systems whose city coverage intersects the viewport', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [
            {
              id: 'lime_zurich',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/gbfs',
            },
            {
              id: 'lime_basel',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_basel/gbfs',
            },
          ],
        });
      }
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/lime_basel/'))).toBe(false);
  });

  it('skips systems whose discovery document has no individual vehicle feed', async () => {
    const zugQuery: FeedQuery = {
      ...query,
      origin: [47.166, 8.516],
      bounds: { south: 47.14, west: 8.48, north: 47.19, east: 8.55 },
      providers: new Set(['lime']),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'lime_zug',
            url: 'https://sharedmobility.ch/v2/gbfs/lime_zug/gbfs',
          }],
        });
      }
      if (url.endsWith('/lime_zug/gbfs')) {
        return jsonResponse({
          data: {
            en: {
              feeds: [{
                name: 'vehicle_types',
                url: 'https://sharedmobility.ch/v2/gbfs/lime_zug/vehicle_types',
              }],
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters(zugQuery);

    expect(result.vehicles).toEqual([]);
    expect(result.meta.partial).toBe(false);
    expect(result.meta.sources.national).toBe('skipped');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses declared Voi regions to skip its national vehicle feed', async () => {
    const bernQuery: FeedQuery = {
      ...query,
      origin: [46.95, 7.45],
      bounds: { south: 46.93, west: 7.42, north: 46.97, east: 7.48 },
      providers: new Set(['voi']),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'voiscooters.com',
            url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/gbfs',
          }],
        });
      }
      if (url.endsWith('/voiscooters.com/gbfs')) {
        return jsonResponse({
          data: {
            en: {
              feeds: [
                { name: 'free_bike_status', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/free_bike_status' },
                { name: 'vehicle_types', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/vehicle_types' },
                { name: 'system_regions', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/system_regions' },
              ],
            },
          },
        });
      }
      if (url.endsWith('/voiscooters.com/vehicle_types')) {
        return jsonResponse({
          data: {
            vehicle_types: [{
              vehicle_type_id: 'voi-scooter',
              form_factor: 'scooter',
              propulsion_type: 'electric',
            }],
          },
        });
      }
      if (url.endsWith('/voiscooters.com/system_regions')) {
        return jsonResponse({ data: { regions: [{ region_id: '222', name: 'Bern' }] } });
      }
      if (url.endsWith('/voiscooters.com/free_bike_status')) {
        return jsonResponse({
          data: {
            bikes: [{
              vehicle_type_id: 'voi-scooter',
              bike_id: 'voi-bern-1',
              lat: 46.951,
              lon: 7.451,
              is_reserved: false,
              is_disabled: false,
            }],
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters(bernQuery);

    expect(result.vehicles).toHaveLength(1);
    expect(result.meta.sources.national).toBe('fresh');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/system_regions'))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/free_bike_status'))).toBe(true);
  });

  it('skips a national multi-region system when its declared regions do not intersect', async () => {
    const genevaQuery: FeedQuery = {
      ...query,
      origin: [46.204, 6.143],
      bounds: { south: 46.18, west: 6.10, north: 46.23, east: 6.19 },
      providers: new Set(['voi']),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'voiscooters.com',
            url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/gbfs',
          }],
        });
      }
      if (url.endsWith('/voiscooters.com/gbfs')) {
        return jsonResponse({
          data: {
            en: {
              feeds: [
                { name: 'free_bike_status', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/free_bike_status' },
                { name: 'vehicle_types', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/vehicle_types' },
                { name: 'system_regions', url: 'https://sharedmobility.ch/v2/gbfs/voiscooters.com/system_regions' },
              ],
            },
          },
        });
      }
      if (url.endsWith('/voiscooters.com/vehicle_types')) {
        return jsonResponse({
          data: {
            vehicle_types: [{
              vehicle_type_id: 'voi-scooter',
              form_factor: 'scooter',
              propulsion_type: 'electric',
            }],
          },
        });
      }
      if (url.endsWith('/voiscooters.com/system_regions')) {
        return jsonResponse({
          data: { regions: [{ region_id: '401', name: 'Nyon' }, { region_id: '222', name: 'Bern' }] },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters(genevaQuery);

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources.national).toBe('skipped');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/free_bike_status'))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/identify?'))).toBe(false);
  });

  it('uses the spatial API for newly discovered systems without known coverage', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://sharedmobility.ch/v2/gbfs') {
        return jsonResponse({
          systems: [{
            id: 'lime_newmarket',
            url: 'https://sharedmobility.ch/v2/gbfs/lime_newmarket/gbfs',
          }],
        });
      }
      if (url.endsWith('/lime_newmarket/gbfs')) {
        return jsonResponse({
          data: {
            en: {
              feeds: [
                { name: 'free_bike_status', url: 'https://sharedmobility.ch/v2/gbfs/lime_newmarket/free_bike_status' },
                { name: 'vehicle_types', url: 'https://sharedmobility.ch/v2/gbfs/lime_newmarket/vehicle_types' },
              ],
            },
          },
        });
      }
      if (url.endsWith('/lime_newmarket/vehicle_types')) {
        return jsonResponse({
          data: {
            vehicle_types: [{
              vehicle_type_id: 'escooter',
              form_factor: 'scooter_standing',
              propulsion_type: 'electric',
            }],
          },
        });
      }
      if (url.startsWith('https://api.sharedmobility.ch/v1/sharedmobility/identify?')) {
        const params = new URL(url).searchParams;
        expect(params.getAll('filters')).toContain('ch.bfe.sharedmobility.provider.id=lime_newmarket');
        return jsonResponse([]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources.national).toBe('skipped');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/lime_newmarket/free_bike_status'))).toBe(false);
  });
});
