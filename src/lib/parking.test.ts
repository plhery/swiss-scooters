import { describe, expect, it } from 'vitest';
import { filterReturningParking, normalizeParkingLocations, type ParkingZonesFeed } from './parking';
import { FRENCH_SCOOTER_SYSTEMS } from './frenchScooterSystems';
const system = FRENCH_SCOOTER_SYSTEMS.find(s => s.id === 'dott_fr_lyon')!;
const types = { data: { vehicle_types: [
  { vehicle_type_id: 'scooter', form_factor: 'scooter_standing', propulsion_type: 'electric' },
  { vehicle_type_id: 'bike', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
] } };
const station = { station_id: 'bay', name: 'Bay', lat: 45.75, lon: 4.85, is_virtual_station: true };
const square = [[4.8, 45.7], [4.9, 45.7], [4.9, 45.8], [4.8, 45.8], [4.8, 45.7]];
const zone = { geometry: { type: 'MultiPolygon', coordinates: [[square]] }, properties: {
  rules: [{ vehicle_type_id: ['scooter'], station_parking: true }],
} };
const zones: ParkingZonesFeed = { data: { geofencing_zones: { features: [zone] } } };
const normalize = (stations = [station], fencing = zones) => normalizeParkingLocations(system, types, { data: { stations } }, fencing);

describe('published scooter parking', () => {
  it('supports GBFS 2.3 scooter rules and GBFS 3 names and types', () => {
    expect(normalize()[0]).toMatchObject({ provider: 'dott', lat: 45.75, mandatory: true });
    const result = normalizeParkingLocations(system, types, { data: { stations: [{ ...station,
      name: [{ language: 'en', text: 'Bay' }, { language: 'fr', text: 'Place_de_la_Mairie' }] }] } }, zones);
    expect(result[0].name).toBe('Place de la Mairie');
  });
  it('ignores bike-only bays, synthetic city stations and invalid coordinates', () => {
    const stations = [station, { ...station, station_id: 'bike', vehicle_capacity: { bike: 10 } },
      { ...station, station_id: 'city', is_virtual_station: false },
      { ...station, station_id: 'invalid', lat: NaN }, { ...station, station_id: 'foreign', lat: 47.4 }];
    expect(normalize(stations).map(x => x.id)).toEqual(['dott_fr_lyon:bay']);
  });
  it('honors polygon holes, rule order, type restrictions and global rules', () => {
    const hole = [[4.84,45.74],[4.86,45.74],[4.86,45.76],[4.84,45.76],[4.84,45.74]];
    expect(normalize([station], { data: { geofencing_zones: { features: [
      { ...zone, geometry: { type: 'Polygon', coordinates: [square, hole] } },
    ] } } })[0].mandatory).toBe(false);
    expect(normalize([station], { data: { geofencing_zones: { features: [
      { ...zone, properties: { rules: [{ vehicle_type_id: ['scooter'], station_parking: false }] } }, zone,
    ] } } })[0].mandatory).toBe(false);
    expect(normalize([station], { data: { global_rules: [{ vehicle_type_ids: ['bike'], station_parking: true }] } })[0].mandatory).toBe(false);
    expect(normalize([station], { data: { global_rules: [{ vehicle_type_ids: ['scooter'], station_parking: true }] } })[0].mandatory).toBe(true);
  });
  it('ignores expired and future mandatory zones', () => {
    for (const time of [{ end: 1 }, { start: '2099-01-01T00:00:00Z' }]) {
      expect(normalize([station], { data: { geofencing_zones: { features: [{ ...zone,
        properties: { ...zone.properties, ...time } }] } } })[0].mandatory).toBe(false);
    }
  });
  it('keeps empty virtual parking bays and removes locations where returns are disabled', () => {
    const locations = normalize([station, { ...station, station_id: 'closed' }]);
    const usable = filterReturningParking(locations, { data: { stations: [
      { station_id: 'bay', is_installed: false, is_returning: true },
      { station_id: 'closed', is_returning: false },
    ] } });
    expect(usable).toHaveLength(1);
    expect(usable[0].id).toBe('dott_fr_lyon:bay');
  });
  it('deduplicates IDs and does not infer mandatory parking without a published rule', () => {
    expect(normalize([station, station], {})).toHaveLength(1);
    expect(normalize([station], {})[0].mandatory).toBe(false);
  });
});
