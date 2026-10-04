import { DEFAULT_REFRESH_AFTER_MS } from '@/lib/autoRefresh';
import { failedRequestOutcome, isExpired, responseExpiry } from '@/lib/dataExpiry';
import type { LoadFailure } from '@/lib/loadFailure';
import type {
  MapBounds,
  ParkingLocation,
  ScooterCluster,
  ScooterResponse,
  ScooterResponseMeta,
  Vehicle,
} from '@/lib/types';

export interface ScooterDataQuery {
  bounds: MapBounds;
  zoom: number;
  /** What the server filters by; 0 when the client filters the response itself. */
  minBattery: number;
}

export function scooterQueryParams({ bounds, zoom, minBattery }: ScooterDataQuery): URLSearchParams {
  return new URLSearchParams({
    south: bounds.south.toFixed(5),
    west: bounds.west.toFixed(5),
    north: bounds.north.toFixed(5),
    east: bounds.east.toFixed(5),
    zoom: String(zoom),
    minBattery: String(minBattery),
  });
}

/** Two queries with the same key receive the same response. */
export function scooterQueryKey(query: ScooterDataQuery): string {
  return scooterQueryParams(query).toString();
}

export interface ScooterDataState {
  vehicles: Vehicle[];
  clusters: ScooterCluster[];
  parking: ParkingLocation[];
  /** Of the last successful response. Kept when the scooters go out of date. */
  meta: ScooterResponseMeta | null;
  /** When the last successful response was observed (meta.generatedAt), in epoch milliseconds. */
  lastUpdated: number | null;
  /** A response is on screen, even one without scooters. */
  hasData: boolean;
  /** The query that response answered. */
  dataKey: string | null;
  expiresAt: number | null;
  parkingExpiresAt: number | null;
  lastSuccessAt: number | null;
  /** When the previous request finished, whatever its outcome. */
  lastAttemptAt: number | null;
  refreshAfterMs: number;
  /** The query of the request that was started last. */
  requestKey: string | null;
  requestInFlight: boolean;
  /** Set by a failed request, cleared only by a successful one. */
  failure: LoadFailure | null;
  /** The scooters expired and the request made after that failed, so they were removed. */
  outOfDate: boolean;
}

export const INITIAL_SCOOTER_DATA_STATE: ScooterDataState = {
  vehicles: [],
  clusters: [],
  parking: [],
  meta: null,
  lastUpdated: null,
  hasData: false,
  dataKey: null,
  expiresAt: null,
  parkingExpiresAt: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
  refreshAfterMs: DEFAULT_REFRESH_AFTER_MS,
  requestKey: null,
  requestInFlight: false,
  failure: null,
  outOfDate: false,
};

export type ScooterDataEvent =
  | { type: 'started'; key: string }
  | { type: 'succeeded'; key: string; response: ScooterResponse; now: number }
  | { type: 'failed'; failure: LoadFailure; now: number }
  /** The running request was cancelled without a replacement. */
  | { type: 'aborted' }
  | { type: 'parkingChecked'; now: number };

export function scooterDataReducer(state: ScooterDataState, event: ScooterDataEvent): ScooterDataState {
  switch (event.type) {
    case 'started':
      return { ...state, requestKey: event.key, requestInFlight: true };

    case 'succeeded': {
      // Accepted whatever its timestamps say: a response that is close to its
      // expiry, or already past it, is still the newest data there is.
      const { response, now } = event;
      const expiry = responseExpiry(response.meta, now);
      const generated = Date.parse(response.meta.generatedAt);
      const refreshAfter = response.meta.refreshAfterSeconds;
      return {
        vehicles: response.vehicles,
        clusters: response.clusters ?? [],
        parking: isExpired(expiry.parking, now) ? [] : response.parking ?? [],
        meta: response.meta,
        lastUpdated: Number.isFinite(generated) ? Math.min(generated, now) : now,
        hasData: true,
        dataKey: event.key,
        expiresAt: expiry.vehicles,
        parkingExpiresAt: expiry.parking,
        lastSuccessAt: now,
        lastAttemptAt: now,
        refreshAfterMs: typeof refreshAfter === 'number' && refreshAfter > 0
          ? refreshAfter * 1000
          : DEFAULT_REFRESH_AFTER_MS,
        requestKey: event.key,
        requestInFlight: false,
        failure: null,
        outOfDate: false,
      };
    }

    case 'failed': {
      const next = { ...state, lastAttemptAt: event.now, requestInFlight: false, failure: event.failure };
      if (failedRequestOutcome(state, event.now) !== 'out-of-date') return next;
      return { ...next, vehicles: [], clusters: [], hasData: false, dataKey: null, outOfDate: true };
    }

    case 'aborted':
      return state.requestInFlight ? { ...state, requestKey: null, requestInFlight: false } : state;

    case 'parkingChecked':
      return state.parking.length > 0 && isExpired(state.parkingExpiresAt, event.now)
        ? { ...state, parking: [] }
        : state;
  }
}

/**
 * 'load': nothing on screen answers the current view yet (the first load, or a
 * new area, zoom level or server filter). 'refresh': the data on screen is
 * being checked again and must not visibly change until the answer arrives.
 */
export type ScooterLoading = 'load' | 'refresh';

export function scooterLoading(state: ScooterDataState, queryKey: string | null): ScooterLoading | null {
  // A changed query counts from the moment it changes, before its request starts.
  const pending = state.requestInFlight || (queryKey !== null && queryKey !== state.requestKey);
  if (!pending) return state.lastAttemptAt === null ? 'load' : null;
  return state.hasData && state.dataKey === queryKey ? 'refresh' : 'load';
}
