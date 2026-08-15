import { boundsIntersect } from '@/lib/geo';
import type { MapBounds } from '@/lib/types';

// All upstream systems in this application are Swiss. Clamp very wide map
// views to this padded national envelope so country and Europe-level zooms do
// bounded work without rejecting a legitimate whole-Switzerland request.
export const SWISS_MOBILITY_BOUNDS: MapBounds = {
  south: 45.70,
  west: 5.70,
  north: 47.95,
  east: 10.75,
};

/**
 * Conservative operating-area envelopes used before downloading live vehicle
 * feeds. They intentionally extend beyond municipal borders so scooters near a
 * service-area edge are not missed.
 *
 * Unknown systems are not rejected from this table: scooterFeeds falls back to
 * sharedmobility.ch's spatial API for those systems.
 */
const AREA_BOUNDS: Record<string, MapBounds> = {
  basel: { south: 47.42, west: 7.38, north: 47.70, east: 7.82 },
  bern: { south: 46.82, west: 7.20, north: 47.08, east: 7.70 },
  biel: { south: 47.03, west: 7.05, north: 47.27, east: 7.45 },
  bulle: { south: 46.50, west: 6.82, north: 46.70, east: 7.12 },
  frauenfeld: { south: 47.45, west: 8.72, north: 47.68, east: 9.10 },
  grenchen: { south: 47.08, west: 7.28, north: 47.28, east: 7.52 },
  'illnau-effretikon': { south: 47.33, west: 8.58, north: 47.55, east: 8.88 },
  kloten: { south: 47.40, west: 8.47, north: 47.56, east: 8.74 },
  locarno: { south: 46.10, west: 8.67, north: 46.25, east: 8.90 },
  nyon: { south: 46.25, west: 6.05, north: 46.55, east: 6.45 },
  opfikon: { south: 47.39, west: 8.47, north: 47.50, east: 8.68 },
  romanshorn: { south: 47.45, west: 9.20, north: 47.66, east: 9.58 },
  rorschach: { south: 47.36, west: 9.30, north: 47.58, east: 9.68 },
  schaffhausen: { south: 47.60, west: 8.42, north: 47.83, east: 8.88 },
  'st-gallen': { south: 47.28, west: 9.10, north: 47.60, east: 9.65 },
  uster: { south: 47.25, west: 8.58, north: 47.43, east: 8.86 },
  wetzikon: { south: 47.20, west: 8.68, north: 47.40, east: 8.98 },
  winterthur: { south: 47.38, west: 8.53, north: 47.64, east: 8.97 },
  zug: { south: 47.03, west: 8.32, north: 47.31, east: 8.74 },
  zurich: { south: 47.27, west: 8.34, north: 47.49, east: 8.73 },
};

const SYSTEM_SUFFIXES = [
  'illnau-effretikon',
  'st-gallen',
  'schaffhausen',
  'winterthur',
  'romanshorn',
  'rorschach',
  'frauenfeld',
  'wetzikon',
  'opfikon',
  'grenchen',
  'zurich',
  'basel',
  'kloten',
  'bulle',
  'uster',
  'nyon',
  'biel',
  'bern',
  'zug',
] as const;

const REGION_ALIASES: Record<string, string[]> = {
  'biel-bienne': ['biel'],
  'biel-bienne-bern': ['biel', 'bern'],
  'locarnese-bellinzonese': ['locarno'],
  ticino: ['locarno'],
};

export interface RegionCoverage {
  bounds: MapBounds[];
  complete: boolean;
}

function areaName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function areasForName(value: string): string[] {
  const normalized = areaName(value);
  return REGION_ALIASES[normalized] ?? [normalized];
}

export function knownSystemCoverage(systemId: string): MapBounds[] | null {
  const id = systemId.toLowerCase();

  // Velospot does not publish geofencing and its e-scooters are currently
  // confined to Biel and Locarno even though its bicycle network is national.
  // The spatial API does not expose those scooters reliably, so retain these
  // conservative envelopes until upstream adds mode-aware regions.
  if (id === 'velospot') {
    return [AREA_BOUNDS.biel, AREA_BOUNDS.locarno];
  }

  // These systems span several regions or do not identify a city in their ID.
  // Their coverage is resolved from system_regions or the spatial API instead.
  if (id === 'voiscooters.com' || id === 'publibike') {
    return null;
  }

  const suffix = SYSTEM_SUFFIXES.find(area => (
    id.endsWith(`_${area}`) || id.endsWith(`-${area}`)
  ));
  return suffix ? [AREA_BOUNDS[suffix]] : null;
}

export function coverageForRegionNames(names: string[]): RegionCoverage {
  const resolved: MapBounds[] = [];
  let complete = names.length > 0;

  for (const name of names) {
    const areas = areasForName(name);
    const matches = areas.map(area => AREA_BOUNDS[area]).filter(Boolean);
    if (matches.length !== areas.length) complete = false;
    resolved.push(...matches);
  }

  return { bounds: resolved, complete };
}

export function coverageIntersects(bounds: MapBounds[], query: MapBounds): boolean {
  return bounds.some(coverage => boundsIntersect(coverage, query));
}

export const HOPP_COVERAGE = AREA_BOUNDS.zurich;
export const PUBLIBIKE_FREE_FLOATING_COVERAGE = AREA_BOUNDS.zurich;
