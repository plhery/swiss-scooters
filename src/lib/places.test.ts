import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COVERED_CITIES } from '@/lib/coveredCities';
import {
  MAX_RECENT_PLACES,
  createRecentPlacesStore,
  placeForCity,
  recentPlaces,
  splitDisplayName,
  toPlace,
  withRecentPlace,
  type Place,
} from '@/lib/places';

function place(title: string, lat = 47.3695, lng = 8.5389): Place {
  return { lat, lng, display_name: title, title, subtitle: '8001 Zürich', covered: true };
}

describe('splitDisplayName', () => {
  it('splits a legacy label at the first comma', () => {
    expect(splitDisplayName('München, Germany')).toEqual({ title: 'München', subtitle: 'Germany' });
    expect(splitDisplayName('Rue Faidherbe 12, 59000 Lille, France'))
      .toEqual({ title: 'Rue Faidherbe 12', subtitle: '59000 Lille, France' });
  });

  it('keeps a label without commas whole', () => {
    expect(splitDisplayName('Paradeplatz 2 8001 Zürich')).toEqual({ title: 'Paradeplatz 2 8001 Zürich', subtitle: '' });
  });

  it('tidies spaces and empty parts and never returns an empty title for a non-empty label', () => {
    expect(splitDisplayName('  Lausanne ,  , VD ')).toEqual({ title: 'Lausanne', subtitle: 'VD' });
    expect(splitDisplayName(' , ')).toEqual({ title: ',', subtitle: '' });
  });
});

describe('toPlace', () => {
  it('uses the two lines and the coverage the API sends', () => {
    expect(toPlace({
      lat: 46.7741, lng: 8.1558, display_name: 'Paradeplatz (OW) - Lungern',
      title: 'Paradeplatz', subtitle: 'Lungern OW', covered: false,
    })).toEqual({
      lat: 46.7741, lng: 8.1558, display_name: 'Paradeplatz (OW) - Lungern',
      title: 'Paradeplatz', subtitle: 'Lungern OW', covered: false,
    });
  });

  it('keeps an empty subtitle empty', () => {
    expect(toPlace({ lat: 47.37, lng: 8.54, display_name: 'Zürich HB', title: 'Zürich HB', subtitle: '', covered: true }).subtitle).toBe('');
  });

  it('falls back to the legacy label and works out the coverage for an older API', () => {
    expect(toPlace({ lat: 48.14, lng: 11.58, display_name: 'München, Germany' }))
      .toEqual({ lat: 48.14, lng: 11.58, display_name: 'München, Germany', title: 'München', subtitle: 'Germany', covered: true });
    expect(toPlace({ lat: 46.7741, lng: 8.1558, display_name: 'Paradeplatz (OW) - Lungern' }))
      .toMatchObject({ title: 'Paradeplatz (OW) - Lungern', subtitle: '', covered: false });
  });

  it('takes a row at the catalogue\'s centre of a covered city for the city as a whole', () => {
    const zurich = COVERED_CITIES.find(city => city.id === 'ch:zurich')!;
    const lyon = COVERED_CITIES.find(city => city.id === 'fr:Lyon')!;
    // What /api/geocode answers for "Zürich" and "Lyon": the catalogue's own rows.
    expect(toPlace({
      lat: zurich.center[0], lng: zurich.center[1], display_name: 'Zürich, Switzerland',
      title: 'Zürich', subtitle: 'Schweiz', covered: true,
    })).toEqual({
      lat: 47.3769, lng: 8.5417, display_name: 'Zürich, Switzerland', title: 'Zürich', subtitle: 'Schweiz', covered: true,
      city: true,
    });
    expect(toPlace({ lat: lyon.center[0], lng: lyon.center[1], display_name: 'Lyon, France', covered: true }).city).toBe(true);
    // An older server sends no coverage; the city is still recognised.
    expect(toPlace({ lat: lyon.center[0], lng: lyon.center[1], display_name: 'Lyon, France' }).city).toBe(true);
  });

  it('keeps an address, a station or a place a place, however close to the centre of a city', () => {
    const zurich = COVERED_CITIES.find(city => city.id === 'ch:zurich')!;
    const station = toPlace({ lat: 47.3782, lng: 8.5402, display_name: 'Zürich HB', title: 'Zürich HB', subtitle: 'Train', covered: true });
    expect(station).not.toHaveProperty('city');
    // Ten metres from the centre is another point.
    expect(toPlace({ lat: zurich.center[0] + 0.0001, lng: zurich.center[1], display_name: 'Bahnhofquai 3', covered: true }))
      .not.toHaveProperty('city');
    // swisstopo's own "Genf", without scooter data.
    expect(toPlace({ lat: 46.2046, lng: 6.1425, display_name: 'Genf (GE)', title: 'Genf', subtitle: 'GE', covered: false }))
      .not.toHaveProperty('city');
  });

  it('does not accept an empty title', () => {
    expect(toPlace({ lat: 47.37, lng: 8.54, display_name: 'Zürich, ZH', title: '  ', subtitle: 'ignored' }))
      .toMatchObject({ title: 'Zürich', subtitle: 'ZH' });
  });
});

