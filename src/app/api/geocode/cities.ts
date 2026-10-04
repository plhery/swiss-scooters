import { COVERED_CITIES, isPointCovered, type CoveredCountry } from '@/lib/coveredCities';
import { REGIONAL_SCOOTER_CITIES } from '@/lib/regionalScooterSystems';

const MAX_CITIES = 5;

/** The languages the apps are shown in; a result's second line is written in the one asked for. */
export const GEOCODE_LANGUAGES = ['en', 'de', 'fr', 'it'] as const;
export type GeocodeLanguage = typeof GEOCODE_LANGUAGES[number];

// A table rather than Intl.DisplayNames, whose locale data is not a given on the server.
const COUNTRY_NAMES: Record<CoveredCountry, Record<GeocodeLanguage, string>> = {
  CH: { en: 'Switzerland', de: 'Schweiz', fr: 'Suisse', it: 'Svizzera' },
  FR: { en: 'France', de: 'Frankreich', fr: 'France', it: 'Francia' },
  DE: { en: 'Germany', de: 'Deutschland', fr: 'Allemagne', it: 'Germania' },
  IT: { en: 'Italy', de: 'Italien', fr: 'Italie', it: 'Italia' },
};

// Typed beside a city to say which one is meant: "Lindau Deutschland".
const COUNTRY_WORDS: Record<CoveredCountry, string[]> = {
  CH: ['switzerland', 'schweiz', 'suisse', 'svizzera'],
  FR: ['france', 'frankreich', 'francia'],
  DE: ['germany', 'deutschland', 'allemagne', 'germania'],
  IT: ['italy', 'italia', 'italie', 'italien'],
};

// What the Swiss cities are called in the other languages of the app, and how
// they are typed without an umlaut. The regional catalogues carry their own aliases.
const SWISS_ALIASES: Record<string, string[]> = {
  'ch:basel': ['Bâle', 'Basilea', 'Basle'],
  'ch:bern': ['Berne', 'Berna'],
  'ch:biel': ['Biel', 'Bienne', 'Bienna'],
  'ch:schaffhausen': ['Schaffhouse', 'Sciaffusa'],
  'ch:st-gallen': ['Sankt Gallen', 'Saint-Gall', 'San Gallo'],
  'ch:winterthur': ['Winterthour'],
  'ch:zug': ['Zoug', 'Zugo'],
  'ch:zurich': ['Zuerich', 'Zurigo'],
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replaceAll('ß', 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

const REGIONAL_ALIASES = new Map(REGIONAL_SCOOTER_CITIES.map(city => [city.id, city.aliases ?? []]));

// Every city with scooter data, Swiss ones included, with all the names it
// answers to: "Zürich" is also found as "Zurich", "Zuerich" and "Zurigo".
const CITIES = COVERED_CITIES.map(city => ({
  ...city,
  names: [city.city, ...(SWISS_ALIASES[city.id] ?? []), ...(REGIONAL_ALIASES.get(city.id) ?? [])]
    .map(name => normalize(name).split(' ')),
}));

export interface CityMatch {
  lat: number;
  lng: number;
  display_name: string;
  title: string;
  subtitle: string;
  covered: boolean;
}

/**
 * The cities with scooter data that a query names, found without a geocoding
 * request: a city typed in full first, then those that only start like it, by name.
 * The second line is the country in the language asked for.
 */
export function searchCoveredCities(query: string, language: GeocodeLanguage = 'en'): CityMatch[] {
  const words = normalize(query).split(' ');
  const countries = Object.keys(COUNTRY_WORDS) as CoveredCountry[];
  const country = countries.find(code => COUNTRY_WORDS[code].some(word => words.includes(word)));
  const cityWords = words.filter(word => !Object.values(COUNTRY_WORDS).flat().includes(word));
  if (cityWords.join('').length < 2) return [];

  const typed = cityWords.join(' ');
  return CITIES
    .filter(city => (!country || country === city.country) && city.names.some(parts =>
      cityWords.every(word => parts.some(part => part.startsWith(word)))))
    .map(city => ({ city, exact: city.names.some(parts => parts.join(' ') === typed) }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.city.city.localeCompare(b.city.city))
    .slice(0, MAX_CITIES)
    .map(({ city }) => ({
      lat: city.center[0],
      lng: city.center[1],
      // Decoded by app versions that predate title and subtitle; those always received English.
      display_name: `${city.city}, ${COUNTRY_NAMES[city.country].en}`,
      title: city.city,
      subtitle: COUNTRY_NAMES[city.country][language],
      covered: isPointCovered(city.center[0], city.center[1]),
    }));
}
