import { describe, expect, it } from 'vitest';
import { buildCityOverview, overviewNeedsRefresh, querySnapshot, VEHICLE_MAX_AGE_MS, type FeedSnapshot, type MobilitySnapshot } from './scooterSnapshots';
import { ScooterFeedsUnavailableError } from './scooterFeeds';
import { providersForViewport, mapRepresentationsMatch } from './mapCoverage';
import type { Vehicle } from './types';
import { scooterDataHealthNotice } from './dataHealth';

const now = Date.parse('2026-09-08T12:00:00Z');
const lyon = { south: 45.70, west: 4.7, north: 45.9, east: 5.0 };
const zurich = { south: 47.27, west: 8.34, north: 47.49, east: 8.73 };
const vehicle = (id: string, battery: number | null = 80): Vehicle => ({
  vehicle_id: id, lat: 45.75, lng: 4.85, provider: 'dott', battery,
  range_m: null, distance_m: null, deep_link: null,
});
const feed = (values: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  id: 'france:dott_fr_lyon', source: 'france', provider: 'dott', coverage: [lyon],
  observedAt: now, attemptedAt: now, vehicles: [vehicle('one'), vehicle('two', null)],
  stale: false, failed: false, skipped: false, ...values,
});
const snapshot = (feeds: FeedSnapshot[]): MobilitySnapshot => ({
  version: 1, updatedAt: now, feeds, overview: buildCityOverview(feeds, now),
});
const query = { bounds: lyon, minBattery: 0 };

describe('persistent map snapshots', () => {
  it('refreshes incomplete startup city counts as failed feeds recover', () => {
    const unavailable = feed({ observedAt: 0, failed: true, stale: true, vehicles: [] });
    const initial = snapshot([unavailable]);
    expect(overviewNeedsRefresh(initial, [unavailable], now)).toBe(false);
    const healthy = feed();
    expect(overviewNeedsRefresh(initial, [healthy], now)).toBe(true);
    const refreshed = { ...initial, feeds: [healthy], overview: buildCityOverview([healthy], now) };
    expect(querySnapshot(refreshed, { bounds: lyon, minBattery: 0 }, 8, now).meta.totalVehicles).toBe(2);
    expect(overviewNeedsRefresh(refreshed, [healthy], now + 60_000)).toBe(false);
  });

  it('returns empty coverage without needing live or even fresh cached feeds', () => {
    const response = querySnapshot(snapshot([feed({ observedAt: 0 })]), { ...query, outsideCoverage: true }, 16, now);
    expect(response.vehicles).toEqual([]);
    expect(response.meta.partial).toBe(false);
    expect(Object.values(response.meta.sources)).toEqual(Array(6).fill('skipped'));
  });

  it('does not involve Swiss feed health in a French city response', () => {
    const response = querySnapshot(snapshot([feed(), feed({ id: 'hopp', source: 'hopp', provider: 'hopp', coverage: [zurich], failed: true, observedAt: 0 })]), query, 16, now);
    expect(response.vehicles).toHaveLength(2);
    expect(response.meta.sources.national).toBe('skipped');
    expect(response.meta.sources.hopp).toBe('skipped');
    expect(response.meta.sources.publibike).toBe('skipped');
    expect(response.meta.partial).toBe(false);
    expect(response.meta.availableProviders).toEqual(['dott']);
  });

  it('uses hourly city totals, keeps battery counts accurate, and never exposes old individual locations', () => {
    const cached = snapshot([feed()]);
    // Live vehicles change while the saved hourly overview remains stable.
    cached.feeds[0].vehicles = [];
    const all = querySnapshot(cached, query, 8, now + 30 * 60_000);
    expect(all.vehicles).toEqual([]);
    expect(all.clusters).toHaveLength(1);
    expect(all.clusters[0]).toMatchObject({ city: 'Lyon', count: 2 });
    expect(all.meta).toMatchObject({ overview: true, refreshAfterSeconds: 3600, stale: false });
    const charged = querySnapshot(cached, { ...query, minBattery: 50 }, 9, now);
    expect(charged.clusters[0].count).toBe(1);
    expect(querySnapshot(cached, { ...query, providers: new Set(['pony']) }, 9, now).clusters).toEqual([]);
  });

  it('preserves a recent failing feed but stops offering its vehicles after five minutes', () => {
    const cached = snapshot([feed({ failed: true, stale: true })]);
    const response = querySnapshot(cached, query, 16, now + 60_000);
    expect(response.vehicles).toHaveLength(2);
    expect(response.meta).toMatchObject({ partial: true, stale: true });
    expect(() => querySnapshot(cached, query, 16, now + VEHICLE_MAX_AGE_MS + 1)).toThrow(ScooterFeedsUnavailableError);
  });

  it('reports an unavailable provider without calling a successfully collected four-minute observation cached', () => {
    const cached = snapshot([
      feed({ observedAt: now - 240_000 }),
      feed({ id: 'france:voi', provider: 'voi', observedAt: now - 600_000, failed: true, stale: true }),
    ]);
    const response = querySnapshot(cached, query, null, now);
    expect(response.vehicles).toHaveLength(2);
    expect(response.meta).toMatchObject({ partial: true, stale: false,
      failedSources: ['france:voi'], expiresAt: new Date(now + 60_000).toISOString() });
    expect(scooterDataHealthNotice(response.meta, response.vehicles.length)).toBe('Some providers unavailable');
    expect(() => querySnapshot(cached, query, 16, now + 60_001)).toThrow(ScooterFeedsUnavailableError);
  });

  it('does not confuse an empty operating area with an upstream failure', () => {
    const response = querySnapshot(snapshot([feed({ vehicles: [] })]), query, 16, now);
    expect(response.meta).toMatchObject({ totalVehicles: 0, partial: false });
  });

  it('deduplicates overlapping feeds and returns only vehicles inside the requested map', () => {
    const response = querySnapshot(snapshot([feed(), feed({ id: 'duplicate', vehicles: [vehicle('one'), { ...vehicle('far'), lng: 5.5 }] })]), query, 16, now);
    expect(response.vehicles).toHaveLength(2);
    expect(response.providers).toEqual({ dott: 2 });
  });

  it('expires city totals instead of silently serving abandoned snapshots', () => {
    expect(() => querySnapshot(snapshot([feed()]), query, 8, now + 4 * 3600_000)).toThrow(ScooterFeedsUnavailableError);
  });

  it('reports unavailable city counts when every relevant feed failed before the overview was built', () => {
    expect(() => querySnapshot(snapshot([feed({ observedAt: 0, failed: true, vehicles: [] })]), query, 8, now)).toThrow(ScooterFeedsUnavailableError);
  });
});

