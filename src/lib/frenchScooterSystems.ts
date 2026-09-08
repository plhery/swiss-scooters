import catalog from '../../data/french-scooter-feeds.json';
import type { ProviderKey } from '@/generated/providers';
import type { MapBounds } from '@/lib/types';

export interface FrenchScooterSystem {
  id: string;
  provider: ProviderKey;
  city: string;
  center: [number, number];
  bounds: MapBounds;
  discoveryUrl: string;
}

// Reviewed public endpoints, not a runtime download of the global registry.
// Bounds include padding around the published service areas; see DATA_SOURCES.md.
export const FRENCH_SCOOTER_SYSTEMS = catalog.systems as FrenchScooterSystem[];

function normalizeCity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** City navigation supplements Swiss address search without another geocoder. */
export function searchFrenchScooterCities(query: string) {
  const words = normalizeCity(query).split(' ').filter(word => word !== 'france');
  if (words.join('').length < 2) return [];

  const cities = new Map(FRENCH_SCOOTER_SYSTEMS.map(system => [system.city, system]));
  return [...cities.values()]
    .filter(system => {
      const cityWords = normalizeCity(system.city).split(' ');
      return words.every(word => cityWords.some(cityWord => cityWord.startsWith(word)));
    })
    .sort((a, b) => a.city.localeCompare(b.city, 'fr'))
    .slice(0, 5)
    .map(system => ({
      lat: system.center[0],
      lng: system.center[1],
      display_name: `${system.city}, France`,
    }));
}
