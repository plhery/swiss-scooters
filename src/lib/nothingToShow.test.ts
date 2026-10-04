import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '@/lib/i18n';
import {
  coverageDistanceKm,
  filterSummary,
  filtersActive,
  formatFilterSummary,
  nothingToShow,
  unfilteredCountInView,
  type NothingToShowInput,
} from '@/lib/nothingToShow';
import type { UiTextFormatter } from '@/lib/uiText';

const ALL = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'pony', 'publibike'];
const ZURICH = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'publibike'];
const LUNGERN: [number, number] = [46.7741, 8.1558];
const VIEWPORT = { south: 47.36, west: 8.52, north: 47.39, east: 8.57 };

function input(overrides: Partial<NothingToShowInput> = {}): NothingToShowInput {
  return {
    count: 0,
    loading: null,
    failure: null,
    hasData: true,
    viewportProviders: ZURICH,
    viewportCenter: [47.3769, 8.5417],
    minBattery: 0,
    enabledProviders: new Set(ALL),
    unfilteredCount: 0,
    ...overrides,
  };
}

const english: Record<string, string> = {
  'hidden.only': '{names} only',
  'hidden.battery': 'battery {value}% or more',
};
const i18n: UiTextFormatter = {
  locale: 'en',
  t: (key: TranslationKey, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    english[key] ?? key
  ),
  formatNumber: value => String(value),
};

describe('filtersActive', () => {
  it('is off when everything that operates here is shown', () => {
    expect(filtersActive({ minBattery: 0, enabledProviders: new Set(ALL), viewportProviders: ZURICH })).toBe(false);
  });

  it('ignores a provider that is switched off but does not operate here', () => {
    expect(filtersActive({ minBattery: 0, enabledProviders: new Set(ZURICH), viewportProviders: ZURICH })).toBe(false);
    expect(filtersActive({ minBattery: 0, enabledProviders: new Set(ZURICH), viewportProviders: ['dott', 'pony'] })).toBe(true);
  });

  it('is on with a minimum battery or a provider here switched off', () => {
    expect(filtersActive({ minBattery: 30, enabledProviders: new Set(ALL), viewportProviders: ZURICH })).toBe(true);
    expect(filtersActive({ minBattery: 0, enabledProviders: new Set(['lime']), viewportProviders: ZURICH })).toBe(true);
  });
});

describe('filterSummary', () => {
  it('lists the providers that are still on, then the battery', () => {
    const parts = filterSummary({ minBattery: 60, enabledProviders: new Set(['lime']), viewportProviders: ZURICH });
    expect(parts).toEqual([{ kind: 'providers', names: ['Lime'] }, { kind: 'battery', value: 60 }]);
    expect(formatFilterSummary(parts, i18n)).toBe('Lime only · battery 60% or more');
  });

  it('names several providers in catalogue order', () => {
    const parts = filterSummary({ minBattery: 0, enabledProviders: new Set(['voi', 'lime', 'bolt']), viewportProviders: ZURICH });
    expect(parts).toEqual([{ kind: 'providers', names: ['Bolt', 'Lime', 'Voi'] }]);
    expect(formatFilterSummary(parts, i18n)).toBe('Bolt, Lime and Voi only');
    expect(formatFilterSummary([{ kind: 'providers', names: ['Lime', 'Voi'] }], i18n)).toBe('Lime and Voi only');
  });

  it('joins names the way the language does', () => {
    const names = [{ kind: 'providers' as const, names: ['Lime', 'Voi'] }];
    expect(formatFilterSummary(names, { ...i18n, locale: 'de' })).toBe('Lime und Voi only');
    expect(formatFilterSummary(names, { ...i18n, locale: 'fr' })).toBe('Lime et Voi only');
    expect(formatFilterSummary(names, { ...i18n, locale: 'it' })).toBe('Lime e Voi only');
  });

  it('mentions only the battery when every provider here is on', () => {
    const parts = filterSummary({ minBattery: 30, enabledProviders: new Set(ALL), viewportProviders: ZURICH });
    expect(parts).toEqual([{ kind: 'battery', value: 30 }]);
    expect(formatFilterSummary(parts, i18n)).toBe('Battery 30% or more');
  });

  it('names what is selected when none of it operates here', () => {
    expect(filterSummary({ minBattery: 0, enabledProviders: new Set(['pony']), viewportProviders: ZURICH }))
      .toEqual([{ kind: 'providers', names: ['Pony'] }]);
  });

  it('leaves the providers out when none is selected at all, and is empty without filters', () => {
    expect(filterSummary({ minBattery: 80, enabledProviders: new Set(), viewportProviders: ZURICH }))
      .toEqual([{ kind: 'battery', value: 80 }]);
    expect(filterSummary({ minBattery: 0, enabledProviders: new Set(ALL), viewportProviders: ZURICH })).toEqual([]);
    expect(formatFilterSummary([], i18n)).toBe('');
  });
});

