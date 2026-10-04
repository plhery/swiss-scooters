'use client';

import { useSyncExternalStore } from 'react';
import { recentPlaces, type Place } from '@/lib/places';

const NONE: readonly Place[] = [];

/** The places chosen since this page was opened, most recent first. */
export function useRecentPlaces(): readonly Place[] {
  return useSyncExternalStore(recentPlaces.subscribe, recentPlaces.get, () => NONE);
}
