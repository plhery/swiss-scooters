import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { discoverCollectableFeeds, independentCollectableFeeds, type CollectableScooterFeed } from '../src/lib/scooterFeeds';
import { buildCityOverview, overviewNeedsRefresh, type FeedSnapshot, type MobilitySnapshot } from '../src/lib/scooterSnapshots';
import { REGIONAL_SCOOTER_SYSTEMS, regionalSource } from '../src/lib/regionalScooterSystems';
import { upstreamJsonCache } from '../src/lib/upstreamJsonCache';
import { fetchRegionalParking } from '../src/lib/parkingFeeds';
import { FeedScheduler } from './feedScheduler';
import { createSnapshotServer } from './snapshotServer';
import { collectSnapshotFeed } from './collectFeed';

upstreamJsonCache.paceHost('gbfs.api.ridedott.com', 150);
const snapshotPath = process.env.SCOOTER_SNAPSHOT_PATH ?? '/data/scooters.json';
let snapshot: MobilitySnapshot | undefined;
let stopping = false;
let dirty = false;
let persisting: Promise<void> | undefined;
let lastHealthLogAt = 0;
const records = new Map<string, FeedSnapshot>();
const regionalSystems = new Map(REGIONAL_SCOOTER_SYSTEMS.map(system => [`${regionalSource(system)}:${system.id}`, system]));

// Validate configuration before doing any network collection.
const server = createSnapshotServer({ snapshot: () => snapshot,
  token: process.env.SCOOTER_SNAPSHOT_API_TOKEN, production: process.env.NODE_ENV === 'production',
  version: process.env.SOURCE_COMMIT });
try {
  const persisted = JSON.parse(await readFile(snapshotPath, 'utf8')) as MobilitySnapshot;
  if (persisted.version === 1 && Array.isArray(persisted.feeds) && Array.isArray(persisted.overview?.cities)) {
    snapshot = persisted;
    for (const feed of persisted.feeds) records.set(feed.id, feed);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Snapshot restore failed', error);
}

function publish() {
  const now = Date.now();
  const feeds = [...records.values()];
  snapshot = { version: 1, updatedAt: now, feeds,
    overview: snapshot?.overview ?? buildCityOverview(feeds, now) };
  dirty = true;
}

async function collect(definition: CollectableScooterFeed) {
  const system = regionalSystems.get(definition.id);
  await collectSnapshotFeed(definition, records.get(definition.id), record => {
    // Removed definitions may still have requests finishing in the background.
    if (stopping || !records.has(definition.id)) return;
    records.set(definition.id, record);
    publish();
  }, system ? () => fetchRegionalParking(system) : undefined);
}
const scheduler = new FeedScheduler(collect);

function setDefinitions(definitions: CollectableScooterFeed[], retireMissing: boolean) {
  if (retireMissing) {
    const active = new Set(definitions.map(feed => feed.id));
    for (const id of records.keys()) if (!active.has(id)) records.delete(id);
  }
  for (const definition of definitions) if (!records.has(definition.id)) {
    records.set(definition.id, { id: definition.id, source: definition.source, provider: definition.provider,
      coverage: definition.coverage, vehicles: [], observedAt: 0, attemptedAt: 0,
      stale: true, failed: true, skipped: false });
  }
  publish();
  scheduler.setFeeds(definitions);
}

async function persist() {
  if (persisting) return persisting;
  if (!snapshot || !dirty) return;
  dirty = false;
  if (overviewNeedsRefresh(snapshot, snapshot.feeds, Date.now())) {
    snapshot = { ...snapshot, overview: buildCityOverview(snapshot.feeds, Date.now()) };
  }
  if (Date.now() - lastHealthLogAt >= 60_000) {
    lastHealthLogAt = Date.now();
    const relevant = snapshot.feeds.filter(feed => !feed.skipped);
    console.log(JSON.stringify({ event: 'snapshot_health', feeds: relevant.length,
      failedFeeds: relevant.filter(feed => feed.failed).length,
      expiredFeeds: relevant.filter(feed => Date.now() - feed.observedAt > 300_000).length,
      oldestObservationAgeSeconds: relevant.length
        ? Math.round(Math.max(...relevant.map(feed => Date.now() - feed.observedAt)) / 1000) : null }));
  }
  const saved = snapshot;
  persisting = (async () => {
    const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(snapshotPath), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(saved));
      await rename(temporaryPath, snapshotPath);
    } catch (error) {
      dirty = true;
      console.error('Snapshot persistence failed', error);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => {});
    }
  })();
  try { await persisting; } finally { persisting = undefined; }
}

let discoveryTimer: ReturnType<typeof setTimeout>;
async function discover() {
  let retryMs = 3600_000;
  try {
    const definitions = await discoverCollectableFeeds();
    if (!stopping) setDefinitions(definitions, true);
  } catch (error) {
    retryMs = 60_000;
    console.error('Feed discovery failed; retaining the previous catalog', error);
  }
  if (!stopping) discoveryTimer = setTimeout(() => void discover(), retryMs);
}
setDefinitions(independentCollectableFeeds(), false);
scheduler.start();
void discover();
const persistenceTimer = setInterval(() => void persist(), 5_000);
server.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => console.log('Scooter snapshot API listening'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
    scheduler.stop();
    clearTimeout(discoveryTimer);
    clearInterval(persistenceTimer);
    server.close();
    void (async () => { await persisting; await persist(); })();
  });
}
