import type { RegionalScooterSystem } from './regionalScooterSystems';
import { discoveryFeedEntries, discoveredFeedUrl, fetchJson } from './scooterFeeds';
import { filterReturningParking, normalizeParkingLocations,
  type ParkingStationsFeed, type ParkingStatusFeed, type ParkingTypesFeed, type ParkingZonesFeed } from './parking';
import type { ParkingLocation } from './types';
import { fetchLilleParking } from './lilleParking';

const normalized = new Map<string, { information: ParkingStationsFeed; types: ParkingTypesFeed;
  zones: ParkingZonesFeed; hour: number; locations: ParkingLocation[] }>();

export async function fetchRegionalParking(system: RegionalScooterSystem) {
  if (system.id === 'lime_fr_lille') return fetchLilleParking(system);
  const discovery = await fetchJson<Parameters<typeof discoveryFeedEntries>[0]>(system.discoveryUrl, { revalidate: 3600 });
  const entries = discoveryFeedEntries(discovery.data);
  const base = new URL('.', system.discoveryUrl).toString();
  const informationUrl = discoveredFeedUrl(entries, 'station_information', base);
  const typesUrl = discoveredFeedUrl(entries, 'vehicle_types', base);
  if (!informationUrl || !typesUrl) return { locations: [], stale: discovery.stale };
  const zonesUrl = discoveredFeedUrl(entries, 'geofencing_zones', base);
  const [information, types, zones] = await Promise.all([
    fetchJson<ParkingStationsFeed>(informationUrl, { revalidate: 3600 }),
    fetchJson<ParkingTypesFeed>(typesUrl, { revalidate: 3600 }),
    zonesUrl ? fetchJson<ParkingZonesFeed>(zonesUrl, { revalidate: 3600 }) : { data: {}, stale: false },
  ]);
  if (!Array.isArray(information.data.data?.stations) || !Array.isArray(types.data.data?.vehicle_types)) throw new Error('Invalid parking metadata');
  const hour = Math.floor(Date.now() / 3600_000);
  let cached = normalized.get(system.id);
  if (!cached || cached.information !== information.data || cached.types !== types.data || cached.zones !== zones.data || cached.hour !== hour) {
    cached = { information: information.data, types: types.data, zones: zones.data, hour,
      locations: normalizeParkingLocations(system, types.data, information.data, zones.data) };
    normalized.set(system.id, cached);
  }
  const statusUrl = discoveredFeedUrl(entries, 'station_status', base);
  const status = statusUrl && cached.locations.length
    ? await fetchJson<ParkingStatusFeed>(statusUrl, { revalidate: 30 }) : { data: {}, stale: false };
  if (statusUrl && cached.locations.length && !Array.isArray(status.data.data?.stations)) throw new Error('Invalid parking status');
  if (statusUrl && cached.locations.length) {
    const updatedAt = typeof status.data.last_updated === 'number' ? status.data.last_updated * 1000
      : Date.parse(status.data.last_updated ?? '');
    const age = Date.now() - updatedAt;
    if (!Number.isFinite(updatedAt) || age > 900_000 || age < -300_000) throw new Error('Parking status timestamp is missing or out of date');
  }
  return { locations: filterReturningParking(cached.locations, status.data),
    stale: discovery.stale || information.stale || types.stale || zones.stale || status.stale };
}
