import { isPointCovered, type CoveredCity } from '@/lib/coveredCities';
import type { AppLocale } from '@/lib/i18n';

/** A row of GET/POST /api/geocode. Servers before the two-line labels send display_name only. */
export interface PlaceResult {
  lat: number;
  lng: number;
  display_name: string;
  title?: string;
  subtitle?: string;
  covered?: boolean;
}

/** A place the user can choose as the origin for walking times. */
export interface Place {
  lat: number;
  lng: number;
  display_name: string;
  title: string;
  /** May be empty; then the second line is not shown. */
  subtitle: string;
  /** False gets the "No data" tag. */
  covered: boolean;
}

/** The label splitting from before the API sent a title and a subtitle: at the first comma. */
export function splitDisplayName(displayName: string): { title: string; subtitle: string } {
  const [title, ...rest] = displayName.split(',').map(part => part.trim()).filter(Boolean);
  return { title: title || displayName.trim(), subtitle: rest.join(', ') };
}

export function toPlace(result: PlaceResult): Place {
  const title = typeof result.title === 'string' ? result.title.trim() : '';
  const lines = title
    ? { title, subtitle: typeof result.subtitle === 'string' ? result.subtitle.trim() : '' }
    : splitDisplayName(result.display_name);
  return {
    lat: result.lat,
    lng: result.lng,
    display_name: result.display_name,
    ...lines,
    covered: typeof result.covered === 'boolean' ? result.covered : isPointCovered(result.lat, result.lng),
  };
}

/** A "Cities with scooters" chip chosen as a place; the map flies to the city centre. */
export function placeForCity(city: CoveredCity, locale: AppLocale): Place {
  const country = new Intl.DisplayNames(`${locale}-CH`, { type: 'region' }).of(city.country) ?? city.country;
  return {
    lat: city.center[0],
    lng: city.center[1],
    display_name: `${city.city}, ${country}`,
    title: city.city,
    subtitle: country,
    covered: true,
  };
}

export const MAX_RECENT_PLACES = 3;

function samePlace(a: Place, b: Place): boolean {
  return a.title === b.title && a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);
}

/** Most recent first, each place once, three at most. */
export function withRecentPlace(recent: readonly Place[], place: Place): Place[] {
  return [place, ...recent.filter(other => !samePlace(other, place))].slice(0, MAX_RECENT_PLACES);
}

export interface RecentPlacesStore {
  get: () => readonly Place[];
  add: (place: Place) => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Held in memory only. The privacy notice promises that precise origins are
 * not stored, so recent places must never reach localStorage, sessionStorage,
 * the URL or analytics; they are gone when the page is closed or reloaded.
 */
export function createRecentPlacesStore(): RecentPlacesStore {
  let places: readonly Place[] = [];
  const listeners = new Set<() => void>();
  const set = (next: readonly Place[]) => {
    places = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => places,
    add: place => set(withRecentPlace(places, place)),
    clear: () => { if (places.length > 0) set([]); },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The places chosen since this page was opened. */
export const recentPlaces = createRecentPlacesStore();
