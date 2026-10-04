'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  DEFAULT_RIDE_DURATION,
  loadRideDuration,
  saveRideDuration,
  type RideDuration,
} from '@/lib/ridePrice';

let current: RideDuration | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): RideDuration {
  current ??= loadRideDuration();
  return current;
}

/** The ride length the price estimate is for, remembered on this device. */
export function useRideDuration(): [RideDuration, (minutes: number) => void] {
  // The server renders the default; the stored choice arrives with hydration.
  const duration = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_RIDE_DURATION);
  const setDuration = useCallback((minutes: number) => {
    current = saveRideDuration(minutes);
    for (const listener of listeners) listener();
  }, []);
  return [duration, setDuration];
}
