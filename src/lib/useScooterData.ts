'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { track } from '@/lib/analytics';
import { refreshDecision } from '@/lib/autoRefresh';
import { clockOffset } from '@/lib/dataExpiry';
import { classifyLoadFailure, type LoadFailure } from '@/lib/loadFailure';
import { requestDeadline } from '@/lib/requestDeadline';
import {
  INITIAL_SCOOTER_DATA_STATE,
  scooterDataReducer,
  scooterLoading,
  scooterQueryKey,
  scooterQueryParams,
  type ScooterDataEvent,
  type ScooterDataQuery,
  type ScooterDataState,
  type ScooterLoading,
} from '@/lib/scooterDataState';
import type {
  ParkingLocation,
  ScooterCluster,
  ScooterResponse,
  ScooterResponseMeta,
  Vehicle,
} from '@/lib/types';

export type { ScooterDataQuery, ScooterLoading } from '@/lib/scooterDataState';

// Long enough to coalesce the viewport changes of one map gesture.
const QUERY_DEBOUNCE_MS = 180;
const REQUEST_TIMEOUT_MS = 20_000;

export interface ScooterData {
  vehicles: Vehicle[];
  clusters: ScooterCluster[];
  parking: ParkingLocation[];
  /** Of the last successful response; kept in the out-of-date state. */
  meta: ScooterResponseMeta | null;
  /** When the last successful response was observed, in epoch milliseconds. */
  lastUpdated: number | null;
  /** A response is on screen, even one without scooters. */
  hasData: boolean;
  loading: ScooterLoading | null;
  /** The response on screen answers the current query, not an earlier area, zoom level or filter. */
  answersQuery: boolean;
  /** Why the last request failed. Stays until a request succeeds, also while retrying. */
  failure: LoadFailure | null;
  /** The scooters were removed because they expired and could not be refreshed. */
  outOfDate: boolean;
  /** Fetches at once, for "Try again" and "Refresh". Resolves to whether it succeeded. */
  refresh: () => Promise<boolean>;
}

export interface ScooterDataOptions {
  /** Called when the scooters are removed, so the caller can drop its selection. */
  onOutOfDate?: () => void;
}

function clearTimer(timer: number | null): null {
  if (timer !== null) window.clearTimeout(timer);
  return null;
}

/**
 * Owns the request and its timers outside React, so that a timer, a response
 * and a visibility change always see the same current state.
 */
