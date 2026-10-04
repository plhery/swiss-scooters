import { describe, expect, it } from 'vitest';
import {
  providerForFailedSource,
  providerHealth,
  providersDownNotice,
  scooterDataHealthNotice,
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

describe('providerHealth', () => {
  it('reports nothing for a healthy or missing response', () => {
    expect(providerHealth({ failedSources: [] }, ZURICH)).toEqual({ down: [], unknown: false });
    expect(providerHealth(null, ZURICH)).toEqual({ down: [], unknown: false });
    expect(providerHealth(undefined, ZURICH)).toEqual({ down: [], unknown: false });
  });

  it('names each failed provider once, in catalogue order', () => {
    expect(providerHealth({
      failedSources: ['national:voi_zurich', 'national:bird_zurich', 'national:voi_winterthur', 'hopp'],
    }, ZURICH)).toEqual({ down: ['bird', 'hopp', 'voi'], unknown: false });
  });

  it('leaves out providers that do not operate in the viewport', () => {
    expect(providerHealth({ failedSources: ['france:pony_fr_bordeaux', 'national:lime_zurich'] }, ZURICH))
      .toEqual({ down: ['lime'], unknown: false });
    expect(providerHealth({ failedSources: ['national:lime_zurich'] }, [])).toEqual({ down: [], unknown: false });
  });

  it('flags sources that belong to no provider', () => {
    expect(providerHealth({ failedSources: ['city-overview'] }, ZURICH)).toEqual({ down: [], unknown: true });
    expect(providerHealth({ failedSources: ['city-overview', 'national:dott_zurich'] }, ZURICH))
      .toEqual({ down: ['dott'], unknown: true });
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

describe('scooterDataHealthNotice', () => {
  it('returns no notice for a complete fresh response', () => {
    expect(scooterDataHealthNotice({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { national: 'fresh', hopp: 'fresh' },
      generatedAt: '2026-08-05T12:00:00.000Z',
      truncated: false,
      totalVehicles: 12,
      mode: 'vehicles',
      zoom: 17,
    }, 12)).toBeNull();
  });

  it('combines stale, partial, and truncation warnings', () => {
    const format = (value: number) => value.toLocaleString();
    expect(scooterDataHealthNotice({
      partial: true,
      stale: true,
      failedSources: ['national:lime_zurich'],
      sources: { national: 'partial', hopp: 'stale' },
      generatedAt: '2026-08-05T12:00:00.000Z',
      truncated: true,
      totalVehicles: 6_200,
      mode: 'vehicles',
      zoom: 17,
    }, 5_000)).toBe([
      'Showing cached data',
      'Some providers unavailable',
      `Showing ${format(5_000)} of ${format(6_200)} results`,
    ].join(' · '));
  });
});
