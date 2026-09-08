import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { parseScooterQuery } from '../src/lib/scooterQuery';
import { querySnapshot, VEHICLE_MAX_AGE_MS, type MobilitySnapshot } from '../src/lib/scooterSnapshots';
import { ScooterFeedsUnavailableError } from '../src/lib/scooterFeeds';
import { scooterResponseHeaders } from '../src/lib/scooterResponse';
import { isRegionalSource } from '../src/lib/regionalScooterSystems';

interface ServerOptions {
  snapshot: () => MobilitySnapshot | undefined;
  token?: string;
  production?: boolean;
  version?: string;
}

export function createSnapshotServer(options: ServerOptions) {
  if (options.production && (!options.token || options.token.length < 32)) {
    throw new Error('SCOOTER_SNAPSHOT_API_TOKEN must contain at least 32 characters in production');
  }
  const tokenHash = options.token ? createHash('sha256').update(`Bearer ${options.token}`).digest() : null;
  const clients = new Map<string, { count: number; resetAt: number }>();
  let activeResponses = 0;
  function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end('{}'); return; }
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { response.writeHead(400); response.end('{"error":"Invalid request URL"}'); return; }
    const snapshot = options.snapshot();
    const now = Date.now();
    if (url.pathname === '/health' || url.pathname === '/ready') {
      const feeds = snapshot?.feeds ?? [];
      const live = !!snapshot && now - snapshot.updatedAt < VEHICLE_MAX_AGE_MS;
      const usable = feeds.filter(feed => !feed.skipped && now - feed.observedAt <= VEHICLE_MAX_AGE_MS);
      const ready = live && usable.length > 0;
      response.writeHead((url.pathname === '/health' ? live : ready) ? 200 : 503);
      response.end(JSON.stringify({ live, ready, updatedAt: snapshot?.updatedAt, feeds: feeds.length,
        usableFeeds: usable.length,
        failedFeeds: feeds.filter(feed => !feed.skipped && (feed.failed || now - feed.observedAt > VEHICLE_MAX_AGE_MS)).map(feed => feed.id),
        oldestUsableAgeSeconds: usable.length ? Math.round(Math.max(...usable.map(feed => now - feed.observedAt)) / 1000) : null,
        parkingLocations: feeds.reduce((sum, feed) => sum + (feed.parking?.locations.length ?? 0), 0),
        failedParkingFeeds: feeds.filter(feed => isRegionalSource(feed.source) &&
          (!feed.parking || feed.parking.stale || now - feed.parking.observedAt > VEHICLE_MAX_AGE_MS)).map(feed => feed.id),
        cities: snapshot?.overview.cities.length, version: options.version ?? 'local' }));
      return;
    }
    if (url.pathname !== '/api/scooters') { response.writeHead(404); response.end('{}'); return; }
    const authorized = tokenHash
      ? timingSafeEqual(tokenHash, createHash('sha256').update(request.headers.authorization ?? '').digest())
      : ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
    if (!authorized) { response.writeHead(401); response.end('{}'); return; }
    // Only an authenticated Worker may supply a client IP. It replaces any incoming header.
    const forwarded = request.headers['x-scooter-client-ip'];
    const key = tokenHash && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded : request.socket.remoteAddress ?? 'unknown';
    for (const [ip, entry] of clients) if (entry.resetAt <= now) clients.delete(ip);
    const client = clients.get(key) ?? { count: 0, resetAt: now + 60_000 };
    if (client.count >= 60 || activeResponses >= 32 || (!clients.has(key) && clients.size >= 10_000)) {
      response.writeHead(429, { 'Retry-After': '60' }); response.end('{}'); return;
    }
    client.count++; clients.set(key, client);
    activeResponses++;
    response.once('close', () => activeResponses--);
    const parsed = parseScooterQuery(url.searchParams);
    if (!parsed.ok) { response.writeHead(400); response.end(JSON.stringify({ error: parsed.error })); return; }
    if (!snapshot) { response.writeHead(503, { 'Retry-After': '5' }); response.end('{"error":"Scooter data is warming up."}'); return; }
    const body = querySnapshot(snapshot, parsed.query, parsed.zoom);
    // The origin only serves authenticated traffic. Public caching is set at the Worker.
    response.writeHead(200, { ...scooterResponseHeaders(body), 'Cache-Control': 'private, no-store',
      'X-Scooter-Public-Cache-Control': scooterResponseHeaders(body)['Cache-Control'] });
    response.end(JSON.stringify(body));
  }
  const server = createServer((request, response) => {
    try { handle(request, response); }
    catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const unavailable = error instanceof ScooterFeedsUnavailableError;
      if (!unavailable) console.error('Snapshot request failed', error instanceof Error ? error.name : 'UnknownError');
      response.writeHead(unavailable ? 503 : 500, { 'Retry-After': '30', 'Cache-Control': 'private, no-store' });
      response.end('{"error":"Scooter data is temporarily unavailable."}');
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.timeout = 10_000;
  return server;
}
