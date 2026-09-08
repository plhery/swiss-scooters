import { parseScooterQuery } from '@/lib/scooterQuery';
import { API_CONTENT_SECURITY_POLICY } from '@/lib/contentSecurityPolicy';

interface SnapshotProxyEnvironment {
  SCOOTER_SNAPSHOT_API_URL: string;
  SCOOTER_SNAPSHOT_API_TOKEN?: string;
  SCOOTER_API_RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// Runs before Next.js: map requests do one small origin read and never fan out
// to operator APIs inside a Cloudflare invocation.
export async function proxyScooterSnapshot(request: Request, env: SnapshotProxyEnvironment): Promise<Response> {
  const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': API_CONTENT_SECURITY_POLICY, 'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' };
  const headers = { ...securityHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
  if (request.method !== 'GET') return new Response('{}', { status: 405, headers });
  try {
    const allowed = await env.SCOOTER_API_RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!allowed.success) return Response.json({ error: 'Too many scooter requests. Please try again shortly.' },
      { status: 429, headers: { ...headers, 'Retry-After': '60' } });
    const url = new URL(request.url);
    const parsed = parseScooterQuery(url.searchParams);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers });
    if (parsed.query.outsideCoverage) return Response.json({
      vehicles: [], clusters: [], providers: {},
      meta: { partial: false, stale: false, failedSources: [],
        sources: { national: 'skipped', hopp: 'skipped', publibike: 'skipped', france: 'skipped', germany: 'skipped', italy: 'skipped' },
        generatedAt: new Date().toISOString(), truncated: false, totalVehicles: 0,
        mode: parsed.zoom !== null && parsed.zoom <= 15 ? 'clusters' : 'vehicles',
        zoom: parsed.zoom, availableProviders: [] },
    }, { headers: { ...headers, 'Cache-Control': 'public, max-age=300' } });
    if (!env.SCOOTER_SNAPSHOT_API_TOKEN) throw new Error('Missing origin credential');
    const upstream = new URL('/api/scooters', env.SCOOTER_SNAPSHOT_API_URL);
    upstream.search = url.search;
    const response = await fetch(upstream, { headers: { Accept: 'application/json', Authorization: `Bearer ${env.SCOOTER_SNAPSHOT_API_TOKEN}`,
      'X-Scooter-Client-IP': request.headers.get('cf-connecting-ip') ?? 'unknown' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status >= 500 || response.status === 401 || response.status === 403) return Response.json({ error: 'Scooter data is temporarily unavailable. Please try again shortly.' },
      { status: 503, headers: { ...headers, 'Retry-After': '30' } });
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', response.headers.get('X-Scooter-Public-Cache-Control') ?? 'private, no-store');
    result.headers.delete('X-Scooter-Public-Cache-Control');
    for (const [key, value] of Object.entries(securityHeaders)) result.headers.set(key, value);
    return result;
  } catch {
    return Response.json({ error: 'Scooter data is temporarily unavailable. Please try again shortly.' },
      { status: 503, headers: { ...headers, 'Retry-After': '30' } });
  }
}
