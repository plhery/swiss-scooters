import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse } from 'miniflare';
import { expect, it } from 'vitest';

it('proxies authenticated requests and rejects redirects in the Workers runtime', async () => {
  const bundle = await build({
    stdin: {
      contents: `import { proxyScooterSnapshot } from './src/lib/scooterProxy';
        export default { fetch(request) { return proxyScooterSnapshot(request, {
          SCOOTER_SNAPSHOT_API_URL: 'https://origin.example',
          SCOOTER_SNAPSHOT_API_TOKEN: 'runtime-test-token',
          SCOOTER_API_RATE_LIMITER: { limit: async () => ({ success: true }) },
        }); } };`,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'browser',
  });
  const authorizations: Array<string | null> = [];
  let redirect = false;
  const runtime = new Miniflare({
    modules: true, compatibilityDate: '2026-07-13', script: bundle.outputFiles[0].text,
    outboundService(request) {
      expect(new URL(request.url).hostname).toBe('origin.example');
      authorizations.push(request.headers.get('Authorization'));
      return redirect
        ? new RuntimeResponse(null, { status: 302, headers: { Location: 'https://unexpected.example' } })
        : new RuntimeResponse('{"vehicles":[]}', { headers: {
          'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
          'X-Scooter-Public-Cache-Control': 'public, max-age=30',
        } });
    },
  });
  try {
    const url = 'https://map.example/api/scooters?south=47.36&west=8.52&north=47.39&east=8.57&zoom=16';
    const response = await runtime.dispatchFetch(url);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vehicles: [] });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30');
    redirect = true;
    const rejected = await runtime.dispatchFetch(url);
    expect(rejected.status).toBe(503);
    expect(rejected.headers.has('Location')).toBe(false);
    expect(authorizations).toEqual(['Bearer runtime-test-token', 'Bearer runtime-test-token']);
  } finally {
    await runtime.dispose();
  }
}, 30_000);
