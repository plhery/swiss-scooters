import { describe, expect, it } from 'vitest';
import { searchCoveredCities } from '@/app/api/geocode/cities';
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
