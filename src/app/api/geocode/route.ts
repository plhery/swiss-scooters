import { BodyTooLargeError, readJsonBody } from '@/lib/readJsonBody';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAllows } from '@/lib/rateLimit';
import { isPointCovered } from '@/lib/coveredCities';
import { GEOCODE_LANGUAGES, searchCoveredCities } from './cities';

const MAX_QUERY_LENGTH = 160;
// Far more than is returned, so that places with scooter data can be ranked
// first and a station is found among its own tracks and depots: "Basel SBB" is
// the twentieth row swisstopo returns for that text.
const UPSTREAM_RESULT_LIMIT = 30;
const MAX_RESULTS = 5;
const GEOCODE_TIMEOUT_MS = 10_000;
const GEOADMIN_SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
// Not places to ride from: the centres of whole cantons and districts, and land parcels.
const SKIPPED_ORIGINS = new Set(['kantone', 'district', 'parcel']);
// Motorway exits and interchanges, which read like quarters ("Zürich-West") once their class is dropped.
const MOTORWAY_CLASS = 'TLM_AUS_EINFAHRT';
// Public transport stops. A stop a rider can use comes with its transport mode
// ("train", "bus / tram"); one without is an operating point of the railway: a
// depot, a junction, a group of tracks ("Basel SBB RB Gr E", "(Spw)", "Cargo GV").
const STOP_ORIGIN = 'haltestellen';

interface GeoAdminResult {
  attrs?: {
    lat?: number;
    lon?: number;
    x?: number;
    y?: number;
    label?: string;
    origin?: string;
    objectclass?: string;
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
    // Places across the border have no canton: "() - Triesenberg".
    .replace(/\(\s*\)/g, '')
    .replace(BRACKETED_CANTONS, '$1')
    .replace(/^[\s,;:·–—-]+|[\s,;:·–—-]+$/g, '');
}

/**
 * Splits a swisstopo label, e.g. `Paradeplatz 2 <b>8001 Zürich</b>`, into two display lines.
 * `category` is what the label had in <i>: a feature class, or the transport mode of a stop.
 */
function placeLines(label: string, origin: string | undefined, displayName: string) {
  let category = '';
  let bold = '';
  const outside = plainText(label
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, (_, text: string) => { category += ` ${text}`; return ' '; })
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, text: string) => { bold += ` ${text}`; return ' '; }));
  category = plainText(category);
  // Bilingual towns are named twice: "Fribourg|Freiburg".
  bold = plainText(origin === 'gazetteer' ? bold.split('|')[0] : bold);

  if (!bold) return { title: outside || category || displayName.replace(/\s+/g, ' '), subtitle: '', category };

  if (origin === 'address') {
    // The street is outside the bold locality; "#" stands in for a missing house number.
    const street = outside.replace(/\s*#$/, '');
    return street ? { title: street, subtitle: bold, category } : { title: bold, subtitle: '', category };
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
  return { title, subtitle: subtitle === title ? '' : subtitle, category };
}

/** The words of a text in one spelling: "Zuerich" and "Zürich" are both "zurich". */
function searchWords(text: string): string[] {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/([aou])e/g, '$1').split(/[^a-z0-9]+/).filter(Boolean);
}

// From this rank on a place is a last resort, shown only when nothing better was found.
const LAST_RESORT_RANK = 5;

/** How a place ranks for what was typed; lower comes first. */
function placeRank(
  typed: string[],
  place: { title: string; subtitle: string; covered: boolean },
  origin: string | undefined,
  /** A stop without a transport mode. */
  operatingPoint: boolean
): number {
  const title = searchWords(place.title);
  // In any order: "Flughafen Zürich" names "Zürich Flughafen".
  const named = title.length === typed.length && [...title].sort().join(' ') === [...typed].sort().join(' ');
  // A town typed by its name is what was asked for, with scooter data or without.
  if (named && origin === 'gg25') return 0;
  // swisstopo also matches inside words: "Genf" finds "Uettligenfeld".
  const words = [...title, ...searchWords(place.subtitle)];
  const atWordStart = typed.every(word => words.some(candidate => candidate.startsWith(word)));
  // The last resorts: the railway's operating points, then what has the text only inside its words.
  const resort = !atWordStart ? 2 : operatingPoint ? 1 : 0;
  return 1 + resort * (LAST_RESORT_RANK - 1) + (place.covered ? 0 : 2) + (named ? 0 : 1);
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

  // The language the app is shown in: for swisstopo's labels and for the countries of cities.
  const requestedLanguage = input.requestedLanguage.toLowerCase();
  const language = GEOCODE_LANGUAGES.find(code => code === requestedLanguage) ?? 'en';
  // A city with scooter data is found by its name alone, before and without swisstopo.
  const cities = searchCoveredCities(query, language);
  if (cities.length) {
    return NextResponse.json(cities, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Geocoding-Data-Source': 'Verified European scooter city catalog',
      },
    });
  }

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

    const typed = searchWords(query);
    const seen = new Set<string>();
    const places = raw.results.flatMap(result => {
      const origin = result.attrs?.origin;
      // Rows a rider would not choose.
      if (SKIPPED_ORIGINS.has(origin ?? '') || result.attrs?.objectclass?.toUpperCase() === MOTORWAY_CLASS) return [];
      const lat = Number(result.attrs?.lat ?? result.attrs?.y);
      const lng = Number(result.attrs?.lon ?? result.attrs?.x);
      const label = typeof result.attrs?.label === 'string' ? result.attrs.label : '';
      const displayName = plainTextLabel(label);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 || !displayName) return [];
      const { title, subtitle, category } = placeLines(label, origin, displayName);
      // swisstopo lists some places more than once (a town as municipality and as
      // place name, for instance); rows that read the same would look like a bug.
      const key = JSON.stringify([title, subtitle]);
      if (seen.has(key)) return [];
      seen.add(key);
      // After the town "Baden / AG", a feature in it that is also just called
      // "Baden / Baden AG" (its airfield, its treatment plant) reads like the town again.
      if (origin === 'gg25' && subtitle) seen.add(JSON.stringify([title, `${title} ${subtitle}`]));
      const place = { lat, lng, display_name: displayName, title, subtitle, covered: isPointCovered(lat, lng) };
      return [{ place, rank: placeRank(typed, place, origin, origin === STOP_ORIGIN && !category) }];
    });
    // Places with scooter data first. Stable: swisstopo's ranking is kept among the places of one rank.
    places.sort((a, b) => a.rank - b.rank);
    // Operating points are for someone who typed one by its name, matches inside
    // words for a typing mistake: both only when nothing better was found.
    const better = places.filter(({ rank }) => rank < LAST_RESORT_RANK);
    const shown = better.length > 0 ? better : places;

    return NextResponse.json(shown.slice(0, MAX_RESULTS).map(({ place }) => place), {
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