describe('unfilteredCountInView', () => {
  const inside = { lat: 47.377, lng: 8.542 };
  const outside = { lat: 47.5, lng: 8.542 };
  const vehicles = [inside, inside, outside];
  const clusters: Array<{ lat: number; lng: number; providers: Record<string, number> }> = [
    { ...inside, providers: { lime: 4, voi: 2 } },
    { ...outside, providers: { lime: 9 } },
  ];
  const meta = { truncated: false };

  it('counts every scooter in the viewport in vehicle mode', () => {
    expect(unfilteredCountInView({ meta, vehicles, clusters: [], viewport: VIEWPORT, serverMinBattery: 0 })).toBe(2);
  });

  it('adds up the provider counts of the clusters in the viewport', () => {
    expect(unfilteredCountInView({ meta, vehicles, clusters, viewport: VIEWPORT, serverMinBattery: 0 })).toBe(8);
  });

  it('knows that nothing is there', () => {
    expect(unfilteredCountInView({ meta, vehicles: [outside], clusters: [], viewport: VIEWPORT, serverMinBattery: 0 })).toBe(0);
  });

  it('cannot know when the server filtered by battery, cut the list short, or nothing is loaded', () => {
    expect(unfilteredCountInView({ meta, vehicles, clusters, viewport: VIEWPORT, serverMinBattery: 30 })).toBeNull();
    expect(unfilteredCountInView({ meta: { truncated: true }, vehicles, clusters, viewport: VIEWPORT, serverMinBattery: 0 })).toBeNull();
    expect(unfilteredCountInView({ meta: null, vehicles, clusters, viewport: VIEWPORT, serverMinBattery: 0 })).toBeNull();
    expect(unfilteredCountInView({ meta, vehicles, clusters, viewport: null, serverMinBattery: 0 })).toBeNull();
  });
});

describe('nothingToShow', () => {
  it('has nothing to explain while scooters are shown', () => {
    expect(nothingToShow(input({ count: 3 }))).toBeNull();
    expect(nothingToShow(input({ count: 3, viewportProviders: [] }))).toBeNull();
  });

  it('waits for the answer for this view, and leaves a failure to speak for itself', () => {
    expect(nothingToShow(input({ loading: 'load' }))).toBeNull();
    expect(nothingToShow(input({ failure: 'offline' }))).toBeNull();
    expect(nothingToShow(input({ hasData: false }))).toBeNull();
  });

  it('keeps its answer during a refresh', () => {
    expect(nothingToShow(input({ loading: 'refresh' }))).toEqual({ kind: 'empty' });
    expect(nothingToShow(input({ loading: 'refresh', viewportProviders: [], viewportCenter: LUNGERN }))?.kind)
      .toBe('outsideCoverage');
  });

  it('offers the three closest cities outside coverage', () => {
    const result = nothingToShow(input({ viewportProviders: [], viewportCenter: LUNGERN }));
    expect(result?.kind).toBe('outsideCoverage');
    if (result?.kind !== 'outsideCoverage') return;
    expect(result.cities.map(city => `${city.city} · ${coverageDistanceKm(city.distanceM)} km`))
      .toEqual(['Zug · 52 km', 'Bern · 57 km', 'Grenchen · 73 km']);
    expect(result.cities[0].center).toHaveLength(2);
  });

  it('is outside coverage whatever the filters say', () => {
    expect(nothingToShow(input({ viewportProviders: [], viewportCenter: LUNGERN, minBattery: 60 }))?.kind)
      .toBe('outsideCoverage');
    expect(nothingToShow(input({ viewportProviders: [], viewportCenter: null })))
      .toEqual({ kind: 'outsideCoverage', cities: [] });
  });

  it('blames the filters with the number they hide', () => {
    expect(nothingToShow(input({ enabledProviders: new Set(['lime']), minBattery: 60, unfilteredCount: 26 }))).toEqual({
      kind: 'filtersHideAll',
      hiddenCount: 26,
      summary: [{ kind: 'providers', names: ['Lime'] }, { kind: 'battery', value: 60 }],
    });
  });

  it('blames the filters without a number when it is not known', () => {
    expect(nothingToShow(input({ minBattery: 30, unfilteredCount: null }))).toEqual({
      kind: 'filtersHideAll',
      hiddenCount: null,
      summary: [{ kind: 'battery', value: 30 }],
    });
  });

  it('calls the area empty when filters are set but hide nothing', () => {
    expect(nothingToShow(input({ minBattery: 30, unfilteredCount: 0 }))).toEqual({ kind: 'empty' });
  });

  it('calls a covered area without scooters empty', () => {
    expect(nothingToShow(input())).toEqual({ kind: 'empty' });
    // A provider elsewhere being off is not a filter here.
    expect(nothingToShow(input({ enabledProviders: new Set(ZURICH), unfilteredCount: null }))).toEqual({ kind: 'empty' });
  });
});

describe('coverageDistanceKm', () => {
  it('rounds to whole kilometres and never shows zero', () => {
    expect(coverageDistanceKm(61_400)).toBe(61);
    expect(coverageDistanceKm(61_500)).toBe(62);
    expect(coverageDistanceKm(300)).toBe(1);
  });
});
