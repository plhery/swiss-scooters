// @vitest-environment jsdom
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import { useScooterData, type ScooterData, type ScooterDataQuery } from '@/lib/useScooterData';
import type { ScooterResponse, ScooterResponseMeta } from '@/lib/types';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();

const ZURICH: ScooterDataQuery = { bounds: { south: 47.36, west: 8.52, north: 47.39, east: 8.57 }, zoom: 16, minBattery: 0 };
const BERN: ScooterDataQuery = { bounds: { south: 46.93, west: 7.42, north: 46.96, east: 7.47 }, zoom: 16, minBattery: 0 };

/** A healthy response as the server would build it at the moment it is requested. */
function body(meta: Partial<ScooterResponseMeta> = {}, extra: Partial<ScooterResponse> = {}): ScooterResponse {
  const now = Date.now();
  return {
    vehicles: [{ provider: 'lime', vehicle_id: 'one', lat: 47.377, lng: 8.542,
      battery: 80, range_m: null, distance_m: null, deep_link: null }],
    clusters: [],
    providers: { lime: 1 },
    ...extra,
    meta: {
      generatedAt: iso(now - 20_000),
      expiresAt: iso(now + 280_000),
      refreshAfterSeconds: 60,
      partial: false,
      stale: false,
      failedSources: [],
      sources: {},
      truncated: false,
      totalVehicles: 1,
      mode: 'vehicles',
      zoom: 16,
      ...meta,
    },
  };
}

const ok = (meta: Partial<ScooterResponseMeta> = {}, extra: Partial<ScooterResponse> = {}) =>
  async () => Response.json(body(meta, extra));
const status = (code: number) => async () => Response.json({ error: 'no' }, { status: code });
const networkError = async () => { throw new TypeError('Failed to fetch'); };
const stalled = (_input: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
});