describe('placeForCity', () => {
  const zurich = COVERED_CITIES.find(city => city.id === 'ch:zurich')!;
  const lyon = COVERED_CITIES.find(city => city.id === 'fr:Lyon')!;

  it('turns a city chip into a covered place at the city centre', () => {
    expect(placeForCity(zurich, 'en')).toEqual({
      lat: 47.3769, lng: 8.5417, display_name: 'Zürich, Switzerland', title: 'Zürich', subtitle: 'Switzerland', covered: true,
      city: true,
    });
  });

  it('names the country in the language of the app', () => {
    expect(placeForCity(zurich, 'de').subtitle).toBe('Schweiz');
    expect(placeForCity(lyon, 'de').subtitle).toBe('Frankreich');
    expect(placeForCity(lyon, 'it').subtitle).toBe('Francia');
    expect(placeForCity(zurich, 'fr').subtitle).toBe('Suisse');
  });
});

describe('recent places', () => {
  it('puts the most recent place first', () => {
    expect(withRecentPlace([place('A')], place('B')).map(recent => recent.title)).toEqual(['B', 'A']);
  });

  it('keeps three at most', () => {
    const recent = ['A', 'B', 'C', 'D'].reduce<Place[]>((list, title) => withRecentPlace(list, place(title)), []);
    expect(recent.map(entry => entry.title)).toEqual(['D', 'C', 'B']);
    expect(recent).toHaveLength(MAX_RECENT_PLACES);
  });

  it('moves a place that is chosen again to the front instead of listing it twice', () => {
    const recent = ['A', 'B', 'C', 'A'].reduce<Place[]>((list, title) => withRecentPlace(list, place(title)), []);
    expect(recent.map(entry => entry.title)).toEqual(['A', 'C', 'B']);
  });

  it('tells places with the same name apart by where they are', () => {
    const zurich = place('Paradeplatz', 47.369, 8.539);
    const lungern = place('Paradeplatz', 46.7741, 8.1558);
    expect(withRecentPlace([zurich], lungern)).toEqual([lungern, zurich]);
    // The same spot to within a metre is the same place.
    expect(withRecentPlace([zurich], place('Paradeplatz', 47.3690004, 8.5390004))).toHaveLength(1);
  });

  it('does not change the list it was given', () => {
    const before = [place('A')];
    withRecentPlace(before, place('B'));
    expect(before.map(entry => entry.title)).toEqual(['A']);
  });
});

describe('recent places store', () => {
  beforeEach(() => recentPlaces.clear());

  it('starts empty and notifies subscribers of every change', () => {
    const store = createRecentPlacesStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toEqual([]);

    store.add(place('A'));
    store.add(place('B'));
    expect(store.get().map(entry => entry.title)).toEqual(['B', 'A']);
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear();
    expect(store.get()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    store.add(place('C'));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('returns the same list until it changes, as React requires of a store snapshot', () => {
    const store = createRecentPlacesStore();
    store.add(place('A'));
    expect(store.get()).toBe(store.get());
  });

  it('keeps separate stores separate', () => {
    createRecentPlacesStore().add(place('A'));
    expect(recentPlaces.get()).toEqual([]);
  });

  it('never writes a place to browser storage', () => {
    localStorage.clear();
    const local = vi.spyOn(localStorage, 'setItem');
    recentPlaces.add(place('Paradeplatz 2'));
    recentPlaces.add(place('Zürich HB'));
    expect(local).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
