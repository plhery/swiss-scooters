import { haversineM } from '@/lib/geo';
import type { TranslationKey } from '@/lib/i18n';

// A straight line at an easy pace: the same estimate as the iOS app.
const WALKING_METERS_PER_MINUTE = 80;

/** The walk from the origin (your location or a searched place) to a scooter or a parking bay. */
export interface WalkEstimate {
  distanceM: number;
  /** The searched place the walk starts from; null when it starts from your location. */
  place: string | null;
}

/** Where walking times are measured from. A searched place wins over your location until it is cleared. */
export interface WalkOrigin {
  point: [number, number];
  /** The title of the searched place; null for your location. */
  place: string | null;
}

export function walkingMinutes(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / WALKING_METERS_PER_MINUTE));
}

export function walkEstimate(origin: WalkOrigin | null, lat: number, lng: number): WalkEstimate | null {
  if (!origin) return null;
  return { distanceM: haversineM(origin.point[0], origin.point[1], lat, lng), place: origin.place };
}

/** Walking directions to a scooter or a parking bay; the link carries the destination only. */
export function walkingDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=walking`;
}

interface DistanceFormatter {
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

/** "320 m" below a kilometre; "1.4 km" and "24 km" from there. */
export function formatDistance(meters: number, { t, formatNumber }: DistanceFormatter): string {
  return meters < 1000
    ? t('distance.meters', { count: formatNumber(Math.round(meters)) })
    : t('distance.kilometers', { count: formatNumber(meters / 1000, { maximumFractionDigits: 1 }) });
}
