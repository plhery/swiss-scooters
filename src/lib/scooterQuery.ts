import type { FeedQuery } from '@/lib/scooterFeeds';
import { SWISS_MOBILITY_BOUNDS } from '@/lib/feedCoverage';
import { boundsIntersection } from '@/lib/geo';
import { PROVIDERS } from '@/lib/types';

export const MAX_SCOOTER_RESULTS = 25_000;

interface ValidQuery {
  ok: true;
  query: FeedQuery;
}

interface InvalidQuery {
  ok: false;
  error: string;
}

export type ScooterQueryResult = ValidQuery | InvalidQuery;

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = params.get(name);
  if (value === null) return fallback;
  return value.trim() === '' ? Number.NaN : Number(value);
}

export function parseScooterQuery(params: URLSearchParams): ScooterQueryResult {
  const lat = numberParam(params, 'lat', 47.376);
  const lng = numberParam(params, 'lng', 8.528);
  const south = numberParam(params, 'south', 47.33);
  const west = numberParam(params, 'west', 8.45);
  const north = numberParam(params, 'north', 47.43);
  const east = numberParam(params, 'east', 8.62);
  const minBattery = numberParam(params, 'minBattery', 0);

  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(south) || south < -90 || south > 90 ||
    !Number.isFinite(west) || west < -180 || west > 180 ||
    !Number.isFinite(north) || north < -90 || north > 90 ||
    !Number.isFinite(east) || east < -180 || east > 180 ||
    south >= north || west >= east ||
    !Number.isInteger(minBattery) || minBattery < 0 || minBattery > 100
  ) {
    return { ok: false, error: 'Invalid scooter search parameters' };
  }

  const providerParam = params.get('provider');
  let providers: Set<string> | undefined;
  if (providerParam !== null) {
    const requestedProviders = providerParam
      .split(',')
      .map(provider => provider.trim().toLowerCase())
      .filter(Boolean);
    if (
      requestedProviders.length === 0 ||
      requestedProviders.some(provider => !Object.hasOwn(PROVIDERS, provider))
    ) {
      return { ok: false, error: 'Unknown scooter provider' };
    }
    providers = new Set(requestedProviders);
  }

  const requestedBounds = { south, west, north, east };
  const swissBounds = boundsIntersection(requestedBounds, SWISS_MOBILITY_BOUNDS);

  return {
    ok: true,
    query: {
      lat,
      lng,
      bounds: swissBounds ?? requestedBounds,
      minBattery,
      providers,
      outsideCoverage: swissBounds === null,
    },
  };
}
