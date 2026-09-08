import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScooters, independentCollectableFeeds } from './scooterFeeds';
import { upstreamJsonCache } from './upstreamJsonCache';
import { REGIONAL_SCOOTER_SYSTEMS, REGIONAL_SCOOTER_CITIES, searchRegionalScooterCities, serviceAreas } from './regionalScooterSystems';
import { providersForViewport } from './mapCoverage';
import { normalizeParkingLocations } from './parking';
import { buildCityOverview, querySnapshot, type FeedSnapshot } from './scooterSnapshots';
import { boundsContainPoint } from './geo';

const berlin = { south: 52.49, north: 52.55, west: 13.37, east: 13.44 };
const rome = { south: 41.88, north: 41.93, west: 12.46, east: 12.53 };
const response = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => upstreamJsonCache.clear());
afterEach(() => { upstreamJsonCache.clear(); vi.unstubAllGlobals(); });

describe('German and Italian scooter coverage', () => {
  it.each([['Munich', 'München, Germany'], ['Muenchen Deutschland', 'München, Germany'],
    ['Koln', 'Köln, Germany'], ['Rome', 'Roma, Italy'], ['Roma Italia', 'Roma, Italy']])('finds %s', (query, name) => {
    expect(searchRegionalScooterCities(query)[0].display_name).toBe(name);
  });
  it('does not silently ignore a conflicting country or expose the aggregate feed as a city', () => {
    expect(searchRegionalScooterCities('Berlin Italy')).toEqual([]);
    expect(searchRegionalScooterCities('Germany')).toEqual([]);
    expect(searchRegionalScooterCities('Pforzheim')[0].display_name).toBe('Pforzheim, Germany');
    expect(REGIONAL_SCOOTER_CITIES.some(city => city.city === 'Baden-Württemberg')).toBe(false);
  });
  it('keeps reviewed IDs, coordinates and country membership consistent', () => {
    expect(new Set(REGIONAL_SCOOTER_SYSTEMS.map(system => system.id)).size).toBe(REGIONAL_SCOOTER_SYSTEMS.length);
    for (const system of REGIONAL_SCOOTER_SYSTEMS) for (const area of serviceAreas(system)) {
      expect(boundsContainPoint(area.bounds, ...area.center), `${system.id}: ${area.city}`).toBe(true);
      expect(system.id).toContain(`_${system.country.toLowerCase()}_`);
    }
  });
  it.each([
    { id: 'dott_de_berlin', bounds: berlin, country: 'germany', v3: false },
    { id: 'bird_it_rome', bounds: rome, country: 'italy', v3: false },
    { id: 'bolt_de_karlsruhe', bounds: { south: 49, north: 49.02, west: 8.39, east: 8.42 }, country: 'germany', v3: true },
  ])('reads $id without unrelated country requests', async ({ id, bounds, country, v3 }) => {
    const system = REGIONAL_SCOOTER_SYSTEMS.find(system => system.id === id)!;
    const base = new URL('.', system.discoveryUrl).toString();
    const statusName = v3 ? 'vehicle_status' : 'free_bike_status';
    const vehicle = { [v3 ? 'vehicle_id' : 'bike_id']: 'test', vehicle_type_id: 'scooter',
      lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2, current_fuel_percent: 0.72 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === system.discoveryUrl) {
        const feeds = ['vehicle_types', statusName].map(name => ({ name, url: `${base}${name}.json` }));
        return response({ data: v3 ? { feeds } : { en: { feeds } } });
      }
      if (url === `${base}vehicle_types.json`) return response({ data: { vehicle_types: [
        { vehicle_type_id: 'scooter', form_factor: v3 ? 'scooter_standing' : 'scooter', propulsion_type: 'electric' },
        { vehicle_type_id: 'bike', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
      ] } });
      if (url === `${base}${statusName}.json`) return response({ last_updated: v3 ? new Date().toISOString() : Date.now() / 1000,
        data: { [v3 ? 'vehicles' : 'bikes']: [vehicle, { ...vehicle, vehicle_type_id: 'bike' },
          { ...vehicle, is_reserved: true }, { ...vehicle, lat: 0 }] } });
      throw new Error(`Unexpected upstream ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchScooters({ bounds, minBattery: 50, providers: new Set([system.provider]) });
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]).toMatchObject({ provider: system.provider, battery: 72 });
    expect(result.meta.sources).toEqual({ national: 'skipped', hopp: 'skipped', publibike: 'skipped',
      france: 'skipped', germany: 'skipped', italy: 'skipped', [country]: 'fresh' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('collects multi-city feeds once and skips the empty space between their service areas', async () => {
    const definitions = independentCollectableFeeds().filter(feed => feed.id === 'germany:lime_de_bw');
    expect(definitions).toHaveLength(1);
    expect(definitions[0].coverage).toHaveLength(2);
    vi.stubGlobal('fetch', vi.fn());
    const gap = { south: 48.19, north: 48.21, west: 9.16, east: 9.19 };
    expect(providersForViewport(gap)).not.toContain('lime');
    expect((await fetchScooters({ bounds: gap, minBattery: 0, providers: new Set(['lime']) })).vehicles).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the local language for German and Italian parking', () => {
    for (const id of ['dott_de_berlin', 'bird_it_rome']) {
      const system = REGIONAL_SCOOTER_SYSTEMS.find(system => system.id === id)!;
      const language = system.country.toLowerCase();
      const locations = normalizeParkingLocations(system, { data: { vehicle_types: [
        { vehicle_type_id: 's', form_factor: 'scooter_standing', propulsion_type: 'electric' },
      ] } }, { data: { stations: [{ station_id: 'bay', is_virtual_station: true,
        lat: system.center[0], lon: system.center[1], name: [{ language: 'fr', text: 'Français' }, { language, text: 'Local' }] }] } }, {});
      expect(locations[0].name).toBe('Local');
    }
  });
  it('keeps country totals, provider filters and parking correct at different zooms', () => {
    const now = Date.now();
    const feeds = ['dott_de_berlin', 'bird_it_rome'].map(id => {
      const system = REGIONAL_SCOOTER_SYSTEMS.find(system => system.id === id)!;
      return { id, source: system.country === 'DE' ? 'germany' : 'italy', provider: system.provider, coverage: [system.bounds],
        observedAt: now, attemptedAt: now, stale: false, failed: false, skipped: false,
        vehicles: [{ provider: system.provider, vehicle_id: id, lat: system.center[0], lng: system.center[1],
          battery: null, range_m: null, distance_m: null, deep_link: null }],
        parking: { observedAt: now, stale: false, locations: [{ id: `${id}:bay`, provider: system.provider, name: 'Bay',
          lat: system.center[0], lng: system.center[1], mandatory: true }] },
      } as FeedSnapshot;
    });
    const snapshot = { version: 1 as const, feeds, updatedAt: now, overview: buildCityOverview(feeds, now) };
    for (const bounds of [berlin, rome]) {
      const query = { bounds, minBattery: 0 };
      const overview = querySnapshot(snapshot, query, 8, now);
      expect(overview.meta.totalVehicles).toBe(1);
      expect(overview.clusters).toHaveLength(1);
      expect(overview.parking).toBeUndefined();
      expect(overview.meta.sources.national).toBe('skipped');
      expect(overview.meta.sources.france).toBe('skipped');
      const detail = querySnapshot(snapshot, { ...query, minBattery: 100 }, 16, now);
      expect(detail.vehicles).toEqual([]);
      expect(detail.parking).toHaveLength(1);
      expect(detail.meta.availableProviders).not.toContain('publibike');
    }
  });
});