describe('map coverage and zoom tiers', () => {
  it('hides Swiss providers in Lyon, Marseille and empty French countryside', () => {
    expect(providersForViewport(lyon)).toEqual(['dott']);
    expect(providersForViewport({ south: 43.2, west: 5.3, north: 43.4, east: 5.5 })).toEqual(['lime', 'voi']);
    expect(providersForViewport({ south: 43, west: 1, north: 43.1, east: 1.1 })).toEqual([]);
    expect(providersForViewport(zurich)).toContain('publibike');
  });

  it('reuses city totals across overview zooms and live vehicles across street zooms', () => {
    expect(mapRepresentationsMatch(5, 10)).toBe(true);
    expect(mapRepresentationsMatch(10, 11)).toBe(false);
    expect(mapRepresentationsMatch(12, 13)).toBe(false);
    expect(mapRepresentationsMatch(16, 19)).toBe(true);
  });
});

it('returns parking only at street zoom, separately from scooter counts and battery filters', () => {
  const location = { id: 'dott_fr_lyon:bay', name: 'Bay', provider: 'dott', lat: 45.75, lng: 4.85, mandatory: true };
  const cached = snapshot([feed({ parking: { locations: [location, { ...location, id: 'outside', lat: 47 }], observedAt: now, stale: false } })]);
  const street = querySnapshot(cached, { ...query, minBattery: 100 }, 16, now);
  expect(street.vehicles).toEqual([]);
  expect(street.parking).toEqual([location]);
  expect(street.meta.totalVehicles).toBe(0);
  expect(street.meta.parkingStatus).toBe('fresh');
  expect(querySnapshot(cached, query, 15, now).parking).toBeUndefined();
  expect(querySnapshot(cached, { ...query, providers: new Set(['voi']) }, 16, now).parking).toEqual([]);
  cached.feeds[0].parking!.observedAt = now - VEHICLE_MAX_AGE_MS - 1;
  const expired = querySnapshot(cached, query, 16, now);
  expect(expired.parking).toEqual([]);
  expect(expired.meta.parkingStatus).toBe('failed');
  expect(expired.vehicles).toHaveLength(2);
});
