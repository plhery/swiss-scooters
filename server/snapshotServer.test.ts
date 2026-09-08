import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import net, { type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createSnapshotServer } from './snapshotServer';
import { buildCityOverview, type MobilitySnapshot } from '../src/lib/scooterSnapshots';

const token = 'a-test-origin-token-with-at-least-32-characters';
const servers: Server[] = [];
async function start(snapshot?: MobilitySnapshot) {
  const server = createSnapshotServer({ token, production: true, snapshot: () => snapshot });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port };
}
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });

describe('snapshot origin boundary', () => {
  it('rejects a malformed request target without crashing and continues serving', async () => {
    const { port } = await start();
    const response = await new Promise<string>((resolve, reject) => {
      let data = '';
      const socket = net.connect(port, '127.0.0.1', () => socket.write('GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      socket.on('data', chunk => data += chunk);
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    expect(response).toContain('400 Bad Request');
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
  });

  it('requires a production secret and rejects unauthenticated origin reads', async () => {
    expect(() => createSnapshotServer({ production: true, snapshot: () => undefined })).toThrow('SCOOTER_SNAPSHOT_API_TOKEN');
    const { port } = await start();
    const url = `http://127.0.0.1:${port}/api/scooters`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(503);
  });

  it('rate limits authenticated clients, separates readiness, and prevents caching at the public origin', async () => {
    const now = Date.now();
    const snapshot: MobilitySnapshot = { version: 1, updatedAt: now, feeds: [], overview: buildCityOverview([], now) };
    const { port } = await start(snapshot);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);
    const url = `http://127.0.0.1:${port}/api/scooters?zoom=16`;
    const headers = { Authorization: `Bearer ${token}`, 'X-Scooter-Client-IP': '192.0.2.1' };
    for (let i = 0; i < 60; i++) {
      const response = await fetch(url, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      await response.text();
    }
    expect((await fetch(url, { headers })).status).toBe(429);
    expect((await fetch(url, { headers: { ...headers, 'X-Scooter-Client-IP': '192.0.2.2' } })).status).toBe(200);
  });
});
