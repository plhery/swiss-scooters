import type { CollectableScooterFeed } from '../src/lib/scooterFeeds';
import type { FeedSnapshot } from '../src/lib/scooterSnapshots';
import type { ParkingSnapshot } from '../src/lib/parking';

export async function collectSnapshotFeed(
  definition: CollectableScooterFeed,
  old: FeedSnapshot | undefined,
  publish: (record: FeedSnapshot) => void,
  collectParking?: () => Promise<ParkingSnapshot>,
) {
  const base = { id: definition.id, source: definition.source, provider: definition.provider, coverage: definition.coverage };
  let record: FeedSnapshot;
  try {
    const result = await definition.collect();
    record = { ...base, vehicles: result.vehicles, observedAt: result.observedAt ?? Date.now(),
      attemptedAt: Date.now(), stale: result.stale, failed: false, skipped: result.skipped ?? false,
      parking: old?.parking };
  } catch (error) {
    record = { ...base, vehicles: old?.vehicles ?? [], observedAt: old?.observedAt ?? 0,
      attemptedAt: Date.now(), stale: true, failed: true, skipped: false, parking: old?.parking };
    console.warn(JSON.stringify({ event: 'snapshot_feed_failed', feed: definition.id,
      error: error instanceof Error ? error.message : String(error) }));
  }
  publish(record);
  if (!collectParking) return;
  try {
    record = { ...record, parking: await collectParking() };
  } catch (error) {
    record = { ...record, parking: old?.parking ? { ...old.parking, stale: true } : undefined };
    console.warn(JSON.stringify({ event: 'parking_feed_failed', feed: definition.id,
      error: error instanceof Error ? error.message : String(error) }));
  }
  publish(record);
}
