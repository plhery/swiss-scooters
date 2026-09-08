import { createServer } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { discoverCollectableFeeds, independentCollectableFeeds, ScooterFeedsUnavailableError } from '../src/lib/scooterFeeds';
import { parseScooterQuery } from '../src/lib/scooterQuery';
import { buildCityOverview, OVERVIEW_REFRESH_MS, querySnapshot, type FeedSnapshot, type MobilitySnapshot } from '../src/lib/scooterSnapshots';
import { scooterResponseHeaders } from '../src/lib/scooterResponse';
import { REGIONAL_SCOOTER_SYSTEMS, REGIONAL_SCOOTER_CITIES, regionalSource, isRegionalSource } from '../src/lib/regionalScooterSystems';
import { SWISS_SCOOTER_AREAS } from '../src/lib/feedCoverage';
import { fetchRegionalParking } from '../src/lib/parkingFeeds';

const snapshotPath = process.env.SCOOTER_SNAPSHOT_PATH ?? '/data/scooters.json';
const port = Number(process.env.PORT ?? 3001);
const interval = 60_000;
let snapshot: MobilitySnapshot | undefined;
let definitions = independentCollectableFeeds();
let discoveredAt = 0;
let stopping = false;

try {
  const persisted = JSON.parse(await readFile(snapshotPath, 'utf8')) as MobilitySnapshot;
  if (persisted.version === 1 && Array.isArray(persisted.feeds) && persisted.overview) snapshot = persisted;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Snapshot restore failed', error);
}

async function refresh() {
  const startedAt = Date.now();
  if (startedAt - discoveredAt >= 3600_000) {
    try {
      definitions = await discoverCollectableFeeds();
      discoveredAt = Date.now();
    } catch (error) {
      console.error('Feed discovery failed; retaining the previous catalog', error);
    }
  }
  const previous = new Map(snapshot?.feeds.map(feed => [feed.id, feed]) ?? []);
  const next = new Map(previous);
  let index = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (index < definitions.length && !stopping) {
      const definition = definitions[index++];
      const old = previous.get(definition.id);
      const base = { id: definition.id, source: definition.source,
        provider: definition.provider, coverage: definition.coverage };
      try {
        const result = await definition.collect();
        const now = Date.now();
        const record: FeedSnapshot = {
          ...base, vehicles: result.vehicles,
          observedAt: result.stale && old ? old.observedAt : now,
          attemptedAt: now, stale: result.stale, failed: false, skipped: result.skipped ?? false,
        };
        next.set(definition.id, record);
      } catch (error) {
        next.set(definition.id, { ...base, vehicles: old?.vehicles ?? [],
          observedAt: old?.observedAt ?? 0, attemptedAt: Date.now(),
          stale: true, failed: true, skipped: false });
        console.warn(JSON.stringify({ event: 'snapshot_feed_failed', feed: definition.id,
          error: error instanceof Error ? error.message : String(error) }));
      }
      const regionalSystem = REGIONAL_SCOOTER_SYSTEMS.find(system => definition.id === `${regionalSource(system)}:${system.id}`);
      if (regionalSystem) {
        const record = next.get(definition.id)!;
        try {
          const parking = await fetchRegionalParking(regionalSystem);
          record.parking = { ...parking, observedAt: parking.stale ? old?.parking?.observedAt ?? 0 : Date.now() };
        } catch (error) {
          if (old?.parking) record.parking = { ...old.parking, stale: true };
          console.warn(JSON.stringify({ event: 'parking_feed_failed', feed: definition.id,
            error: error instanceof Error ? error.message : String(error) }));
        }
      }
    }
  }));
  if (stopping) return;
  const now = Date.now();
  // Remove retired registry systems after a successful discovery, without
  // discarding cached Swiss systems during a registry outage on startup.
  if (discoveredAt > 0) {
    const active = new Set(definitions.map(feed => feed.id));
    for (const id of next.keys()) if (!active.has(id)) next.delete(id);
  }
  const feeds = [...next.values()];
  const overview = !snapshot || snapshot.overview.cities.length !== REGIONAL_SCOOTER_CITIES.length + SWISS_SCOOTER_AREAS.length || now - snapshot.overview.generatedAt >= OVERVIEW_REFRESH_MS
    ? buildCityOverview(feeds, now) : snapshot.overview;
  snapshot = { version: 1, updatedAt: now, feeds, overview };
  const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(snapshot));
    await rename(temporaryPath, snapshotPath);
  } catch (error) {
    console.error('Snapshot persistence failed', error);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
  console.log(JSON.stringify({ event: 'snapshot_refreshed', durationMs: Date.now() - startedAt,
    feeds: feeds.length, failed: feeds.filter(feed => feed.failed).length,
    vehicles: feeds.reduce((sum, feed) => sum + feed.vehicles.length, 0), cities: overview.cities.length }));
}

async function collectForever() {
  while (!stopping) {
    const startedAt = Date.now();
    try { await refresh(); } catch (error) { console.error('Snapshot refresh failed', error); }
    // Each operator is polled at most once per minute; a slow cycle cannot overlap.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, Math.max(1000, interval - (Date.now() - startedAt)));
      timer.unref();
    });
  }
}

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.writeHead(405); response.end('{}'); return; }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    const healthy = !!snapshot && Date.now() - snapshot.updatedAt < 5 * interval;
    response.writeHead(healthy ? 200 : 503);
    response.end(JSON.stringify({ ready: healthy, updatedAt: snapshot?.updatedAt,
      feeds: snapshot?.feeds.length, failedFeeds: snapshot?.feeds.filter(feed => feed.failed).map(feed => feed.id),
      parkingLocations: snapshot?.feeds.reduce((total, feed) => total + (feed.parking?.locations.length ?? 0), 0),
      failedParkingFeeds: snapshot?.feeds.filter(feed => isRegionalSource(feed.source) &&
        (!feed.parking || feed.parking.stale || Date.now() - feed.parking.observedAt > 5 * interval)).map(feed => feed.id),
      cities: snapshot?.overview.cities.length, version: process.env.SOURCE_COMMIT ?? 'local' }));
    return;
  }
  if (url.pathname !== '/api/scooters') { response.writeHead(404); response.end('{}'); return; }
  const parsed = parseScooterQuery(url.searchParams);
  if (!parsed.ok) { response.writeHead(400); response.end(JSON.stringify({ error: parsed.error })); return; }
  if (!snapshot) { response.writeHead(503, { 'Retry-After': '5' }); response.end(JSON.stringify({ error: 'Scooter data is warming up.' })); return; }
  try {
    const body = querySnapshot(snapshot, parsed.query, parsed.zoom);
    response.writeHead(200, scooterResponseHeaders(body));
    response.end(JSON.stringify(body));
  } catch (error) {
    const unavailable = error instanceof ScooterFeedsUnavailableError;
    if (!unavailable) console.error('Snapshot query failed', error);
    response.writeHead(unavailable ? 503 : 500, { 'Retry-After': '30' });
    response.end(JSON.stringify({ error: 'Scooter data is temporarily unavailable.',
      ...(unavailable ? { meta: { failedSources: error.failedSources } } : {}) }));
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Scooter snapshot API listening on ${port}`));
void collectForever();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { stopping = true; server.close(); });
}