function createScooterDataController() {
  let state = INITIAL_SCOOTER_DATA_STATE;
  let query: ScooterDataQuery | null = null;
  // The query a load has been queued or started for.
  let wantedKey: string | null = null;
  let active = false;
  let request: { controller: AbortController } | null = null;
  let debounceTimer: number | null = null;
  let refreshTimer: number | null = null;
  let parkingTimer: number | null = null;
  let onOutOfDate: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const apply = (event: ScooterDataEvent) => {
    const next = scooterDataReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const syncParkingTimer = () => {
    parkingTimer = clearTimer(parkingTimer);
    if (!active || state.parking.length === 0 || state.parkingExpiresAt === null) return;
    parkingTimer = window.setTimeout(() => {
      apply({ type: 'parkingChecked', now: Date.now() });
      syncParkingTimer();
    }, Math.max(0, state.parkingExpiresAt - Date.now()));
  };

  const schedule = (returning = false) => {
    refreshTimer = clearTimer(refreshTimer);
    if (!active) return;
    const now = Date.now();
    const decision = refreshDecision({
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      refreshAfterMs: state.refreshAfterMs,
      expiresAt: state.expiresAt,
      now,
      visible: document.visibilityState === 'visible',
      returning,
      requestInFlight: request !== null || debounceTimer !== null,
      hasQuery: query !== null,
    });
    if (decision.action === 'refresh') void load();
    else if (decision.at !== null) refreshTimer = window.setTimeout(() => schedule(), Math.max(0, decision.at - now));
  };

  const load = async (): Promise<boolean> => {
    if (!active || !query) return false;
    const requestQuery = query;
    const key = scooterQueryKey(requestQuery);
    request?.controller.abort();
    debounceTimer = clearTimer(debounceTimer);
    refreshTimer = clearTimer(refreshTimer);
    wantedKey = key;
    const current = { controller: new AbortController() };
    request = current;
    const deadline = requestDeadline(current.controller.signal, REQUEST_TIMEOUT_MS);
    apply({ type: 'started', key });

    let response: ScooterResponse | null = null;
    let clockOffsetMs = 0;
    let failure: LoadFailure = 'failed';
    let cause: unknown;
    try {
      // Past the browser's cache: the response may be served stale while it is
      // revalidated, which would answer every refresh with the previous one.
      const res = await fetch(`/api/scooters?${scooterQueryParams(requestQuery)}`, {
        cache: 'no-store',
        signal: deadline.signal,
      });
      if (res.ok) {
        // The server's times are compared with this device's clock, which may be wrong.
        clockOffsetMs = clockOffset(res.headers.get('Date'), Date.now());
        const data = await res.json() as ScooterResponse;
        if (!Array.isArray(data.vehicles) || !data.meta) throw new Error('Invalid scooter response');
        response = data;
      } else {
        failure = classifyLoadFailure({ status: res.status });
        cause = new Error(`HTTP ${res.status}`);
      }
    } catch (error) {
      failure = classifyLoadFailure({ timedOut: deadline.signal.aborted, online: navigator.onLine });
      cause = error;
    } finally {
      deadline.dispose();
    }
    // Replaced by a newer request, or the page is gone.
    if (request !== current) return false;
    request = null;

    if (response) {
      apply({ type: 'succeeded', key, response, now: Date.now(), clockOffsetMs });
    } else {
      const previous = state;
      apply({ type: 'failed', failure, now: Date.now() });
      // Retries repeat every few seconds; report a failure once, when it starts.
      if (!previous.failure) {
        track('data_error', { result: failure === 'timeout' ? 'timeout' : 'request_failed' });
        console.error('Failed to fetch scooters:', cause);
      }
      if (state.outOfDate && !previous.outOfDate) {
        track('data_expired');
        onOutOfDate?.();
      }
    }
    syncParkingTimer();
    schedule();
    return response !== null;
  };

  const onVisibilityChange = () => {
    apply({ type: 'parkingChecked', now: Date.now() });
    syncParkingTimer();
    // Back in the foreground: refresh at once when due, and keep what is on
    // screen until that request has an outcome.
    schedule(document.visibilityState === 'visible');
  };

  return {
    getState: () => state,
    getServerState: () => INITIAL_SCOOTER_DATA_STATE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      active = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      syncParkingTimer();
      schedule();
    },
    stop() {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Whatever was cancelled here is requested again if the page starts over.
      if (request || debounceTimer !== null) wantedKey = null;
      request?.controller.abort();
      request = null;
      debounceTimer = clearTimer(debounceTimer);
      refreshTimer = clearTimer(refreshTimer);
      parkingTimer = clearTimer(parkingTimer);
      apply({ type: 'aborted' });
    },
    setOptions(options: ScooterDataOptions) {
      onOutOfDate = options.onOutOfDate;
    },
    setQuery(next: ScooterDataQuery | null) {
      query = next;
      if (!active || !next) return;
      const key = scooterQueryKey(next);
      if (key === wantedKey) return;
      wantedKey = key;
      debounceTimer = clearTimer(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void load();
      }, QUERY_DEBOUNCE_MS);
    },
    refresh: load,
  };
}

/**
 * Loads the scooters for the map and keeps them fresh. The data on screen is
 * refreshed before it expires and is removed only when it has expired and the
 * request made after that failed; a response is never an error because of its
 * own timestamps.
 */
export function useScooterData(query: ScooterDataQuery | null, options: ScooterDataOptions = {}): ScooterData {
  const [controller] = useState(createScooterDataController);
  const state: ScooterDataState = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getServerState
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  // Every render: the controller compares queries by key and ignores an unchanged one.
  useEffect(() => {
    controller.setOptions(options);
    controller.setQuery(query);
  });

  const queryKey = query ? scooterQueryKey(query) : null;
  const loading = scooterLoading(state, queryKey);
  const answersQuery = state.hasData && state.dataKey === queryKey;

  return useMemo(() => ({
    vehicles: state.vehicles,
    clusters: state.clusters,
    parking: state.parking,
    meta: state.meta,
    lastUpdated: state.lastUpdated,
    hasData: state.hasData,
    loading,
    answersQuery,
    failure: state.failure,
    outOfDate: state.outOfDate,
    refresh: controller.refresh,
  }), [answersQuery, controller, loading, state]);
}
