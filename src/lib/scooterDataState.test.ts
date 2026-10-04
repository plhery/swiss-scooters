import { describe, expect, it } from 'vitest';
import { nextRefreshAt } from '@/lib/autoRefresh';
import { isExpired } from '@/lib/dataExpiry';
import {
  INITIAL_SCOOTER_DATA_STATE,
  scooterDataReducer,
  scooterLoading,
  scooterQueryKey,
  scooterQueryParams,
  type ScooterDataEvent,
  type ScooterDataState,
} from '@/lib/scooterDataState';
import type { ScooterResponse, ScooterResponseMeta } from '@/lib/types';

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();

function response(meta: Partial<ScooterResponseMeta> = {}, parking = true): ScooterResponse {
  return {
    vehicles: [{ provider: 'lime', vehicle_id: 'one', lat: 47.377, lng: 8.542,
      battery: 80, range_m: null, distance_m: null, deep_link: null }],
    clusters: [{ id: 'c', lat: 47.38, lng: 8.54, count: 3, providers: { voi: 3 } }],
    providers: { lime: 1, voi: 3 },
    ...(parking ? { parking: [{ id: 'bay', provider: 'dott', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }] } : {}),
    meta: {
      generatedAt: iso(T0 - 30_000),
      expiresAt: iso(T0 + 270_000),
      parkingExpiresAt: iso(T0 + 200_000),
      refreshAfterSeconds: 60,
      partial: false,
      stale: false,
      failedSources: [],
      sources: {},
      truncated: false,
      totalVehicles: 4,
      mode: 'clusters',
      zoom: 15,
      ...meta,
    },
  };
}

function run(events: ScooterDataEvent[], from: ScooterDataState = INITIAL_SCOOTER_DATA_STATE): ScooterDataState {
  return events.reduce(scooterDataReducer, from);
}

const loaded = run([
  { type: 'started', key: 'a' },
  { type: 'succeeded', key: 'a', response: response(), now: T0 },
]);

describe('scooter query', () => {
  const query = { bounds: { south: 47.361234567, west: 8.52, north: 47.39, east: 8.57 }, zoom: 16, minBattery: 0 };

  it('sends the bounds with five decimals, the zoom and the server filter', () => {
    expect(scooterQueryParams(query).toString())
      .toBe('south=47.36123&west=8.52000&north=47.39000&east=8.57000&zoom=16&minBattery=0');
  });

  it('gives queries that would receive the same response the same key', () => {
    expect(scooterQueryKey({ ...query, bounds: { ...query.bounds, south: 47.3612349 } })).toBe(scooterQueryKey(query));
    expect(scooterQueryKey({ ...query, zoom: 15 })).not.toBe(scooterQueryKey(query));
    expect(scooterQueryKey({ ...query, minBattery: 30 })).not.toBe(scooterQueryKey(query));
  });
});

