import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAllows } from '@/lib/rateLimit';

const MAX_QUERY_LENGTH = 160;
const GEOCODE_TIMEOUT_MS = 10_000;
const DEFAULT_CONTACT_EMAIL = 'zurich-scooter@plhery.com';

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
}

function errorResponse(message: string, status: number, retryAfter?: string) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
      },
    }
  );
}

export async function GET(request: NextRequest) {
  if (!await rateLimitAllows(request, 'GEOCODE_API_RATE_LIMITER')) {
    return errorResponse('Too many address searches. Please try again shortly.', 429, '60');
  }

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return errorResponse('Address search must contain between 2 and 160 characters.', 400);
  }

  const contactEmail = process.env.SHAREDMOBILITY_AUTH_EMAIL ?? DEFAULT_CONTACT_EMAIL;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'ch',
    email: contactEmail,
  }).toString();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': `scooters-web/2.0 (zurich-scooter.plhery.com; ${contactEmail})`,
      },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });

    if (response.status === 429) {
      return errorResponse('Address search is temporarily rate limited upstream.', 503, '60');
    }
    if (!response.ok) {
      return errorResponse('Address search is temporarily unavailable.', 502, '30');
    }

    const raw = await response.json();
    if (!Array.isArray(raw)) {
      return errorResponse('Address search returned an invalid response.', 502);
    }

    const results = (raw as NominatimResult[]).flatMap(result => {
      const lat = Number(result.lat);
      const lng = Number(result.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !result.display_name) return [];
      return [{ lat, lng, display_name: result.display_name }];
    });

    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return errorResponse(
      timedOut ? 'Address search timed out.' : 'Address search is temporarily unavailable.',
      timedOut ? 504 : 502,
      '30'
    );
  }
}
