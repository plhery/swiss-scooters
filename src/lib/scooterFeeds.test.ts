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
  if (value && typeof value === 'object' && 'data' in value && value.data && typeof value.data === 'object' &&
      ('bikes' in value.data || 'vehicles' in value.data)) value = { last_updated: Date.now() / 1000, ...value };
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
            {
              name: 'system_pricing_plans',
              url: 'https://sharedmobility.ch/v2/gbfs/lime_zurich/system_pricing_plans',
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
          pricing_plan_id: 'lime-standard',
          bike_id: 'lime-1',
          lat: 47.377,
          lon: 8.542,
          current_fuel_percent: 0.75,
          current_range_meters: 12_000,
          rental_uris: {
            ios: 'limebike://vehicle/lime-1',
            android: 'https://lime.bike/vehicle/lime-1?platform=android',
            web: 'https://lime.bike/vehicle/lime-1',
          },
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
  if (url === 'https://sharedmobility.ch/v2/gbfs/lime_zurich/system_pricing_plans') {
    return jsonResponse({
      data: {
        plans: [{
          plan_id: 'lime-standard',
          currency: 'CHF',
          price: 1,
          per_min_pricing: [{ start: 0, rate: 0.42, interval: 1 }],
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
          {
            name: 'system_pricing_plans',
            url: 'https://api.hopp.bike/gbfs/ch-zurich/en/system_pricing_plans.json',
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
          pricing_plan_id: 'hopp-standard',
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
  if (url === 'https://api.hopp.bike/gbfs/ch-zurich/en/system_pricing_plans.json') {
    return jsonResponse({
      data: {
        plans: [{
          plan_id: 'hopp-standard',
          currency: 'chf',
          price: 1,
          per_min_price: [{ start: 0, rate: 0.4, interval: 1 }],
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
  it('does no upstream work for a viewport outside supported coverage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchScooters({
      ...query,
      bounds: { south: 51.4, west: -0.3, north: 51.6, east: 0.1 },
      outsideCoverage: true,
    });

    expect(result.vehicles).toEqual([]);
    expect(result.meta.sources).toEqual({
      france: 'skipped', germany: 'skipped', italy: 'skipped',
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
      expect.objectContaining({
        provider: 'lime',
        battery: 75,
        range_m: 12_000,
        deep_link: 'https://lime.bike/vehicle/lime-1',
        rental_uris: {
          ios: 'limebike://vehicle/lime-1',
          android: 'https://lime.bike/vehicle/lime-1?platform=android',
          web: 'https://lime.bike/vehicle/lime-1',
        },
        pricing: {
          currency: 'CHF',
          unlock_fee_minor_units: 100,
          minute_fee_minor_units: 42,
        },
      }),
      expect.objectContaining({
        provider: 'hopp',
        battery: 68,
        deep_link: 'https://app.hopp.bike/launch/hopp-1?direct',
        rental_uris: {
          ios: 'https://app.hopp.bike/launch/hopp-1?direct',
          android: 'https://app.hopp.bike/launch/hopp-1?direct',
          web: 'https://app.hopp.bike/launch/hopp-1?direct',
        },
        pricing: {
          currency: 'CHF',
          unlock_fee_minor_units: 100,
          minute_fee_minor_units: 40,
        },
      }),
      expect.objectContaining({
        provider: 'publibike',
        battery: null,
        vehicle_id: 'publibike-freefloating:publibike-zurich-1',
      }),
    ]));
    expect(result.meta).toMatchObject({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { france: 'skipped', germany: 'skipped', italy: 'skipped', national: 'fresh', hopp: 'fresh', publibike: 'fresh' },
    });
  });

  it('keeps availability fresh when optional pricing cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/lime_zurich/system_pricing_plans')) {
        throw new Error('Pricing unavailable');
      }
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).not.toHaveProperty('pricing');
    expect(result.meta).toMatchObject({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { france: 'skipped', germany: 'skipped', italy: 'skipped', national: 'fresh', hopp: 'skipped', publibike: 'skipped' },
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('system_pricing_plans'));
  });

  it('omits a tariff when its canonical values contradict its description', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/lime_zurich/system_pricing_plans')) {
        return jsonResponse({
          data: {
            plans: [{
              plan_id: 'lime-standard',
              currency: 'CHF',
              price: 0,
              description: 'Riders pay 0.95 CHF to unlock and 0.41 CHF per minute.',
              per_min_pricing: [{ start: 1, rate: 0.41, interval: 1 }],
            }],
          },
        });
      }
      const response = nationalResponse(url);
      if (response) return response;
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });

    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).not.toHaveProperty('pricing');
    expect(result.meta.sources.national).toBe('fresh');
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
      rental_uris: { ios: null, android: null, web: null },
      distance_m: expect.any(Number),
    }]);
    expect(result.meta).toMatchObject({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { france: 'skipped', germany: 'skipped', italy: 'skipped', national: 'skipped', hopp: 'skipped', publibike: 'fresh' },
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
      france: 'skipped', germany: 'skipped', italy: 'skipped',
      national: 'skipped',
      hopp: 'fresh',
      publibike: 'skipped',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
      sources: { france: 'skipped', germany: 'skipped', italy: 'skipped', national: 'fresh', hopp: 'failed', publibike: 'fresh' },
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
    expect(result.meta).toMatchObject({
      partial: true,
      stale: false,
      failedSources: ['national:dott_zurich'],
      sources: { france: 'skipped', germany: 'skipped', italy: 'skipped', national: 'partial', hopp: 'skipped', publibike: 'skipped' },
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
      france: 'skipped', germany: 'skipped', italy: 'skipped',
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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

describe('feed validation and tariff regressions', () => {
  it('does not call a valid Swiss observation cached solely because it is four minutes old', async () => {
    const observedAt = Date.now() - 240_000;
    vi.stubGlobal('fetch', vi.fn(async input => {
      const response = nationalResponse(String(input))!;
      if (String(input).endsWith('/free_bike_status')) {
        return Response.json({ ...(await response.json() as Record<string, unknown>), last_updated: observedAt / 1000 });
      }
      return response;
    }));
    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });
    expect(result.vehicles).toHaveLength(1);
    expect(result.meta).toMatchObject({ stale: false, expiresAt: new Date(observedAt + 300_000).toISOString() });
  });

  it.each([null, 0, Math.floor((Date.now() - 86400_000) / 1000)])('rejects a missing or expired Swiss status timestamp: %s', async timestamp => {
    vi.stubGlobal('fetch', vi.fn(async input => {
      const response = nationalResponse(String(input))!;
      if (String(input).endsWith('/free_bike_status')) {
        return Response.json({ ...(await response.json() as Record<string, unknown>), last_updated: timestamp });
      }
      return response;
    }));
    await expect(fetchScooters({ ...query, providers: new Set(['lime']) })).rejects.toBeInstanceOf(ScooterFeedsUnavailableError);
  });

  it('retains the last valid registry when an HTTP 200 response has an invalid shape', async () => {
    const { discoverCollectableFeeds } = await import('./scooterFeeds');
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let invalid = false;
    vi.stubGlobal('fetch', vi.fn(async input => invalid ? Response.json({}) : nationalResponse(String(input))!));
    expect((await discoverCollectableFeeds()).some(feed => feed.id === 'national:lime_zurich')).toBe(true);
    now += 3600_001;
    invalid = true;
    expect((await discoverCollectableFeeds()).some(feed => feed.id === 'national:lime_zurich')).toBe(true);
  });

  it('keeps live observation time advancing when only metadata uses stale fallback', async () => {
    const { discoverCollectableFeeds } = await import('./scooterFeeds');
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let metadataFails = false;
    vi.stubGlobal('fetch', vi.fn(async input => metadataFails && !String(input).endsWith('/free_bike_status')
      ? new Response('{}', { status: 503 }) : nationalResponse(String(input))!));
    const feed = (await discoverCollectableFeeds()).find(feed => feed.id === 'national:lime_zurich')!;
    await feed.collect();
    now += 3600_001;
    metadataFails = true;
    const collected = await feed.collect();
    expect(collected.stale).toBe(true);
    expect(collected.observedAt).toBe(now);
    expect(collected.vehicles).toHaveLength(1);
  });

  it.each([
    { per_min_pricing: [{ start: 0, rate: 0, interval: 1, end: 5 }, { start: 5, rate: 0.4, interval: 1 }] },
    { per_min_pricing: [{ start: 0, rate: 0.8, interval: 2 }] },
    { per_km_pricing: [{ start: 0, rate: 0.1, interval: 1 }] },
    { is_taxable: true },
  ])('omits estimates for tariffs the flat-minute contract cannot represent: %j', async changes => {
    vi.stubGlobal('fetch', vi.fn(async input => {
      const response = nationalResponse(String(input))!;
      if (String(input).endsWith('/system_pricing_plans')) {
        const body = await response.json() as { data: { plans: Record<string, unknown>[] } };
        Object.assign(body.data.plans[0], changes);
        return Response.json(body);
      }
      return response;
    }));
    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].pricing).toBeUndefined();
  });

  it('uses a vehicle type default tariff when the vehicle has no override', async () => {
    vi.stubGlobal('fetch', vi.fn(async input => {
      const response = nationalResponse(String(input))!;
      const body = await response.json() as { data: { bikes: Record<string, unknown>[]; vehicle_types: Record<string, unknown>[] } };
      if (String(input).endsWith('/free_bike_status')) delete body.data.bikes[0].pricing_plan_id;
      if (String(input).endsWith('/vehicle_types')) body.data.vehicle_types[0].default_pricing_plan_id = 'lime-standard';
      return Response.json(body);
    }));
    const result = await fetchScooters({ ...query, providers: new Set(['lime']) });
    expect(result.vehicles[0].pricing?.minute_fee_minor_units).toBe(42);
  });
});