describe('scooterDataReducer', () => {
  it('puts a successful response on screen with its freshness', () => {
    expect(loaded).toMatchObject({
      hasData: true,
      dataKey: 'a',
      requestKey: 'a',
      requestInFlight: false,
      failure: null,
      outOfDate: false,
      lastUpdated: T0 - 30_000,
      expiresAt: T0 + 270_000,
      parkingExpiresAt: T0 + 200_000,
      lastSuccessAt: T0,
      lastAttemptAt: T0,
      refreshAfterMs: 60_000,
    });
    expect(loaded.vehicles).toHaveLength(1);
    expect(loaded.clusters).toHaveLength(1);
    expect(loaded.parking).toHaveLength(1);
    expect(loaded.meta?.mode).toBe('clusters');
  });

  it('accepts a response that arrives already expired', () => {
    const state = run([
      { type: 'started', key: 'a' },
      { type: 'succeeded', key: 'a', response: response({ generatedAt: iso(T0 - 320_000), expiresAt: iso(T0 - 20_000) }), now: T0 },
    ]);
    expect(state).toMatchObject({ hasData: true, failure: null, outOfDate: false, expiresAt: T0 - 20_000 });
    expect(state.vehicles).toHaveLength(1);
  });

  it('uses the hourly interval of the city overview and the default when none is sent', () => {
    const overview = response({ overview: true, refreshAfterSeconds: 3600, expiresAt: iso(T0 + 3 * 3_600_000) });
    expect(scooterDataReducer(loaded, { type: 'succeeded', key: 'o', response: overview, now: T0 }).refreshAfterMs).toBe(3_600_000);
    for (const refreshAfterSeconds of [undefined, 0, -5]) {
      expect(scooterDataReducer(loaded, { type: 'succeeded', key: 'a', response: response({ refreshAfterSeconds }), now: T0 }).refreshAfterMs)
        .toBe(60_000);
    }
  });

  it('never dates the data later than it was received', () => {
    const ahead = scooterDataReducer(loaded, { type: 'succeeded', key: 'a', response: response({ generatedAt: iso(T0 + 90_000) }), now: T0 });
    const invalid = scooterDataReducer(loaded, { type: 'succeeded', key: 'a', response: response({ generatedAt: 'now' }), now: T0 });
    expect(ahead.lastUpdated).toBe(T0);
    expect(invalid.lastUpdated).toBe(T0);
  });

  it('reads the server\'s times on a device clock that is six minutes fast', () => {
    const SKEW = 360_000;
    // The device reads T0 + 6 min while the server, at T0, sends data seen 30 s ago that lasts 270 s more.
    const state = run([
      { type: 'started', key: 'a' },
      { type: 'succeeded', key: 'a', response: response(), now: T0 + SKEW, clockOffsetMs: SKEW },
    ]);
    expect(state).toMatchObject({
      lastUpdated: T0 + SKEW - 30_000,
      expiresAt: T0 + SKEW + 270_000,
      parkingExpiresAt: T0 + SKEW + 200_000,
      lastSuccessAt: T0 + SKEW,
    });
    // Not expired on arrival, fresh enough to read "Live", and due again at the server's interval.
    expect(isExpired(state.expiresAt, T0 + SKEW)).toBe(false);
    expect(T0 + SKEW - state.lastUpdated!).toBeLessThan(90_000);
    expect(nextRefreshAt(state)).toBe(T0 + SKEW + 60_000);
    expect(state.parking).toHaveLength(1);
    // One failed request does not empty the map either.
    expect(scooterDataReducer(state, { type: 'failed', failure: 'busy', now: T0 + SKEW + 60_000 }))
      .toMatchObject({ hasData: true, outOfDate: false });
  });

  it('reads the server\'s times on a device clock that is behind', () => {
    const SKEW = -120_000;
    const state = scooterDataReducer(INITIAL_SCOOTER_DATA_STATE, {
      type: 'succeeded', key: 'a', response: response(), now: T0 + SKEW, clockOffsetMs: SKEW,
    });
    expect(state).toMatchObject({ lastUpdated: T0 + SKEW - 30_000, expiresAt: T0 + SKEW + 270_000 });
  });

  it('tolerates a response without clusters or parking', () => {
    const bare = { ...response({}, false), clusters: undefined } as unknown as ScooterResponse;
    const state = scooterDataReducer(INITIAL_SCOOTER_DATA_STATE, { type: 'succeeded', key: 'a', response: bare, now: T0 });
    expect(state.clusters).toEqual([]);
    expect(state.parking).toEqual([]);
  });

  it('keeps everything when a refresh fails before the expiry', () => {
    const state = run([
      { type: 'started', key: 'a' },
      { type: 'failed', failure: 'offline', now: T0 + 60_000 },
    ], loaded);
    expect(state).toMatchObject({
      hasData: true, outOfDate: false, failure: 'offline', requestInFlight: false,
      lastAttemptAt: T0 + 60_000, lastSuccessAt: T0, lastUpdated: T0 - 30_000,
    });
    expect(state.vehicles).toBe(loaded.vehicles);
    expect(state.clusters).toBe(loaded.clusters);
  });

  it('does not remove anything just because the expiry passes', () => {
    // Failed before the expiry; no event at the expiry itself changes the state.
    const failedBefore = scooterDataReducer(loaded, { type: 'failed', failure: 'timeout', now: T0 + 269_000 });
    expect(failedBefore.hasData).toBe(true);
    expect(scooterDataReducer(failedBefore, { type: 'parkingChecked', now: T0 + 280_000 }).vehicles).toHaveLength(1);
    expect(scooterDataReducer(failedBefore, { type: 'started', key: 'a' }).vehicles).toHaveLength(1);
  });

  it('removes scooters and clusters when the request after the expiry fails', () => {
    const state = run([
      { type: 'failed', failure: 'failed', now: T0 + 269_000 },
      { type: 'started', key: 'a' },
      { type: 'failed', failure: 'offline', now: T0 + 279_000 },
    ], loaded);
    expect(state).toMatchObject({
      hasData: false, dataKey: null, outOfDate: true, failure: 'offline',
      lastUpdated: T0 - 30_000, lastAttemptAt: T0 + 279_000,
    });
    expect(state.vehicles).toEqual([]);
    expect(state.clusters).toEqual([]);
    // Parking follows its own expiry, and the last metadata stays for the card.
    expect(state.parking).toHaveLength(1);
    expect(state.meta).toBe(loaded.meta);
  });

  it('goes out of date when a request that was running across the expiry fails', () => {
    const state = run([
      { type: 'started', key: 'a' },
      { type: 'failed', failure: 'timeout', now: T0 + 270_000 },
    ], loaded);
    expect(state.outOfDate).toBe(true);
  });

  it('goes out of date when the refresh of an already expired snapshot fails', () => {
    const expired = scooterDataReducer(INITIAL_SCOOTER_DATA_STATE, {
      type: 'succeeded', key: 'a', response: response({ generatedAt: iso(T0 - 320_000), expiresAt: iso(T0 - 20_000) }), now: T0,
    });
    expect(scooterDataReducer(expired, { type: 'failed', failure: 'unavailable', now: T0 + 10_000 }))
      .toMatchObject({ outOfDate: true, hasData: false, failure: 'unavailable' });
  });

  it('stays out of date while retries fail and returns to normal on success', () => {
    const outOfDate = scooterDataReducer(loaded, { type: 'failed', failure: 'offline', now: T0 + 300_000 });
    const retried = run([
      { type: 'started', key: 'a' },
      { type: 'failed', failure: 'timeout', now: T0 + 330_000 },
    ], outOfDate);
    expect(retried).toMatchObject({ outOfDate: true, hasData: false, failure: 'timeout' });

    const recovered = run([
      { type: 'started', key: 'a' },
      { type: 'succeeded', key: 'a', response: response({ generatedAt: iso(T0 + 340_000), expiresAt: iso(T0 + 640_000) }), now: T0 + 341_000 },
    ], retried);
    expect(recovered).toMatchObject({ outOfDate: false, hasData: true, failure: null, lastUpdated: T0 + 340_000 });
    expect(recovered.vehicles).toHaveLength(1);
  });

  it('records a failed first load without calling it out of date', () => {
    const state = run([
      { type: 'started', key: 'a' },
      { type: 'failed', failure: 'busy', now: T0 },
    ]);
    expect(state).toMatchObject({ hasData: false, outOfDate: false, failure: 'busy', lastAttemptAt: T0, lastSuccessAt: null });
  });

  it('keeps the failure while a retry runs and clears it only on success', () => {
    const failed = scooterDataReducer(loaded, { type: 'failed', failure: 'offline', now: T0 + 60_000 });
    const retrying = scooterDataReducer(failed, { type: 'started', key: 'a' });
    expect(retrying).toMatchObject({ failure: 'offline', requestInFlight: true });
    expect(scooterDataReducer(retrying, { type: 'succeeded', key: 'a', response: response(), now: T0 + 70_000 }).failure).toBeNull();
  });

  it('expires parking on its own schedule, and on arrival when it is already too old', () => {
    expect(scooterDataReducer(loaded, { type: 'parkingChecked', now: T0 + 199_999 })).toBe(loaded);
    const expired = scooterDataReducer(loaded, { type: 'parkingChecked', now: T0 + 200_000 });
    expect(expired.parking).toEqual([]);
    expect(expired.vehicles).toBe(loaded.vehicles);
    expect(scooterDataReducer(expired, { type: 'parkingChecked', now: T0 + 250_000 })).toBe(expired);

    const stale = scooterDataReducer(INITIAL_SCOOTER_DATA_STATE, {
      type: 'succeeded', key: 'a', response: response({ parkingExpiresAt: iso(T0 - 1) }), now: T0,
    });
    expect(stale.parking).toEqual([]);
    expect(stale.vehicles).toHaveLength(1);
  });

  it('forgets a cancelled request so that it is asked for again', () => {
    const running = scooterDataReducer(loaded, { type: 'started', key: 'b' });
    expect(scooterDataReducer(running, { type: 'aborted' })).toMatchObject({ requestInFlight: false, requestKey: null, hasData: true });
    expect(scooterDataReducer(loaded, { type: 'aborted' })).toBe(loaded);
  });
});

