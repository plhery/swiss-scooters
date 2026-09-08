import { boundsIntersect } from '@/lib/geo';
import type { MapBounds } from '@/lib/types';
import { REGIONAL_SCOOTER_SYSTEMS, serviceAreas } from '@/lib/regionalScooterSystems';
import swissAreas from '../../data/swiss-scooter-areas.json';

// The Swiss registry is queried only within this padded national envelope.
export const SWISS_MOBILITY_BOUNDS: MapBounds = {
  south: 45.70,
  west: 5.70,
  north: 47.95,
  east: 10.75,
};

export const MOBILITY_COVERAGE = [
  SWISS_MOBILITY_BOUNDS,
  ...REGIONAL_SCOOTER_SYSTEMS.flatMap(system => serviceAreas(system).map(area => area.bounds)),
];

// Bound world-level queries while retaining all reviewed countries.
export const SUPPORTED_MOBILITY_BOUNDS: MapBounds = {
  south: Math.min(...MOBILITY_COVERAGE.map(bounds => bounds.south)),
  west: Math.min(...MOBILITY_COVERAGE.map(bounds => bounds.west)),
  north: Math.max(...MOBILITY_COVERAGE.map(bounds => bounds.north)),
  east: Math.max(...MOBILITY_COVERAGE.map(bounds => bounds.east)),
};

/**
 * Conservative operating-area envelopes used before downloading live vehicle
 * feeds. They intentionally extend beyond municipal borders so scooters near a
 * service-area edge are not missed.
 *
 * Unknown systems are not rejected from this table: scooterFeeds falls back to
 * sharedmobility.ch's spatial API for those systems.
 */
export const SWISS_SCOOTER_AREAS = swissAreas;
const AREA_BOUNDS: Record<string, MapBounds> = Object.fromEntries(
  swissAreas.map(area => [area.id.slice(3), area.bounds])
);

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
