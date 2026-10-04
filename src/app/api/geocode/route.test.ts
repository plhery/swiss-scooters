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

type GeoAdminRow = [origin: string | undefined, label: string | undefined, lat: number, lon: number];

function stubGeoAdmin(rows: GeoAdminRow[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    void input;
    return new Response(JSON.stringify({
      results: rows.map(([origin, label, lat, lon]) => ({ attrs: { origin, label, lat, lon } })),
    }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Inside the Zürich service area, and outside every service area.
const ZURICH: [number, number] = [47.3695, 8.5389];
const LAUSANNE: [number, number] = [46.5231, 6.6292];

beforeEach(() => {
  rateLimitAllows.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/geocode', () => {
  it.each([
    ['Munich', 'München, Germany', 'München', 'Germany'],
    ['Rome', 'Roma, Italy', 'Roma', 'Italy'],
  ])('finds %s without a Swiss geocoding request', async (query, name, title, subtitle) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await POST(postRequest(query));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ display_name: name, title, subtitle, covered: true }),
    ]));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('includes French scooter cities in searches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"results":[]}')));
    const result = await POST(postRequest('Marseille', 'fr'));
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([
      { lat: 43.2965, lng: 5.3698, display_name: 'Marseille, France', title: 'Marseille', subtitle: 'France', covered: true },
    ]);
  });

  it('can still navigate to French cities when Swiss address search fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const result = await GET(request('Lyon'));
    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual([
      { lat: 45.7578, lng: 4.832, display_name: 'Lyon, France', title: 'Lyon', subtitle: 'France', covered: true },
    ]);
  });

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
      { lat: 47.377, lng: 8.54, display_name: 'Zürich HB', title: 'Zürich HB', subtitle: '', covered: true },
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

