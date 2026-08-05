import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const rateLimitAllows = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rateLimit', () => ({ rateLimitAllows }));

import { GET } from '@/app/api/geocode/route';

function request(query: string): NextRequest {
  return new NextRequest(`https://example.com/api/geocode?q=${encodeURIComponent(query)}`);
}

beforeEach(() => {
  rateLimitAllows.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/geocode', () => {
  it('validates query length before contacting Nominatim', async () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { lat: '47.377', lon: '8.54', display_name: 'Zürich HB' },
      { lat: 'not-a-number', lon: '8.55', display_name: 'Invalid' },
    ]), { status: 200 })));

    const response = await GET(request('Zurich HB'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { lat: 47.377, lng: 8.54, display_name: 'Zürich HB' },
    ]);
  });
});
