// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsEnabled, safeAnalyticsData } from './analytics';

const location = { hostname: 'scooters.plhery.com', pathname: '/', search: '?lat=47.3&lng=8.5', hash: '#private' };
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('location', location);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});
afterEach(() => vi.unstubAllGlobals());

describe('analytics privacy boundary', () => {
  it('drops arbitrary data and address-like values', () => {
    expect(safeAnalyticsData({ provider: 'lime', value: 40, result: 'timeout',
      ...{ lat: 47.3, address: 'Bahnhofstrasse 1', url: 'https://secret' },
      style: 'some street 123', count: NaN,
    })).toEqual({ provider: 'lime', value: 40, result: 'timeout' });
  });
  it('excludes local development and preview hosts', () => {
    vi.stubGlobal('location', { ...location, hostname: 'localhost' });
    expect(analyticsEnabled()).toBe(false);
    vi.stubGlobal('location', { ...location, hostname: 'preview.workers.dev' });
    expect(analyticsEnabled()).toBe(false);
  });
  it('respects opt-out, Do Not Track and Global Privacy Control', () => {
    expect(analyticsEnabled()).toBe(true);
    localStorage.setItem('umami.disabled', '1');
    expect(analyticsEnabled()).toBe(false);
    localStorage.clear();
    vi.stubGlobal('navigator', { doNotTrack: '1' });
    expect(analyticsEnabled()).toBe(false);
    vi.stubGlobal('navigator', { globalPrivacyControl: true });
    expect(analyticsEnabled()).toBe(false);
  });
  it('sends only safe paths, no referrers or identities, and reuses the session cache', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cache: 'session-cache' }) });
    vi.stubGlobal('fetch', fetcher);
    const { track } = await import('./analytics');
    track();
    track('rental_open', { provider: 'lime' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const [url, request] = fetcher.mock.calls[1];
    expect(url).toBe('https://u.plhery.com/api/send');
    const body = JSON.parse(request.body);
    expect(body.payload).toMatchObject({ url: '/', referrer: '', tag: 'web', name: 'rental_open', data: { platform: 'web', provider: 'lime' } });
    expect(request.headers['x-umami-cache']).toBe('session-cache');
    expect(request.credentials).toBe('omit');
    expect(request.referrerPolicy).toBe('no-referrer');
    expect(request.body).not.toMatch(/47\.3|8\.5|private|session-cache/);
    expect(body.payload).not.toHaveProperty('id');
  });
  it('bounds the queue and survives network failures without retries', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { track } = await import('./analytics');
    for (let i = 0; i < 100; i++) track('refresh');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(30));
    track('refresh');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(31));
  });
  it("honors the collector's disabled response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ disabled: true }) });
    vi.stubGlobal('fetch', fetcher);
    const { track } = await import('./analytics');
    track('app_open');
    track('refresh');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('drops pending events if the rider opts out before transmission', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { track } = await import('./analytics');
    track('refresh');
    localStorage.setItem('umami.disabled', '1');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetcher).not.toHaveBeenCalled();
  });

});