describe('address search results', () => {
  // swisstopo's answer to "Paradeplatz" (lang=en) on 3 October 2026.
  it('splits labels into two lines and lists places with scooter data first', async () => {
    stubGeoAdmin([
      ['gazetteer', '<i>Local name swisstopo</i> <b>Paradeplatz</b> (OW) - Lungern', 46.7741, 8.1558],
      ['gazetteer', '<i>Part of a ward</i> <b>Paradeplatz</b> (ZH) - Zürich', 47.3690, 8.5390],
      ['address', 'Paradeplatz 2 <b>8001 Zürich</b>', 47.3695, 8.5389],
      ['address', 'Paradeplatz 3 <b>8001 Zürich</b>', 47.3694, 8.5388],
      ['address', 'Paradeplatz 4 <b>8001 Zürich</b>', 47.3694, 8.5387],
    ]);

    const response = await GET(request('Paradeplatz'));

    await expect(response.json()).resolves.toEqual([
      { lat: 47.369, lng: 8.539, display_name: 'Part of a ward Paradeplatz (ZH) - Zürich', title: 'Paradeplatz', subtitle: 'Zürich ZH', covered: true },
      { lat: 47.3695, lng: 8.5389, display_name: 'Paradeplatz 2 8001 Zürich', title: 'Paradeplatz 2', subtitle: '8001 Zürich', covered: true },
      { lat: 47.3694, lng: 8.5388, display_name: 'Paradeplatz 3 8001 Zürich', title: 'Paradeplatz 3', subtitle: '8001 Zürich', covered: true },
      { lat: 47.3694, lng: 8.5387, display_name: 'Paradeplatz 4 8001 Zürich', title: 'Paradeplatz 4', subtitle: '8001 Zürich', covered: true },
      { lat: 46.7741, lng: 8.1558, display_name: 'Local name swisstopo Paradeplatz (OW) - Lungern', title: 'Paradeplatz', subtitle: 'Lungern OW', covered: false },
    ]);
  });

  it('asks swisstopo for ten places and keeps its ranking within the five returned', async () => {
    const fetchMock = stubGeoAdmin([
      ['address', 'Rue A 1 <b>1003 Lausanne</b>', 46.5231, 6.6292],
      ['address', 'Weg B 1 <b>8001 Zürich</b>', 47.3701, 8.5381],
      ['address', 'Rue C 1 <b>1003 Lausanne</b>', 46.5232, 6.6293],
      ['address', 'Weg D 1 <b>8001 Zürich</b>', 47.3702, 8.5382],
      ['address', 'Rue E 1 <b>1003 Lausanne</b>', 46.5233, 6.6294],
      ['address', 'Weg F 1 <b>8001 Zürich</b>', 47.3703, 8.5383],
      ['address', 'Rue G 1 <b>1003 Lausanne</b>', 46.5234, 6.6295],
      ['address', 'Weg H 1 <b>8001 Zürich</b>', 47.3704, 8.5384],
      ['address', 'Rue I 1 <b>1003 Lausanne</b>', 46.5235, 6.6296],
      ['address', 'Rue J 1 <b>1003 Lausanne</b>', 46.5236, 6.6297],
    ]);

    const results = await (await GET(request('rue'))).json() as { title: string; covered: boolean }[];

    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('limit')).toBe('10');
    expect(results.map(result => result.title)).toEqual(['Weg B 1', 'Weg D 1', 'Weg F 1', 'Weg H 1', 'Rue A 1']);
    expect(results.map(result => result.covered)).toEqual([true, true, true, true, false]);
  });

  it.each<[origin: string | undefined, label: string, title: string, subtitle: string]>([
    ['address', 'Rue de l&#39;Ale 1 <b>1003 Lausanne</b>', "Rue de l'Ale 1", '1003 Lausanne'],
    ['address', 'Paradeplatz 2 8001 Zürich', 'Paradeplatz 2 8001 Zürich', ''],
    ['address', '<b>8001 Zürich</b>', '8001 Zürich', ''],
    ['address', 'Via Stazione # <b>6963 Pregassona</b>', 'Via Stazione', '6963 Pregassona'],
    ['gazetteer', '<i>Building</i> <b>Bau &amp; Hobby</b> (BE) - Bern', 'Bau & Hobby', 'Bern BE'],
    ['gazetteer', '<i>Exit</i> <b>Gossau</b> (SG) - Gossau (SG)', 'Gossau', 'Gossau SG'],
    ['gazetteer', '<i>Populated Place</i> <b>Gossau ZH</b> (ZH) - Gossau (ZH)', 'Gossau ZH', ''],
    ['gazetteer', '<b>Zürich\n</b> (ZH) - Dübendorf,Zollikon,Kilchberg (ZH),Zürich', 'Zürich', 'ZH'],
    ['gazetteer', '<b>St. Gallen</b> (SG,AR) - Teufen (AR),Wittenbach,St. Gallen', 'St. Gallen', 'SG, AR'],
    ['gazetteer', '<i>Local name swisstopo</i> Paradeplatz (OW) - Lungern', 'Paradeplatz (OW) - Lungern', ''],
    ['gg25', '<b>Lausanne (VD)</b>', 'Lausanne', 'VD'],
    ['kantone', '<b>Zürich</b>', 'Zürich', ''],
    ['district', '<b>Bern-Mittelland</b>', 'Bern-Mittelland', ''],
    ['zipcode', '<b>8001 - Zürich</b>', '8001 Zürich', ''],
    ['parcel', '<b>Kerzers</b> 8001 (CH 9077 9455 1086)', 'Kerzers', '8001 (CH 9077 9455 1086)'],
    ['haltestellen', '<i>train</i> <b>Zürich HB</b>', 'Zürich HB', 'Train'],
    ['haltestellen', '<i><i>haltestellen_</i></i> <b>Zürich HB Löwenstrasse</b>', 'Zürich HB Löwenstrasse', ''],
    ['haltestellen', '<i><i>haltestellen_bus / tram</i></i> <b>Bern, Bahnhof</b>', 'Bern, Bahnhof', 'Bus / tram'],
    ['somethingNew', '<b>Zürich</b> (ZH)', 'Zürich', 'ZH'],
    ['somethingNew', '<b>Name</b> - , elsewhere', 'Name', 'elsewhere'],
    [undefined, 'A &lt;plain&gt; label', 'A <plain> label', ''],
    [undefined, '<i>Only a category</i>', 'Only a category', ''],
  ])('reads %s label %j as "%s" and "%s"', async (origin, label, title, subtitle) => {
    stubGeoAdmin([[origin, label, ...LAUSANNE]]);

    await expect((await GET(request('anything'))).json()).resolves.toEqual([
      expect.objectContaining({ title, subtitle, covered: false }),
    ]);
  });

  it.each([
    ['<i>train</i> <b>Zürich HB</b>', 'train Zürich HB'],
    ['<i><i>haltestellen_</i></i> <b>Bern, Bahnhof (Vzw)</b>', 'Bern, Bahnhof (Vzw)'],
    ['<b>Zürich\n</b> (ZH) - Dübendorf,Zollikon', 'Zürich\n (ZH) - Dübendorf,Zollikon'],
    ['Rue de l&#39;Ale 1 <b>1003 Lausanne</b>', "Rue de l'Ale 1 1003 Lausanne"],
  ])('keeps display_name for %j exactly as older app versions expect', async (label, displayName) => {
    stubGeoAdmin([['gazetteer', label, ...ZURICH]]);

    const [result] = await (await GET(request('anything'))).json() as { display_name: string }[];

    expect(result.display_name).toBe(displayName);
  });

  it('drops entries without a usable label and never returns an empty title', async () => {
    stubGeoAdmin([
      ['address', '', ...ZURICH],
      ['address', undefined, ...ZURICH],
      ['gazetteer', '<i></i> <b> </b>', ...ZURICH],
      ['address', ' # <b>8001 Zürich</b>', ...ZURICH],
      ['gazetteer', '<b></b> (ZH) - Zürich', ...ZURICH],
    ]);

    const results = await (await GET(request('anything'))).json() as { title: string; subtitle: string }[];

    expect(results.map(result => [result.title, result.subtitle])).toEqual([
      ['8001 Zürich', ''],
      ['(ZH) - Zürich', ''],
    ]);
  });

  it('lists a place once when swisstopo returns it several times', async () => {
    stubGeoAdmin([
      ['gg25', '<b>Winterthur (ZH)</b>', 47.4991, 8.7202],
      ['district', '<b>Winterthur</b>', 47.4979, 8.7746],
      ['gazetteer', '<b>Winterthur\n</b> (ZH) - Wiesendangen,Neftenbach,Winterthur', 47.5002, 8.7327],
      ['gazetteer', '<b>Winterthur</b> (ZH) - Wiesendangen,Neftenbach,Winterthur', 47.5002, 8.7327],
      ['gazetteer', '<i>Interchange</i> <b>Winterthur-Ost</b> (ZH) - Wiesendangen', 47.532, 8.7896],
    ]);

    const results = await (await GET(request('Winterthur'))).json() as { title: string; subtitle: string; lat: number }[];

    expect(results.map(result => [result.title, result.subtitle, result.lat])).toEqual([
      ['Winterthur', 'ZH', 47.4991],
      ['Winterthur', '', 47.4979],
      ['Winterthur-Ost', 'Wiesendangen ZH', 47.532],
    ]);
  });
});

it('rate limits malformed bodies before attempting to read them', async () => {
  rateLimitAllows.mockResolvedValue(false);
  const req = new NextRequest('https://example.com/api/geocode', { method: 'POST', body: '{' });
  const response = await POST(req);
  expect(response.status).toBe(429);
  expect(req.bodyUsed).toBe(false);
  expect(rateLimitAllows).toHaveBeenCalledOnce();
});

it('caps streamed bodies without a Content-Length, counting UTF-8 bytes', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('{"q":"Zurich","extra":"'));
    controller.enqueue(encoder.encode('é'.repeat(2100)));
    controller.enqueue(encoder.encode('"}'));
    controller.close();
  } });
  const req = new NextRequest('https://example.com/api/geocode', { method: 'POST', body: stream });
  expect((await POST(req)).status).toBe(413);
  expect(rateLimitAllows).toHaveBeenCalledOnce();
});
