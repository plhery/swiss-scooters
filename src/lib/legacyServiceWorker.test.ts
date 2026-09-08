// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync('public/sw.js', 'utf8');

function migrationWorker(hostname: string) {
  const origin = `https://${hostname}`;
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const navigate = vi.fn().mockResolvedValue(null);
  const clients = {
    claim: vi.fn().mockResolvedValue(undefined),
    matchAll: vi.fn().mockResolvedValue([
      { url: `${origin}/privacy?lang=fr#location`, navigate },
    ]),
  };
  const cacheStorage = {
    keys: vi.fn().mockResolvedValue([
      'swiss-scooters-app-v5', 'swiss-scooters-assets-v4',
      'zurich-scooter-app-v1', 'unrelated-cache',
    ]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn();
  runInNewContext(script, {
    URL, Request, Response, fetch,
    caches: cacheStorage,
    self: {
      location: new URL(origin), clients, skipWaiting,
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.set(name, listener);
      },
    },
  });
  return {
    origin, clients, cacheStorage, navigate, skipWaiting, fetch,
    async dispatch(name: string, event: Record<string, unknown> = {}) {
      const promises: Promise<unknown>[] = [];
      const respondWith = vi.fn();
      listeners.get(name)?.({
        ...event, respondWith,
        waitUntil: (promise: Promise<unknown>) => promises.push(promise),
      });
      await Promise.all(promises);
      return respondWith;
    },
  };
}

describe.each(['swiss-scooters.plhery.com', 'zurich-scooter.plhery.com'])('installed app migration: %s', (hostname) => {
  it('replaces the old worker without trying to cache a cross-origin app shell', async () => {
    const worker = migrationWorker(hostname);
    await worker.dispatch('install');
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('removes only app caches and moves open pages with their path, query and fragment', async () => {
    const worker = migrationWorker(hostname);
    await worker.dispatch('activate');
    expect(worker.cacheStorage.delete.mock.calls.map(([name]) => name)).toEqual([
      'swiss-scooters-app-v5', 'swiss-scooters-assets-v4', 'zurich-scooter-app-v1',
    ]);
    expect(worker.clients.claim).toHaveBeenCalledOnce();
    expect(worker.navigate).toHaveBeenCalledWith('https://scooters.plhery.com/privacy?lang=fr#location');
  });

  it('redirects subsequent launches without intercepting API requests', async () => {
    const worker = migrationWorker(hostname);
    const respond = await worker.dispatch('fetch', {
      request: { url: `${worker.origin}/?lang=de`, mode: 'navigate', method: 'GET' },
    });
    const response = respond.mock.calls[0][0] as Response;
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('https://scooters.plhery.com/?lang=de');
    for (const mode of ['navigate', 'cors']) {
      const apiResponse = await worker.dispatch('fetch', {
        request: { url: `${worker.origin}/api/scooters`, mode, method: 'GET' },
      });
      expect(apiResponse).not.toHaveBeenCalled();
    }
  });

  it('ignores old update checks after the move', async () => {
    const worker = migrationWorker(hostname);
    await worker.dispatch('message', { data: { type: 'CHECK_FOR_UPDATE' } });
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
