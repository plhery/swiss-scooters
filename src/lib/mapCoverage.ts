import { REGIONAL_SCOOTER_SYSTEMS, serviceAreas } from '@/lib/regionalScooterSystems';
import { SWISS_SCOOTER_AREAS } from '@/lib/feedCoverage';
import { boundsIntersect } from '@/lib/geo';
import { PROVIDER_KEYS } from '@/generated/providers';
import type { MapBounds } from '@/lib/types';

export const CITY_OVERVIEW_MAX_ZOOM = 10;

// Independent of counts and saved filters: empty batteries or a temporary
// outage must not make a provider switch disappear.
export function providersForViewport(bounds: MapBounds): string[] {
  const providers = new Set<string>();
  if (SWISS_SCOOTER_AREAS.some(area => boundsIntersect(area.bounds, bounds))) {
    for (const key of PROVIDER_KEYS) if (key !== 'pony') providers.add(key);
  }
  for (const system of REGIONAL_SCOOTER_SYSTEMS) {
    if (serviceAreas(system).some(area => boundsIntersect(area.bounds, bounds))) providers.add(system.provider);
  }
  return PROVIDER_KEYS.filter(key => providers.has(key));
}

export function mapRepresentationsMatch(a: number, b: number): boolean {
  return (a <= CITY_OVERVIEW_MAX_ZOOM && b <= CITY_OVERVIEW_MAX_ZOOM) ||
    (a > 15 && b > 15) || a === b;
}
