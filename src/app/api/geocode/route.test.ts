import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimitAllows = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rateLimit', () => ({ rateLimitAllows }));

import { GET, POST } from '@/app/api/geocode/route';

function request(query: string, language?: string): NextRequest {
  const url = new URL('https://example.com/api/geocode');
  url.searchParams.set('q', query);
  if (language) url.searchParams.set('lang', language);
  return new NextRequest(url);
}

function postRequest(query: unknown, language: unknown = 'en'): NextRequest {
  return new NextRequest('https://example.com/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, lang: language }),
  });
}

beforeEach(() => {
  rateLimitAllows.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/geocode', () => {
  it('validates query length before contacting GeoAdmin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('Z'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 429 when the client exceeds the address-search limit', async () => {
    rateLimitAllows.mockResolvedValue(false);

    const response = await GET(request('Zurich HB'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('filters malformed upstream entries from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      results: [
        { attrs: { lat: 47.377, lon: 8.54, label: 'haltestellen_ <b>Zürich HB</b>' } },
        { attrs: { lat: 'not-a-number', lon: 8.55, label: 'Invalid' } },
      ],
    }), { status: 200 })));

    const response = await GET(request('Zurich HB'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual([
      { lat: 47.377, lng: 8.54, display_name: 'Zürich HB' },
    ]);
  });

  it('accepts address text in a non-cacheable POST body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"results":[]}', { status: 200 })));

    const response = await POST(postRequest('Bern Bahnhof', 'de'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-geocoding-data-source')).toBe('swisstopo geo.admin.ch');
  });

  it('rejects malformed POST bodies without contacting GeoAdmin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalidRequest = new NextRequest('https://example.com/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    const response = await POST(invalidRequest);

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests Swiss geocoding results in the selected language', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response('{"results":[]}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await GET(request('Lausanne Gare', 'fr'));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'api3.geo.admin.ch',
        pathname: '/rest/services/api/SearchServer',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'fr-CH,fr;q=0.9,en;q=0.6',
        }),
      })
    );
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('searchText')).toBe('Lausanne Gare');
    expect(url.searchParams.get('lang')).toBe('fr');
  });
});
