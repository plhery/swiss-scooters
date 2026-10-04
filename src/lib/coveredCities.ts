import { SWISS_SCOOTER_AREAS } from '@/lib/feedCoverage';
import { boundsContainPoint, haversineM } from '@/lib/geo';
import {
  REGIONAL_SCOOTER_CITIES,
  REGIONAL_SCOOTER_SYSTEMS,
  serviceAreas,
  type ScooterCountry,
} from '@/lib/regionalScooterSystems';
import type { MapBounds } from '@/lib/types';

export type CoveredCountry = 'CH' | ScooterCountry;

export interface CoveredCity {
  id: string;
  city: string;
  country: CoveredCountry;
  center: [number, number];
  bounds: MapBounds;
}

export interface NearbyCoveredCity extends CoveredCity {
  distanceM: number;
}

// One entry per city with scooter data. The iOS ScooterCityCatalog is generated
// from the same catalogs (scripts/generate-provider-catalog.mjs) and must match.
export const COVERED_CITIES: CoveredCity[] = [
  ...SWISS_SCOOTER_AREAS.map(area => ({
    id: area.id,
    city: area.city,
    country: 'CH' as const,
    center: [area.center[0], area.center[1]] as [number, number],
    bounds: area.bounds,
  })),
  ...REGIONAL_SCOOTER_CITIES.map(city => ({
    id: city.id,
    city: city.city,
    country: city.country,
    center: city.center,
    bounds: city.bounds,
  })),
];

// The operators' own envelopes rather than the merged city boxes, so a covered
// point always has at least one provider in providersForViewport.
const SERVICE_AREA_BOUNDS: MapBounds[] = [
  ...SWISS_SCOOTER_AREAS.map(area => area.bounds),
  ...REGIONAL_SCOOTER_SYSTEMS.flatMap(system => serviceAreas(system).map(area => area.bounds)),
];

export function isPointCovered(lat: number, lng: number): boolean {
  return SERVICE_AREA_BOUNDS.some(bounds => boundsContainPoint(bounds, lat, lng));
}

/** Covered cities by distance from the point to their centre, nearest first. */
export function nearestCoveredCities(point: [number, number], count: number): NearbyCoveredCity[] {
  return COVERED_CITIES
    .map(city => ({ ...city, distanceM: haversineM(point[0], point[1], city.center[0], city.center[1]) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(0, count));
}
