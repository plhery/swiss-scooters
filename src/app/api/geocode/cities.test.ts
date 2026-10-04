import { describe, expect, it } from 'vitest';
import { GEOCODE_LANGUAGES, searchCoveredCities } from '@/app/api/geocode/cities';
import { COVERED_CITIES } from '@/lib/coveredCities';
import { searchRegionalScooterCities } from '@/lib/regionalScooterSystems';

const names = (query: string) => searchCoveredCities(query).map(city => city.display_name);

describe('searchCoveredCities', () => {
  it('finds a Swiss city with scooter data by its name, before a foreign city that only starts like it', () => {
    expect(searchCoveredCities('Biel')).toEqual([
      { lat: 47.1368, lng: 7.2468, display_name: 'Biel/Bienne, Switzerland', title: 'Biel/Bienne', subtitle: 'Switzerland', covered: true },
      { lat: 52.0224, lng: 8.535, display_name: 'Bielefeld, Germany', title: 'Bielefeld', subtitle: 'Germany', covered: true },
    ]);
    expect(names('Bern')).toEqual(['Bern, Switzerland']);
    expect(names('Zürich')).toEqual(['Zürich, Switzerland']);
    expect(names('basel')).toEqual(['Basel, Switzerland']);
    expect(names('Winterthur')).toEqual(['Winterthur, Switzerland']);
  });

  it.each([
    ['Zurich', 'Zürich'], ['Zuerich', 'Zürich'], ['Zurigo', 'Zürich'], ['ZÜRICH', 'Zürich'],
    ['Bienne', 'Biel/Bienne'], ['Biel/Bienne', 'Biel/Bienne'], ['Biel Bienne', 'Biel/Bienne'],
    ['Berne', 'Bern'], ['Berna', 'Bern'], ['Bâle', 'Basel'], ['Basilea', 'Basel'],
    ['St. Gallen', 'St. Gallen'], ['St.Gallen', 'St. Gallen'], ['St Gallen', 'St. Gallen'],
    ['Sankt Gallen', 'St. Gallen'], ['Saint-Gall', 'St. Gallen'], ['San Gallo', 'St. Gallen'],
    ['Winterthour', 'Winterthur'], ['Zoug', 'Zug'], ['Schaffhouse', 'Schaffhausen'], ['Effretikon', 'Illnau-Effretikon'],
    ['Munich', 'München'], ['Muenchen', 'München'], ['Rome', 'Roma'], ['Cologne', 'Köln'], ['koln', 'Köln'],
  ])('finds "%s" as %s', (query, title) => {
    expect(searchCoveredCities(query)[0].title).toBe(title);
  });

  it('lists the cities a few letters could become, a city typed in full first and the others by name', () => {
    expect(names('Ber')).toEqual(['Berlin, Germany', 'Bern, Switzerland']);
    expect(names('Ro')).toEqual(['Roma, Italy', 'Romanshorn, Switzerland', 'Rorschach, Switzerland', 'Rostock, Germany']);
    expect(names('Rom')).toEqual(['Roma, Italy', 'Romanshorn, Switzerland']);
    expect(names('Roma')).toEqual(['Roma, Italy', 'Romanshorn, Switzerland']);
    expect(names('Bi')).toEqual(['Biel/Bienne, Switzerland', 'Bielefeld, Germany']);
    expect(searchCoveredCities('B')).toEqual([]);
    expect(searchCoveredCities('a').length).toBe(0);
  });

  it('returns five cities at most', () => {
    expect(names('He')).toEqual([
      'Heidelberg, Germany', 'Heilbronn, Germany', 'Hennef, Germany', 'Herford, Germany', 'Herne, Germany',
    ]);
  });

  it('takes a country typed beside the city, in any language of the app', () => {
    expect(names('Biel Schweiz')).toEqual(['Biel/Bienne, Switzerland']);
    expect(names('Biel Suisse')).toEqual(['Biel/Bienne, Switzerland']);
    expect(names('Biel Germany')).toEqual(['Bielefeld, Germany']);
    expect(names('Lindau Deutschland')).toEqual(['Lindau, Germany']);
    expect(names('Roma Svizzera')).toEqual(['Romanshorn, Switzerland']);
    expect(names('Lyon Italia')).toEqual([]);
    // A country alone names no city.
    expect(names('Schweiz')).toEqual([]);
  });

  it('writes the country in the language asked for, and English when none is', () => {
    const lines = (query: string, language?: 'en' | 'de' | 'fr' | 'it') =>
      searchCoveredCities(query, language).map(city => `${city.title} / ${city.subtitle}`);
    expect(lines('Biel')).toEqual(['Biel/Bienne / Switzerland', 'Bielefeld / Germany']);
    expect(lines('Biel', 'en')).toEqual(['Biel/Bienne / Switzerland', 'Bielefeld / Germany']);
    expect(lines('Biel', 'de')).toEqual(['Biel/Bienne / Schweiz', 'Bielefeld / Deutschland']);
    expect(lines('Biel', 'fr')).toEqual(['Biel/Bienne / Suisse', 'Bielefeld / Allemagne']);
    expect(lines('Biel', 'it')).toEqual(['Biel/Bienne / Svizzera', 'Bielefeld / Germania']);
    expect(lines('Lyon', 'de')).toEqual(['Lyon / Frankreich']);
    expect(lines('Lyon', 'fr')).toEqual(['Lyon / France']);
    expect(lines('Lyon', 'it')).toEqual(['Lyon / Francia']);
    expect(lines('Rome', 'de')).toEqual(['Roma / Italien']);
    expect(lines('Rome', 'fr')).toEqual(['Roma / Italie']);
    expect(lines('Rome', 'it')).toEqual(['Roma / Italia']);
  });

  it('keeps display_name in English in every language, as older app versions decode it', () => {
    for (const language of GEOCODE_LANGUAGES) {
      expect(searchCoveredCities('Munich', language)[0].display_name, language).toBe('München, Germany');
      expect(searchCoveredCities('Zürich', language)[0].display_name, language).toBe('Zürich, Switzerland');
    }
  });

  it('names countries as the "Cities with scooters" chips of the web app do', () => {
    // src/lib/places.ts asks Intl.DisplayNames; a typed city and a chip must read the same.
    for (const language of GEOCODE_LANGUAGES) {
      const regions = new Intl.DisplayNames(`${language}-CH`, { type: 'region' });
      for (const [query, country] of [['Zürich', 'CH'], ['Lyon', 'FR'], ['Berlin', 'DE'], ['Roma', 'IT']]) {
        expect(searchCoveredCities(query, language)[0].subtitle, `${country} in ${language}`).toBe(regions.of(country));
      }
    }
  });

  it('leaves streets, stations and towns without scooter data to the address search', () => {
    for (const query of ['Bahnhofstrasse 1 Zürich', 'Zürich HB', 'Bern Bahnhof', 'Zürichstrasse', 'Rue de Berne', 'Lausanne', 'Genf', 'Genève', 'Milano', 'Luzern', '8001']) {
      expect(searchCoveredCities(query), query).toEqual([]);
    }
  });

  it('finds every city with scooter data by its own name, first', () => {
    for (const city of COVERED_CITIES) {
      const [first] = searchCoveredCities(city.city);
      expect(first, city.city).toMatchObject({
        title: city.city, lat: city.center[0], lng: city.center[1], covered: true,
      });
    }
  });

  it('finds the cities outside Switzerland as the regional catalogue search does', () => {
    for (const query of ['Munich', 'Rome', 'Lyon', 'Marseille', 'Paris', 'Köln', 'Koeln', 'Frankfurt', 'Saint-Q', 'La', 'He', 'Lyon France', 'Stuttgart Deutschland']) {
      expect(names(query), query).toEqual(searchRegionalScooterCities(query).map(city => city.display_name));
    }
    // Swiss cities take their place among them by name.
    expect(names('St')).toEqual(['St. Gallen, Switzerland', 'Stuttgart, Germany']);
    expect(searchRegionalScooterCities('St').map(city => city.display_name)).toEqual(['Stuttgart, Germany']);
  });
});
