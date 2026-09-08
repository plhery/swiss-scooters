import { expect, it } from 'vitest';
import { collectSnapshotFeed } from './collectFeed';
import { buildCityOverview, querySnapshot, type FeedSnapshot } from '../src/lib/scooterSnapshots';
import type { ParkingSnapshot } from '../src/lib/parking';

it('publishes fresh status despite stale metadata before optional parking completes', async () => {
  const now = Date.now();
  const bounds = { south: 47.3, west: 8.4, north: 47.5, east: 8.7 };
  const vehicle = { provider: 'lime', vehicle_id: 'live', lat: 47.377, lng: 8.542,
    battery: 80, range_m: null, distance_m: null, deep_link: null };
  const definition = { id: 'national:lime_zurich', provider: 'lime' as const, source: 'national' as const,
    host: 'test', coverage: [bounds], collect: async () => ({ vehicles: [vehicle], observedAt: now, stale: true }) };
  const old: FeedSnapshot = { ...definition, vehicles: [], observedAt: now - 360_000, attemptedAt: now - 360_000,
    failed: false, skipped: false, stale: false };
  let finishParking!: (result: ParkingSnapshot) => void;
  const published: FeedSnapshot[] = [];
  const pending = collectSnapshotFeed(definition, old, record => published.push(record),
    () => new Promise(resolve => { finishParking = resolve; }));
  await Promise.resolve();
  expect(published).toHaveLength(1);
  expect(published[0].observedAt).toBe(now);
  const response = querySnapshot({ version: 1, updatedAt: now, feeds: published, overview: buildCityOverview(published, now) },
    { bounds, minBattery: 0 }, 16, now);
  expect(response.vehicles).toEqual([vehicle]);
  expect(response.meta.stale).toBe(true);
  finishParking({ locations: [], observedAt: now, stale: false });
  await pending;
  expect(published).toHaveLength(2);
});