describe('scooterLoading', () => {
  it('is loading from the first paint until the first request has finished', () => {
    expect(scooterLoading(INITIAL_SCOOTER_DATA_STATE, null)).toBe('load');
    expect(scooterLoading(INITIAL_SCOOTER_DATA_STATE, 'a')).toBe('load');
    expect(scooterLoading(scooterDataReducer(INITIAL_SCOOTER_DATA_STATE, { type: 'started', key: 'a' }), 'a')).toBe('load');
  });

  it('is idle once the data on screen answers the query', () => {
    expect(scooterLoading(loaded, 'a')).toBeNull();
  });

  it('calls a repeated request for the same view a refresh', () => {
    expect(scooterLoading(scooterDataReducer(loaded, { type: 'started', key: 'a' }), 'a')).toBe('refresh');
  });

  it('calls a changed view a load from the moment it changes', () => {
    expect(scooterLoading(loaded, 'b')).toBe('load');
    expect(scooterLoading(scooterDataReducer(loaded, { type: 'started', key: 'b' }), 'b')).toBe('load');
  });

  it('is idle after a failure and loading again during each retry', () => {
    const failedFirst = run([{ type: 'started', key: 'a' }, { type: 'failed', failure: 'offline', now: T0 }]);
    expect(scooterLoading(failedFirst, 'a')).toBeNull();
    expect(scooterLoading(scooterDataReducer(failedFirst, { type: 'started', key: 'a' }), 'a')).toBe('load');

    const failedMove = run([{ type: 'started', key: 'b' }, { type: 'failed', failure: 'offline', now: T0 + 5_000 }], loaded);
    expect(scooterLoading(failedMove, 'b')).toBeNull();
    // Back on the view the data was loaded for.
    expect(scooterLoading(failedMove, 'a')).toBe('refresh');
  });

  it('loads rather than refreshes while out of date, because nothing is on screen', () => {
    const outOfDate = scooterDataReducer(loaded, { type: 'failed', failure: 'offline', now: T0 + 300_000 });
    expect(scooterLoading(outOfDate, 'a')).toBeNull();
    expect(scooterLoading(scooterDataReducer(outOfDate, { type: 'started', key: 'a' }), 'a')).toBe('load');
  });
});
