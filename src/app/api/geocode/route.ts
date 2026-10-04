import { BodyTooLargeError, readJsonBody } from '@/lib/readJsonBody';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAllows } from '@/lib/rateLimit';
import { searchRegionalScooterCities } from '@/lib/regionalScooterSystems';
import { isPointCovered } from '@/lib/coveredCities';

const MAX_QUERY_LENGTH = 160;
// Twice what is returned, so places with scooter data can be ranked first.
const UPSTREAM_RESULT_LIMIT = 10;
const MAX_RESULTS = 5;
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
    origin?: string;
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

const LAYER_PREFIX = /^(?:haltestellen|address|gazetteer)_\s*/i;
const CANTONS = '[A-Z]{2}(?:,\\s*[A-Z]{2})*';
const LOCATED_IN = new RegExp(`^\\((${CANTONS})\\)\\s*-\\s*(.+)$`);
const BRACKETED_CANTONS = new RegExp(`\\((${CANTONS})\\)`, 'g');
const CANTON_SUFFIX = /^(.*\S)\s*\(([A-Z]{2})\)$/;

// display_name: decoded by app versions that predate title and subtitle. Keep as is.
function plainTextLabel(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(LAYER_PREFIX, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES[entity] ?? entity)
    .trim();
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LAYER_PREFIX, '');
}

// "(OW) - Lungern" → "Lungern OW", "(ZH)" → "ZH", no separators left at the edges.
function tidyRemainder(text: string): string {
  const located = text.match(LOCATED_IN);
  if (located) {
    const cantons = located[1].replace(/,\s*/g, ', ');
    // Large places list every municipality they touch; the canton says enough.
    if (located[2].includes(',')) return cantons;
    const place = located[2].match(CANTON_SUFFIX);
    return place ? `${place[1]} ${place[2]}` : `${located[2]} ${cantons}`;
  }
  return text
    .replace(BRACKETED_CANTONS, '$1')
    .replace(/^[\s,;:·–—-]+|[\s,;:·–—-]+$/g, '');
}

/** Splits a swisstopo label, e.g. `Paradeplatz 2 <b>8001 Zürich</b>`, into two display lines. */
function placeLines(label: string, origin: string | undefined, displayName: string) {
  let category = '';
  let bold = '';
  const outside = plainText(label
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, (_, text: string) => { category += ` ${text}`; return ' '; })
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, text: string) => { bold += ` ${text}`; return ' '; }));
  category = plainText(category);
  bold = plainText(bold);

  if (!bold) return { title: outside || category || displayName.replace(/\s+/g, ' '), subtitle: '' };

  if (origin === 'address') {
    // The street is outside the bold locality; "#" stands in for a missing house number.
    const street = outside.replace(/\s*#$/, '');
    return street ? { title: street, subtitle: bold } : { title: bold, subtitle: '' };
  }

  let title = origin === 'zipcode' ? bold.replace(/^(\d{4})\s*-\s*(?=\S)/, '$1 ') : bold;
  let subtitle = tidyRemainder(outside);
  // The <i> part is a feature class for gazetteer names ("Building") but the
  // transport mode for stops ("train"), which is worth a line.
  if (!subtitle && origin !== 'gazetteer' && category) {
    subtitle = category[0].toUpperCase() + category.slice(1);
  }
  // Municipalities arrive as "<b>Lausanne (VD)</b>".
  const municipality = subtitle ? null : title.match(CANTON_SUFFIX);
  if (municipality) {
    title = municipality[1];
    subtitle = municipality[2];
  }
  // "<b>Gossau ZH</b> (ZH) - Gossau (ZH)" would say the same thing twice.
  return { title, subtitle: subtitle === title ? '' : subtitle };
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

async function geocode(input: GeocodeInput) {
  const query = input.query.trim();
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return errorResponse('Address search must contain between 2 and 160 characters.', 400);
  }

  const requestedLanguage = input.requestedLanguage.toLowerCase();
  const language = SUPPORTED_LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'en';
  const cities = searchRegionalScooterCities(query).map(city => {
    // The catalogue names its cities "City, Country".
    const separator = city.display_name.lastIndexOf(', ');
    return {
      ...city,
      title: separator < 0 ? city.display_name : city.display_name.slice(0, separator),
      subtitle: separator < 0 ? '' : city.display_name.slice(separator + 2),
      covered: isPointCovered(city.lat, city.lng),
    };
  });
  const cityResponse = () => NextResponse.json(cities, {
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Geocoding-Data-Source': 'Verified European scooter city catalog',
    },
  });

  if (cities.length) return cityResponse();

  const url = new URL(GEOADMIN_SEARCH_URL);
  url.search = new URLSearchParams({
    searchText: query,
    type: 'locations',
    limit: String(UPSTREAM_RESULT_LIMIT),
    sr: '4326',
    lang: language,
  }).toString();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': `${language}-CH,${language};q=0.9,en;q=0.6`,
        'User-Agent': 'scooters/2.0 (scooters.plhery.com)',
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

    const seen = new Set<string>();
    const results = raw.results.flatMap(result => {
      const lat = Number(result.attrs?.lat ?? result.attrs?.y);
      const lng = Number(result.attrs?.lon ?? result.attrs?.x);
      const label = typeof result.attrs?.label === 'string' ? result.attrs.label : '';
      const displayName = plainTextLabel(label);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || !displayName) return [];
      const { title, subtitle } = placeLines(label, result.attrs?.origin, displayName);
      // swisstopo lists some places more than once (a town as municipality and as
      // place name, for instance); rows that read the same would look like a bug.
      const key = JSON.stringify([title, subtitle]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ lat, lng, display_name: displayName, title, subtitle, covered: isPointCovered(lat, lng) }];
    });
    // Stable: swisstopo's ranking is kept among covered and among uncovered places.
    results.sort((a, b) => Number(b.covered) - Number(a.covered));

    return NextResponse.json(results.slice(0, MAX_RESULTS), {
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
  if (!await rateLimitAllows(request, 'GEOCODE_API_RATE_LIMITER')) return errorResponse('Too many address searches. Please try again shortly.', 429, '60');
  return geocode({
    query: request.nextUrl.searchParams.get('q') ?? '',
    requestedLanguage: request.nextUrl.searchParams.get('lang') ?? 'en',
  });
}

export async function POST(request: NextRequest) {
  if (!await rateLimitAllows(request, 'GEOCODE_API_RATE_LIMITER')) return errorResponse('Too many address searches. Please try again shortly.', 429, '60');
  let body: unknown;
  try {
    body = await readJsonBody(request, 4096);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return errorResponse('Address search request is too large.', 413);
    return errorResponse('Address search request must be valid JSON.', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Address search request must be a JSON object.', 400);
  }

  const { q, lang } = body as { q?: unknown; lang?: unknown };
  return geocode({
    query: typeof q === 'string' ? q : '',
    requestedLanguage: typeof lang === 'string' ? lang : 'en',
  });
}
