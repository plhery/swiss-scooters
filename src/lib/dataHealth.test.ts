import { describe, expect, it } from 'vitest';
import {
  providerForFailedSource,
  providerHealth,
  providersDownNotice,
  providersInView,
} from '@/lib/dataHealth';
import { independentCollectableFeeds } from '@/lib/scooterFeeds';

const ZURICH = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'publibike'];

describe('providerForFailedSource', () => {
  it('finds the provider behind the ids the API reports', () => {
    expect(providerForFailedSource('national:lime_zurich')).toBe('lime');
    expect(providerForFailedSource('national:voi_winterthur')).toBe('voi');
    expect(providerForFailedSource('france:dott_fr_bordeaux')).toBe('dott');
    expect(providerForFailedSource('germany:bolt_de_stuttgart')).toBe('bolt');
    expect(providerForFailedSource('italy:bird_it_rome')).toBe('bird');
    expect(providerForFailedSource('hopp')).toBe('hopp');
    expect(providerForFailedSource('publibike')).toBe('publibike');
    expect(providerForFailedSource('national:velospot')).toBe('publibike');
    expect(providerForFailedSource('LIME_ZURICH')).toBe('lime');
  });

  it('knows no provider for the overview and other sources', () => {
    expect(providerForFailedSource('city-overview')).toBeNull();
    expect(providerForFailedSource('national:tier_basel')).toBeNull();
    expect(providerForFailedSource('')).toBeNull();
  });

  it('resolves the id of every feed the server collects', () => {
    for (const feed of independentCollectableFeeds()) {
      expect(providerForFailedSource(feed.id), feed.id).toBe(feed.provider);
    }
  });
});

describe('providersInView', () => {
  const VIEW = { south: 47.37, west: 8.53, north: 47.38, east: 8.55 };
  const inside = { lat: 47.375, lng: 8.54 };
  const outside = { lat: 47.5, lng: 8.72 };

  it('lists who has a scooter or a share of a cluster inside the viewport', () => {
    expect(providersInView({
      vehicles: [{ provider: 'lime', ...inside }, { provider: 'lime', ...inside }, { provider: 'voi', ...outside }],
      clusters: [
        { ...inside, providers: { bolt: 3, dott: 0 } },
        { ...outside, providers: { bird: 9 } },
      ],
      viewport: VIEW,
      serverMinBattery: 0,
    })).toEqual(new Set(['lime', 'bolt']));
    expect(providersInView({ vehicles: [], clusters: [], viewport: VIEW, serverMinBattery: 0 })).toEqual(new Set());
  });

  it('cannot tell before the map has a viewport, or once the server filtered by battery', () => {
    const vehicles = [{ provider: 'lime', ...inside }];
    expect(providersInView({ vehicles, clusters: [], viewport: null, serverMinBattery: 0 })).toBeNull();
    expect(providersInView({ vehicles, clusters: [], viewport: VIEW, serverMinBattery: 60 })).toBeNull();
  });
});

describe('providerHealth', () => {
  const NOBODY = { down: [], unknown: false };
  const health = (
    failedSources: string[],
    inView: string[] | null = [],
    { viewportProviders = ZURICH, overview = false } = {}
  ) => providerHealth({
    meta: { failedSources, ...(overview ? { overview } : {}) },
    viewportProviders,
    inView: inView && new Set(inView),
  });

  it('reports nothing for a healthy or missing response', () => {
    expect(health([])).toEqual(NOBODY);
    expect(providerHealth({ meta: null, viewportProviders: ZURICH, inView: new Set() })).toEqual(NOBODY);
    expect(providerHealth({ meta: undefined, viewportProviders: ZURICH, inView: new Set() })).toEqual(NOBODY);
  });

  it('calls a provider down when a feed of its failed and none of its scooters is in view', () => {
    expect(health(['national:bird_zurich'], ['lime', 'voi'])).toEqual({ down: ['bird'], unknown: false });
  });

  it('stays silent about a provider with a failed feed that still has scooters in view', () => {
    // Uster's feed failed; Zürich's did not, and its scooters are on screen.
    expect(health(['national:lime_uster'], ['lime', 'voi'])).toEqual(NOBODY);
    expect(health(['national:lime_uster', 'national:bird_zurich', 'national:voi_winterthur'], ['lime', 'voi']))
      .toEqual({ down: ['bird'], unknown: false });
  });

  it('names nobody while city totals are shown, whatever failed', () => {
    expect(health(['national:bird_zurich', 'france:dott_fr_lyon', 'city-overview'], ['lime'], { overview: true }))
      .toEqual(NOBODY);
    expect(health(['city-overview'], [], { overview: true })).toEqual(NOBODY);
  });

  it('names nobody while what is on screen cannot tell who has scooters here', () => {
    expect(health(['national:bird_zurich', 'city-overview'], null)).toEqual(NOBODY);
  });

  it('names each failed provider once, in catalogue order', () => {
    expect(health(['national:voi_zurich', 'national:bird_zurich', 'national:voi_winterthur', 'hopp']))
      .toEqual({ down: ['bird', 'hopp', 'voi'], unknown: false });
  });

  it('leaves out providers that do not operate in the viewport', () => {
    expect(health(['france:pony_fr_bordeaux', 'national:lime_zurich'])).toEqual({ down: ['lime'], unknown: false });
    expect(health(['national:lime_zurich'], [], { viewportProviders: [] })).toEqual(NOBODY);
  });

  it('flags sources that belong to no provider', () => {
    expect(health(['national'])).toEqual({ down: [], unknown: true });
    expect(health(['national:tier_basel', 'national:dott_zurich'])).toEqual({ down: ['dott'], unknown: true });
    // Also when the provider that failed beside it is not named.
    expect(health(['national:tier_basel', 'national:dott_zurich'], ['dott'])).toEqual({ down: [], unknown: true });
  });
});

describe('providersDownNotice', () => {
  it('names one or two providers and counts more', () => {
    expect(providersDownNotice({ down: ['bird'], unknown: false }))
      .toEqual({ key: 'dock.down.one', values: { name: 'Bird' } });
    expect(providersDownNotice({ down: ['bird', 'dott'], unknown: false }))
      .toEqual({ key: 'dock.down.two', values: { first: 'Bird', second: 'Dott' } });
    expect(providersDownNotice({ down: ['bird', 'dott', 'publibike'], unknown: false }))
      .toEqual({ key: 'dock.down.many', numbers: { count: 3 } });
  });

  it('stays vague only when no provider can be named', () => {
    expect(providersDownNotice({ down: [], unknown: true })).toEqual({ key: 'dock.down.some' });
    expect(providersDownNotice({ down: ['lime'], unknown: true }))
      .toEqual({ key: 'dock.down.one', values: { name: 'Lime' } });
    expect(providersDownNotice({ down: [], unknown: false })).toBeNull();
  });
});
