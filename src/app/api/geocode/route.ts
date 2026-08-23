import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAllows } from '@/lib/rateLimit';

const MAX_QUERY_LENGTH = 160;
const GEOCODE_TIMEOUT_MS = 10_000;
const GEOADMIN_SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const SUPPORTED_LANGUAGES = new Set(['de', 'fr', 'it', 'en']);

interface GeoAdminResult {
  attrs?: {
    lat?: number;
    lon?: number;
    x?: number;
    y?: number;
    label?: string;
  };
}

interface GeoAdminResponse {
  results?: GeoAdminResult[];
}

interface GeocodeInput {
  query: string;
  requestedLanguage: string;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function plainTextLabel(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/^(?:haltestellen|address|gazetteer)_\s*/i, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES[entity] ?? entity)
    .trim();
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

async function geocode(request: NextRequest, input: GeocodeInput) {
  if (!await rateLimitAllows(request, 'GEOCODE_API_RATE_LIMITER')) {
    return errorResponse('Too many address searches. Please try again shortly.', 429, '60');
  }

  const query = input.query.trim();
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return errorResponse('Address search must contain between 2 and 160 characters.', 400);
  }

  const requestedLanguage = input.requestedLanguage.toLowerCase();
  const language = SUPPORTED_LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'en';

  const url = new URL(GEOADMIN_SEARCH_URL);
  url.search = new URLSearchParams({
    searchText: query,
    type: 'locations',
    limit: '5',
    sr: '4326',
    lang: language,
  }).toString();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': `${language}-CH,${language};q=0.9,en;q=0.6`,
        'User-Agent': 'swiss-scooters/2.0 (swiss-scooters.plhery.com)',
      },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });

    if (response.status === 429) {
      return errorResponse('Address search is temporarily rate limited upstream.', 503, '60');
    }
    if (!response.ok) {
      return errorResponse('Address search is temporarily unavailable.', 502, '30');
    }

    const raw = await response.json() as GeoAdminResponse;
    if (!Array.isArray(raw.results)) {
      return errorResponse('Address search returned an invalid response.', 502);
    }

    const results = raw.results.flatMap(result => {
      const lat = Number(result.attrs?.lat ?? result.attrs?.y);
      const lng = Number(result.attrs?.lon ?? result.attrs?.x);
      const displayName = result.attrs?.label ? plainTextLabel(result.attrs.label) : '';
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !displayName) return [];
      return [{ lat, lng, display_name: displayName }];
    });

    return NextResponse.json(results, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Geocoding-Data-Source': 'swisstopo geo.admin.ch',
      },
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

export async function GET(request: NextRequest) {
  return geocode(request, {
    query: request.nextUrl.searchParams.get('q') ?? '',
    requestedLanguage: request.nextUrl.searchParams.get('lang') ?? 'en',
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Address search request must be valid JSON.', 400);
  }

  if (!body || typeof body !== 'object') {
    return errorResponse('Address search request must be a JSON object.', 400);
  }

  const { q, lang } = body as { q?: unknown; lang?: unknown };
  return geocode(request, {
    query: typeof q === 'string' ? q : '',
    requestedLanguage: typeof lang === 'string' ? lang : 'en',
  });
}