const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Mounts the hook and records every state it renders. */
function mount(query: ScooterDataQuery | null = ZURICH, onOutOfDate?: () => void) {
  const history: ScooterData[] = [];
  const hook = renderHook(
    (props: { query: ScooterDataQuery | null }) => {
      const data = useScooterData(props.query, { onOutOfDate });
      history.push(data);
      return data;
    },
    { initialProps: { query } }
  );
  return { ...hook, history };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setVisibility('visible');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useScooterData', () => {
  it('reports the first load from the first render and loads once the map has a viewport', async () => {
    fetcher.mockImplementation(ok());
    const { result, rerender } = mount(null);
    expect(result.current).toMatchObject({ loading: 'load', hasData: false, failure: null, outOfDate: false, lastUpdated: null });

    await advance(5_000);
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ query: ZURICH });
    await advance(179);
    expect(fetcher).not.toHaveBeenCalled();
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0])
      .toBe('/api/scooters?south=47.36000&west=8.52000&north=47.39000&east=8.57000&zoom=16&minBattery=0');
    // Dated by the observation the server reports, not by the moment of arrival.
    expect(result.current).toMatchObject({ loading: null, hasData: true, failure: null, lastUpdated: T0 + 5_180 - 20_000 });
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.meta?.mode).toBe('vehicles');
  });

  it('never empties the map or reports a failure when a response is seconds from its expiry', async () => {
    // What the server sends when its oldest feed is almost five minutes old.
    fetcher.mockImplementation(async () => Response.json(body({
      generatedAt: iso(Date.now() - 297_000),
      expiresAt: iso(Date.now() + 3_000),
    })));
    const { result, history } = mount();
    await advance(180);
    const firstLoaded = history.length - 1;
    expect(result.current.vehicles).toHaveLength(1);

    // The expiry passes with no request running; nothing happens to the data.
    await advance(5_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ hasData: true, failure: null, outOfDate: false });

    // Refreshed ten seconds after the previous request, again and again.
    await advance(5_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(fetcher).toHaveBeenCalledTimes(5);

    for (const state of history.slice(firstLoaded)) {
      expect(state.vehicles).toHaveLength(1);
      expect(state.failure).toBeNull();
      expect(state.outOfDate).toBe(false);
      expect(state.loading).not.toBe('load');
    }
    expect(track).not.toHaveBeenCalled();
  });

  it('accepts a snapshot that arrives already expired and refreshes it after the gap', async () => {
    fetcher.mockImplementationOnce(async () => Response.json(body({
      generatedAt: iso(Date.now() - 330_000),
      expiresAt: iso(Date.now() - 30_000),
    }))).mockImplementation(ok());
    const { result } = mount();
    await advance(180);
    expect(result.current).toMatchObject({ hasData: true, failure: null, outOfDate: false });
    expect(result.current.vehicles).toHaveLength(1);

    await advance(9_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ hasData: true, failure: null, outOfDate: false });
  });

  it('refreshes at the interval the server names', async () => {
    fetcher.mockImplementation(ok());
    mount();
    await advance(180);
    await advance(59_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refreshes five seconds before the expiry when that is sooner than the interval', async () => {
    fetcher.mockImplementation(async () => Response.json(body({ expiresAt: iso(Date.now() + 40_000) })));
    mount();
    await advance(180);
    await advance(34_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the data when a refresh fails before the expiry and retries every ten seconds', async () => {
    fetcher.mockImplementationOnce(ok()).mockImplementation(networkError);
    const onOutOfDate = vi.fn();
    const { result } = mount(ZURICH, onOutOfDate);
    await advance(180);
    const { vehicles } = result.current;

    await advance(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // What is on screen still answers the view; only the newer answer is missing.
    expect(result.current).toMatchObject({ failure: 'failed', hasData: true, answersQuery: true, outOfDate: false, loading: null });
    expect(result.current.vehicles).toBe(vehicles);
    expect(result.current.lastUpdated).toBe(T0 + 180 - 20_000);

    await advance(9_999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(10_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.current.vehicles).toBe(vehicles);
    expect(onOutOfDate).not.toHaveBeenCalled();

    // The failure stays while a retry runs and goes when one succeeds.
    fetcher.mockImplementation(ok());
    await advance(10_000);
    expect(result.current).toMatchObject({ failure: null, hasData: true, outOfDate: false });
    expect(result.current.lastUpdated).toBe(T0 + 90_180 - 20_000);
  });

  it('removes the scooters only when the request after the expiry fails, and recovers on success', async () => {
    fetcher
      .mockImplementationOnce(ok({ expiresAt: iso(T0 + 30_180) }, {
        parking: [{ id: 'bay', provider: 'dott', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }],
      }))
      .mockImplementation(networkError);
    const onOutOfDate = vi.fn();
    const { result } = mount(ZURICH, onOutOfDate);
    await advance(180);

    // Five seconds before the expiry: fails, but the data is still valid.
    await advance(25_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ failure: 'failed', hasData: true, outOfDate: false });

    // The expiry passes between two requests: still nothing is removed.
    await advance(9_999);
    expect(result.current).toMatchObject({ hasData: true, outOfDate: false });
    expect(result.current.vehicles).toHaveLength(1);

    // The retry after the expiry fails too.
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ failure: 'failed', hasData: false, outOfDate: true, loading: null });
    expect(result.current.vehicles).toEqual([]);
    expect(result.current.clusters).toEqual([]);
    expect(result.current.parking).toHaveLength(1);
    expect(result.current.lastUpdated).toBe(T0 + 180 - 20_000);
    expect(onOutOfDate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(track).mock.calls).toEqual([['data_error', { result: 'request_failed' }], ['data_expired']]);

    // Still retried automatically, without announcing it again.
    await advance(10_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.current.outOfDate).toBe(true);
    expect(onOutOfDate).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(2);

    fetcher.mockImplementation(ok());
    await advance(10_000);
    expect(result.current).toMatchObject({ failure: null, hasData: true, outOfDate: false });
    expect(result.current.vehicles).toHaveLength(1);
  });

  it('waits for a request that is running when the data expires and lets its outcome decide', async () => {
    fetcher.mockImplementationOnce(ok({ expiresAt: iso(T0 + 30_180) })).mockImplementation(stalled);
    const { result } = mount();
    await advance(180);

    // The refresh starts five seconds before the expiry and stalls across it.
    await advance(25_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ loading: 'refresh', hasData: true, failure: null, outOfDate: false });

    // It times out twenty seconds after it started, well after the expiry.
    await advance(5_000);
    expect(result.current).toMatchObject({ failure: 'timeout', hasData: false, outOfDate: true });
  });

  it('retries a failed first load every ten seconds until it succeeds', async () => {
    fetcher.mockImplementation(networkError);
    const { result } = mount();
    await advance(180);
    expect(result.current).toMatchObject({ failure: 'failed', hasData: false, outOfDate: false, loading: null });

    await advance(9_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.outOfDate).toBe(false);

    fetcher.mockImplementation(ok());
    await advance(10_000);
    expect(result.current).toMatchObject({ failure: null, hasData: true });
  });

  it('reports a failure once, however often the retries fail, and again after a recovery', async () => {
    fetcher.mockImplementation(networkError);
    const { result } = mount();
    await advance(180);
    await advance(30_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(vi.mocked(track).mock.calls).toEqual([['data_error', { result: 'request_failed' }]]);
    expect(console.error).toHaveBeenCalledTimes(1);

    fetcher.mockImplementationOnce(ok()).mockImplementation(stalled);
    await advance(10_000);
    expect(result.current.failure).toBeNull();
    await advance(80_000);
    expect(result.current.failure).toBe('timeout');
    expect(vi.mocked(track).mock.calls).toEqual([
      ['data_error', { result: 'request_failed' }],
      ['data_error', { result: 'timeout' }],
    ]);
  });

  it('counts the gap from the end of a slow request', async () => {
    fetcher.mockImplementation(stalled);
    mount();
    await advance(180);
    // Times out at 20.18 s; the retry follows ten seconds after that.
    await advance(29_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not refresh while hidden and refreshes at once on return, keeping the data meanwhile', async () => {
    fetcher.mockImplementation(ok());
    const { result } = mount();
    await advance(180);

    setVisibility('hidden');
    await advance(600_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Long expired by now, but still on screen: nothing has failed.
    expect(result.current).toMatchObject({ hasData: true, failure: null, outOfDate: false });

    fetcher.mockImplementation(stalled);
    await act(async () => { setVisibility('visible'); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ loading: 'refresh', hasData: true, outOfDate: false });
    expect(result.current.vehicles).toHaveLength(1);

    // Only the outcome of that request removes the expired data.
    await advance(20_000);
    expect(result.current).toMatchObject({ failure: 'timeout', hasData: false, outOfDate: true });
  });

  it('leaves a running request alone when the page comes back', async () => {
    fetcher.mockImplementationOnce(ok()).mockImplementation(stalled);
    mount();
    await advance(180);
    await advance(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const { signal } = fetcher.mock.calls[1][1];

    setVisibility('hidden');
    await advance(5_000);
    await act(async () => { setVisibility('visible'); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(signal!.aborted).toBe(false);
  });

  it('does not load twice when the page comes back just after the map moved', async () => {
    fetcher.mockImplementation(ok());
    const { rerender } = mount();
    await advance(180);
    await advance(50_000);

    setVisibility('hidden');
    await advance(30_000);
    rerender({ query: BERN });
    await act(async () => { setVisibility('visible'); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(180);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('south=46.93000');
  });

  it('returns to the foreground with fresh data without refreshing early', async () => {
    fetcher.mockImplementation(ok());
    mount();
    await advance(180);

    setVisibility('hidden');
    await advance(20_000);
    await act(async () => { setVisibility('visible'); });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The schedule resumes where it was.
    await advance(39_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refreshes on return to the foreground without waiting out the gap after a failure', async () => {
    fetcher.mockImplementationOnce(ok()).mockImplementation(networkError);
    const { result } = mount();
    await advance(180);
    await advance(60_000);
    expect(result.current.failure).toBe('failed');

    setVisibility('hidden');
    await advance(3_000);
    fetcher.mockImplementation(ok());
    await act(async () => { setVisibility('visible'); });
    await advance(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.failure).toBeNull();
  });

  it('does not retry a failed load while hidden', async () => {
    fetcher.mockImplementation(networkError);
    mount();
    await advance(180);
    setVisibility('hidden');
    await advance(120_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { setVisibility('visible'); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['busy', status(429)],
    ['unavailable', status(503)],
    ['unavailable', status(500)],
    ['failed', status(400)],
    ['failed', networkError],
    ['failed', async () => Response.json({ vehicles: 'none' })],
    ['failed', async () => new Response('<html>', { status: 200 })],
    ['timeout', stalled],
  ] as const)('classifies a failure as %s', async (failure, implementation) => {
    fetcher.mockImplementation(implementation);
    const { result } = mount();
    await advance(180 + 20_000);
    expect(result.current.failure).toBe(failure);
  });

  it('says offline when the browser reports no connection, even if the request timed out', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fetcher.mockImplementation(networkError);
    const first = mount();
    await advance(180);
    expect(first.result.current.failure).toBe('offline');
    first.unmount();

    fetcher.mockImplementation(stalled);
    const second = mount();
    await advance(180 + 20_000);
    expect(second.result.current.failure).toBe('offline');
  });

  it('loads a new view at once, replaces the request for the old one and calls it a load', async () => {
    fetcher.mockImplementation(ok());
    const { result, rerender } = mount();
    expect(result.current.answersQuery).toBe(false);
    await advance(180);
    expect(result.current.answersQuery).toBe(true);

    fetcher.mockImplementation(stalled);
    rerender({ query: BERN });
    expect(result.current).toMatchObject({ loading: 'load', answersQuery: false });
    await advance(180);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('south=46.93000');
    expect(result.current).toMatchObject({ loading: 'load', hasData: true, answersQuery: false, failure: null });

    // Moving on aborts the stalled request instead of waiting for its timeout.
    const bernSignal = fetcher.mock.calls[1][1].signal!;
    fetcher.mockImplementation(ok());
    rerender({ query: ZURICH });
    await advance(180);
    expect(bernSignal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ loading: null, hasData: true, answersQuery: true, failure: null });
  });

  it('does not reload for a query object that asks for the same thing', async () => {
    fetcher.mockImplementation(ok());
    const { rerender } = mount();
    await advance(180);
    rerender({ query: { ...ZURICH, bounds: { ...ZURICH.bounds } } });
    await advance(1_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reloads when the server-side battery filter changes', async () => {
    fetcher.mockImplementation(ok());
    const { rerender } = mount({ ...ZURICH, zoom: 14 });
    await advance(180);
    rerender({ query: { ...ZURICH, zoom: 14, minBattery: 30 } });
    await advance(180);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toContain('minBattery=30');
  });

  it('keeps the data of the previous view when the load for a new view fails', async () => {
    fetcher.mockImplementationOnce(ok()).mockImplementation(status(503));
    const { result, rerender } = mount();
    await advance(180);
    rerender({ query: BERN });
    await advance(180);
    expect(result.current).toMatchObject({ failure: 'unavailable', hasData: true, outOfDate: false, loading: null });
    expect(result.current.vehicles).toHaveLength(1);
    // The scooters of the previous view stay, but they are not an answer for this one.
    expect(result.current.answersQuery).toBe(false);
  });

  it('refreshes at once on request, whatever the gap, and reports the outcome', async () => {
    fetcher.mockImplementation(networkError);
    const { result } = mount();
    await advance(180);
    expect(fetcher).toHaveBeenCalledTimes(1);

    let outcome: boolean | undefined;
    await act(async () => { outcome = await result.current.refresh(); });
    expect(outcome).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockImplementation(ok());
    await act(async () => { outcome = await result.current.refresh(); });
    expect(outcome).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ failure: null, hasData: true });

    // The schedule continues from the manual refresh.
    await advance(59_999);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('has nothing to refresh before the map has a viewport', async () => {
    const { result } = mount(null);
    let outcome: boolean | undefined;
    await act(async () => { outcome = await result.current.refresh(); });
    expect(outcome).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('expires parking separately from the scooters', async () => {
    const parking = [{ id: 'bay', provider: 'dott', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }];
    fetcher
      .mockImplementationOnce(ok({ parkingExpiresAt: iso(T0 + 30_000) }, { parking }))
      .mockImplementation(networkError);
    const { result } = mount();
    await advance(180);
    expect(result.current.parking).toHaveLength(1);

    await advance(29_819);
    expect(result.current.parking).toHaveLength(1);
    await advance(1);
    expect(result.current.parking).toEqual([]);
    expect(result.current.vehicles).toHaveLength(1);
  });

  it('drops expired parking on return to the foreground', async () => {
    const parking = [{ id: 'bay', provider: 'dott', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }];
    fetcher.mockImplementationOnce(ok({ parkingExpiresAt: iso(T0 + 30_000) }, { parking })).mockImplementation(stalled);
    const { result } = mount();
    await advance(180);
    setVisibility('hidden');
    vi.setSystemTime(T0 + 45_000);
    await act(async () => { setVisibility('visible'); });
    expect(result.current.parking).toEqual([]);
    expect(result.current.vehicles).toHaveLength(1);
  });

  it('stops requesting and aborts the running request when it unmounts', async () => {
    fetcher.mockImplementationOnce(ok()).mockImplementation(stalled);
    const { unmount } = mount();
    await advance(180);
    await advance(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const { signal } = fetcher.mock.calls[1][1];

    unmount();
    expect(signal!.aborted).toBe(true);
    await advance(300_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('loads once under StrictMode, which mounts every effect twice', async () => {
    fetcher.mockImplementation(ok());
    const { result } = renderHook(() => useScooterData(ZURICH), { wrapper: StrictMode });
    await advance(180);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ loading: null, hasData: true, failure: null });
    await advance(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('renders the loading state on the server without requesting anything', () => {
    function Probe() {
      const data = useScooterData(ZURICH);
      return <output>{`${data.loading}:${data.hasData}:${data.vehicles.length}`}</output>;
    }
    expect(renderToString(<Probe />)).toContain('load:false:0');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps one refresh function for the life of the hook', async () => {
    fetcher.mockImplementation(ok());
    const { result } = mount();
    const { refresh } = result.current;
    await advance(180);
    await advance(60_000);
    expect(result.current.refresh).toBe(refresh);
  });
});
