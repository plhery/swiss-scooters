import { describe, expect, it } from 'vitest';
import {
  dockChips,
  dockIssue,
  dockModel,
  formatCoverageCity,
  originInViewport,
  type DockInput,
  type DockModel,
} from '@/lib/dockModel';
import type { TranslationKey } from '@/lib/i18n';
import type { ScooterResponseMeta } from '@/lib/types';
import type { UiTextFormatter } from '@/lib/uiText';

const NOW = Date.parse('2026-10-03T12:03:00.000Z');
const ALL = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'pony', 'publibike'];
const ZURICH = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'publibike'];
const LUNGERN: [number, number] = [46.7741, 8.1558];

function meta(overrides: Partial<ScooterResponseMeta> = {}): ScooterResponseMeta {
  return {
    generatedAt: new Date(NOW - 30_000).toISOString(),
    partial: false,
    stale: false,
    failedSources: [],
    sources: {},
    truncated: false,
    totalVehicles: 22,
    mode: 'vehicles',
    zoom: 16,
    ...overrides,
  };
}

function input(overrides: Partial<DockInput> = {}): DockInput {
  return {
    count: 22,
    originInViewport: false,
    loading: null,
    failure: null,
    outOfDate: false,
    hasData: true,
    meta: meta(),
    lastUpdated: NOW - 30_000,
    now: NOW,
    representedCount: 22,
    viewportProviders: ZURICH,
    viewportCenter: [47.3769, 8.5417],
    providerCounts: { lime: 7, voi: 9, bolt: 2, dott: 4 },
    providersInView: new Set(['lime', 'voi', 'bolt', 'dott']),
    enabledProviders: new Set(ALL),
    minBattery: 0,
    unfilteredCount: 22,
    ...overrides,
  };
}

function summary(overrides: Partial<DockInput> = {}): Extract<DockModel, { kind: 'summary' }> {
  const model = dockModel(input(overrides));
  if (model.kind !== 'summary') throw new Error(`Expected the summary, got ${model.kind}`);
  return model;
}

describe('originInViewport', () => {
  const viewport = { south: 47.36, west: 8.52, north: 47.39, east: 8.57 };

  it('is true only for an origin inside the viewport', () => {
    expect(originInViewport([47.377, 8.542], viewport)).toBe(true);
    expect(originInViewport([47.5, 8.542], viewport)).toBe(false);
    expect(originInViewport(null, viewport)).toBe(false);
    expect(originInViewport([47.377, 8.542], null)).toBe(false);
  });
});

describe('dock count', () => {
  it('says "nearby" while the origin is in the viewport and "on this map" otherwise', () => {
    expect(summary({ originInViewport: true }).count).toEqual({ value: 22, label: { key: 'dock.nearby.other' } });
    expect(summary().count).toEqual({ value: 22, label: { key: 'dock.onMap.other' } });
  });

  it('has singular forms', () => {
    expect(summary({ count: 1, originInViewport: true }).count).toEqual({ value: 1, label: { key: 'dock.nearby.one' } });
    expect(summary({ count: 1 }).count).toEqual({ value: 1, label: { key: 'dock.onMap.one' } });
  });

  it('reads "Finding scooters…" on the first load, with nothing else', () => {
    const model = summary({ hasData: false, meta: null, lastUpdated: null, loading: 'load', count: 0, providerCounts: {} });
    expect(model).toEqual({
      kind: 'summary',
      phase: 'finding',
      count: { value: null, label: { key: 'dock.finding' } },
      status: null,
      retry: false,
      busy: true,
      notices: [],
      chips: null,
      hint: null,
    });
  });

  it('reads "Waiting for scooter data" without count or chips when the first load failed', () => {
    const failed = { hasData: false, meta: null, lastUpdated: null, count: 0, providerCounts: {}, failure: 'offline' } as const;
    expect(summary(failed)).toMatchObject({
      phase: 'waiting',
      count: { value: null, label: { key: 'dock.waiting' } },
      status: null,
      retry: false,
      busy: false,
      notices: [],
      chips: null,
      hint: null,
    });
    // The same while a retry runs: the banner, not the dock, explains.
    expect(summary({ ...failed, loading: 'load' })).toMatchObject({ phase: 'waiting', busy: true });
  });

  it('reads "Finding scooters…" for a new view that shows nothing yet, and keeps the chips in place', () => {
    const model = summary({ loading: 'load', count: 0, providerCounts: {} });
    expect(model).toMatchObject({ phase: 'finding', count: { value: null, label: { key: 'dock.finding' } }, status: null, notices: [], hint: null });
    expect(model.chips?.providers).toHaveLength(ZURICH.length);
  });

  it('keeps the count of what is still in view while a new view loads', () => {
    expect(summary({ loading: 'load', count: 5 })).toMatchObject({ phase: 'ready', count: { value: 5 }, busy: true });
  });

  it('does not change during a refresh', () => {
    const { busy: idle, ...before } = summary();
    const { busy, ...during } = summary({ loading: 'refresh' });
    expect(during).toEqual(before);
    expect([idle, busy]).toEqual([false, true]);
  });
});

describe('dock status', () => {
  it('is live for data younger than ninety seconds', () => {
    expect(summary().status).toEqual({ kind: 'live', text: { key: 'dock.live' } });
    expect(summary({ lastUpdated: NOW - 89_999 }).status?.kind).toBe('live');
    // A clock that runs behind the server does not produce a negative age.
    expect(summary({ lastUpdated: NOW + 5_000 }).status?.kind).toBe('live');
  });

  it('counts whole minutes from ninety seconds to an hour', () => {
    expect(summary({ lastUpdated: NOW - 90_000 }).status)
      .toEqual({ kind: 'updated', text: { key: 'dock.updatedMinutes', numbers: { count: 1 } } });
    expect(summary({ lastUpdated: NOW - 4 * 60_000 - 59_000 }).status)
      .toEqual({ kind: 'updated', text: { key: 'dock.updatedMinutes', numbers: { count: 4 } } });
    expect(summary({ lastUpdated: NOW - 3_599_999 }).status)
      .toEqual({ kind: 'updated', text: { key: 'dock.updatedMinutes', numbers: { count: 59 } } });
  });

  it('shows the clock time from an hour', () => {
    expect(summary({ lastUpdated: NOW - 3_600_000 }).status)
      .toEqual({ kind: 'updated', text: { key: 'dock.updatedAt', time: NOW - 3_600_000 } });
  });

  it('says the data is delayed when the server serves old feeds', () => {
    expect(summary({ meta: meta({ stale: true }) }).status)
      .toEqual({ kind: 'delayed', text: { key: 'dock.delayed', time: NOW - 30_000 } });
  });

  it('describes the city overview without an age', () => {
    const overview = meta({ overview: true, mode: 'clusters', zoom: 8 });
    expect(summary({ meta: overview, lastUpdated: NOW - 50 * 60_000 }).status)
      .toEqual({ kind: 'overview', text: { key: 'dock.cityTotals' } });
  });

  it('says that city totals are delayed, as at every other zoom', () => {
    const overview = meta({ overview: true, mode: 'clusters', zoom: 8, stale: true });
    expect(summary({ meta: overview, lastUpdated: NOW - 4 * 3_600_000 }).status)
      .toEqual({ kind: 'delayed', text: { key: 'dock.delayed', time: NOW - 4 * 3_600_000 } });
  });

  it('puts a failed refresh first, with the time of the data and a retry', () => {
    const failed = summary({ failure: 'timeout', meta: meta({ overview: true, stale: true }) });
    expect(failed.status).toEqual({ kind: 'failure', text: { key: 'dock.refreshFailed', time: NOW - 30_000 } });
    expect(failed.retry).toBe(true);
    for (const failure of ['busy', 'unavailable', 'failed'] as const) {
      expect(summary({ failure }).status).toEqual({ kind: 'failure', text: { key: 'dock.refreshFailed', time: NOW - 30_000 } });
    }
  });

  it('says so when the reason is being offline', () => {
    expect(summary({ failure: 'offline' })).toMatchObject({
      status: { kind: 'failure', text: { key: 'dock.offline', time: NOW - 30_000 } },
      retry: true,
    });
  });

  it('offers no retry while nothing failed', () => {
    expect(summary().retry).toBe(false);
    expect(summary({ meta: meta({ stale: true }) }).retry).toBe(false);
  });

  it('keeps the count and the chips when a refresh failed and nothing is in view', () => {
    const model = summary({ failure: 'offline', count: 0, providerCounts: {} });
    expect(model).toMatchObject({ phase: 'ready', count: { value: 0, label: { key: 'dock.onMap.other' } }, retry: true, hint: null });
    expect(model.chips?.providers).toHaveLength(ZURICH.length);
    // And never "Finding scooters…" while the retries run.
    expect(summary({ failure: 'offline', count: 0, loading: 'load' }).phase).toBe('ready');
  });

  it('explains a failed refresh instead of the coverage when the view moved outside it', () => {
    const model = summary({ failure: 'offline', count: 0, providerCounts: {}, viewportProviders: [] });
    expect(model).toMatchObject({ phase: 'ready', count: { value: 0 }, status: { kind: 'failure' }, retry: true, chips: null });
    // A provider this build does not know cannot be a chip either.
    expect(summary({ viewportProviders: ['tier'] }).chips).toBeNull();
  });
});

describe('dock notices', () => {
  it('has none for a healthy response', () => {
    expect(summary().notices).toEqual([]);
  });

  it('names providers that are not sharing data and have nothing in view', () => {
    const failed = (...failedSources: string[]) => summary({
      meta: meta({ partial: true, failedSources }),
      providerCounts: { lime: 7, voi: 9 },
      providersInView: new Set(['lime', 'voi']),
    }).notices;
    expect(failed('national:bird_zurich'))
      .toEqual([{ kind: 'providers', text: { key: 'dock.down.one', values: { name: 'Bird' } } }]);
    expect(failed('national:bird_zurich', 'national:dott_zurich')[0].text)
      .toEqual({ key: 'dock.down.two', values: { first: 'Bird', second: 'Dott' } });
    expect(failed('national:bird_zurich', 'national:dott_zurich', 'hopp')[0].text)
      .toEqual({ key: 'dock.down.many', numbers: { count: 3 } });
  });

  it('says nothing about a provider with a failed feed whose scooters are in view', () => {
    // One city feed failed; the provider's scooters on screen come from another.
    const model = summary({ meta: meta({ partial: true, failedSources: ['national:lime_uster', 'national:voi_winterthur'] }) });
    expect(model.notices).toEqual([]);
    expect(model.chips?.providers.some(chip => chip.down)).toBe(false);
    expect(model.chips?.providers.map(chip => chip.provider).slice(0, 2)).toEqual(['voi', 'lime']);
  });

  it('keeps calling a provider down whose scooters the filters would hide anyway', () => {
    // Dott has scooters here, but none with the battery asked for: it is not down.
    const filtered = summary({
      meta: meta({ failedSources: ['national:dott_zurich', 'national:bird_zurich'] }),
      minBattery: 60,
      providerCounts: { lime: 7, voi: 9 },
      enabledProviders: new Set(['lime']),
      count: 7,
    });
    expect(filtered.notices).toEqual([{ kind: 'providers', text: { key: 'dock.down.one', values: { name: 'Bird' } } }]);
    expect(filtered.chips?.providers.filter(chip => chip.down).map(chip => chip.provider)).toEqual(['bird']);
    expect(filtered.chips?.providers.find(chip => chip.provider === 'dott')).toMatchObject({ count: 0, down: false });
  });

  it('names nobody while city totals are shown', () => {
    const overview = summary({
      meta: meta({
        overview: true, mode: 'clusters', zoom: 8, partial: true,
        failedSources: ['national:bird_zurich', 'france:dott_fr_lyon', 'city-overview'],
      }),
      count: 5727,
      providerCounts: { lime: 3000, voi: 2727 },
      providersInView: new Set(['lime', 'voi']),
    });
    expect(overview.status).toEqual({ kind: 'overview', text: { key: 'dock.cityTotals' } });
    expect(overview.notices).toEqual([]);
    expect(overview.chips?.providers.some(chip => chip.down)).toBe(false);
    expect(overview.chips?.providers.find(chip => chip.provider === 'bird')).toMatchObject({ count: 0, down: false });
  });

  it('names nobody while the data on screen was loaded for another view', () => {
    const elsewhere = { meta: meta({ failedSources: ['national:bird_zurich', 'national'] }), providersInView: null };
    // Part of the old area is still on screen while the new one loads, or after it failed to.
    for (const state of [{ loading: 'load' }, { failure: 'timeout' }] satisfies Partial<DockInput>[]) {
      const model = summary({ ...elsewhere, ...state });
      expect(model.notices).toEqual([]);
      expect(model.chips?.providers.some(chip => chip.down)).toBe(false);
    }
    const finding = summary({ ...elsewhere, loading: 'load', count: 0, providerCounts: {} });
    expect(finding.phase).toBe('finding');
    expect(finding.chips?.providers.some(chip => chip.down)).toBe(false);
  });

  it('keeps the provider that is down while a neighbouring view loads with what was known just before', () => {
    // The page hands on who had scooters in the view before the move; Bird had none.
    const nearby = {
      meta: meta({ failedSources: ['national:bird_zurich'] }),
      providersInView: new Set(['lime', 'voi']),
      loading: 'load',
    } satisfies Partial<DockInput>;
    const model = summary(nearby);
    expect(model.notices).toEqual([{ kind: 'providers', text: { key: 'dock.down.one', values: { name: 'Bird' } } }]);
    expect(model.chips?.providers[0]).toMatchObject({ provider: 'bird', down: true });
    // With nothing left on screen the count is on its way, and the chip stays dashed and first.
    const finding = summary({ ...nearby, count: 0, providerCounts: {} });
    expect(finding.phase).toBe('finding');
    expect(finding.chips?.providers[0]).toMatchObject({ provider: 'bird', down: true });
  });

  it('stays vague about sources it cannot name and silent about providers elsewhere', () => {
    expect(summary({ meta: meta({ failedSources: ['national'] }) }).notices)
      .toEqual([{ kind: 'providers', text: { key: 'dock.down.some' } }]);
    expect(summary({ meta: meta({ failedSources: ['france:pony_fr_bordeaux'] }) }).notices).toEqual([]);
  });

  it('says how much of a truncated result is shown', () => {
    expect(summary({ meta: meta({ truncated: true, totalVehicles: 5412 }), representedCount: 2000 }).notices)
      .toEqual([{ kind: 'truncated', text: { key: 'dock.truncated', numbers: { shown: 2000, total: 5412 } } }]);
  });

  it('reports parking bays that are missing or old', () => {
    expect(summary({ meta: meta({ parkingStatus: 'failed' }) }).notices)
      .toEqual([{ kind: 'parking', text: { key: 'dock.parkingUnavailable' } }]);
    expect(summary({ meta: meta({ parkingStatus: 'partial' }) }).notices[0].text.key).toBe('dock.parkingUnavailable');
    expect(summary({ meta: meta({ parkingStatus: 'stale' }) }).notices)
      .toEqual([{ kind: 'parking', text: { key: 'dock.parkingStale' } }]);
    expect(summary({ meta: meta({ parkingStatus: 'fresh' }) }).notices).toEqual([]);
    expect(summary({ meta: meta({ parkingStatus: 'skipped' }) }).notices).toEqual([]);
  });

  it('lists them in a fixed order, one line each', () => {
    expect(summary({
      meta: meta({ failedSources: ['hopp'], truncated: true, totalVehicles: 9000, parkingStatus: 'stale' }),
    }).notices.map(notice => notice.kind)).toEqual(['providers', 'truncated', 'parking']);
  });
});

describe('dock chips', () => {
  const chips = (overrides: Partial<Parameters<typeof dockChips>[0]> = {}) => dockChips({
    viewportProviders: ZURICH,
    providerCounts: { lime: 7, voi: 9, bolt: 2, dott: 7 },
    enabledProviders: new Set(ALL),
    down: [],
    ...overrides,
  });

  it('sorts by count and keeps catalogue order between equal counts', () => {
    const { providers, allCount, allSelected } = chips();
    expect(providers.map(chip => `${chip.provider}:${chip.count}`))
      .toEqual(['voi:9', 'dott:7', 'lime:7', 'bolt:2', 'bird:0', 'hopp:0', 'publibike:0']);
    expect(allCount).toBe(25);
    expect(allSelected).toBe(true);
    expect(providers.every(chip => chip.enabled && !chip.selected && !chip.down)).toBe(true);
    expect(providers[0].name).toBe('Voi');
  });

  it('puts a provider that is down right after "All", dashed and unselected', () => {
    const { providers } = chips({ down: ['bird', 'publibike'], enabledProviders: new Set(['bird', 'lime']) });
    expect(providers.map(chip => chip.provider))
      .toEqual(['bird', 'publibike', 'voi', 'dott', 'lime', 'bolt', 'hopp']);
    expect(providers[0]).toEqual({ provider: 'bird', name: 'Bird', count: 0, enabled: true, selected: false, down: true });
    expect(providers[1]).toMatchObject({ provider: 'publibike', enabled: false, selected: false, down: true });
  });

  it('marks the providers that are on as selected once another one here is off', () => {
    const { providers, allSelected } = chips({ enabledProviders: new Set(['lime', 'voi', 'pony']) });
    expect(allSelected).toBe(false);
    expect(providers.filter(chip => chip.selected).map(chip => chip.provider)).toEqual(['voi', 'lime']);
    expect(providers.filter(chip => chip.enabled).map(chip => chip.provider)).toEqual(['voi', 'lime']);
  });

  it('counts scooters of providers that are switched off in "All"', () => {
    expect(chips({ enabledProviders: new Set(['lime']) }).allCount).toBe(25);
  });

  it('shows only known providers that operate here, each once', () => {
    const { providers } = chips({
      viewportProviders: ['pony', 'dott', 'dott', 'tier'],
      providerCounts: { dott: 3, pony: 3, tier: 8, lime: 5 },
    });
    expect(providers.map(chip => chip.provider)).toEqual(['dott', 'pony']);
  });

  it('is part of the summary with the health of the response applied', () => {
    const model = summary({ meta: meta({ failedSources: ['national:bird_zurich'] }) });
    expect(model.chips?.providers[0]).toMatchObject({ provider: 'bird', down: true });
    expect(model.chips?.allCount).toBe(22);
  });
});

describe('dock hints', () => {
  it('invites a tap on a city in the overview', () => {
    const overview = meta({ overview: true, mode: 'clusters', zoom: 8 });
    expect(summary({ meta: overview, count: 5727 }).hint).toEqual({ kind: 'cityHint', text: { key: 'dock.cityHint' } });
    expect(summary().hint).toBeNull();
  });

  it('explains an empty covered area under the normal count', () => {
    const model = summary({ count: 0, providerCounts: {}, unfilteredCount: 0 });
    expect(model).toMatchObject({
      phase: 'ready',
      count: { value: 0, label: { key: 'dock.onMap.other' } },
      status: { kind: 'live' },
      hint: { kind: 'empty', text: { key: 'dock.empty' } },
    });
    expect(model.chips?.allCount).toBe(0);
    // Also in the overview, where there is then no city to tap.
    expect(summary({ count: 0, providerCounts: {}, unfilteredCount: 0, meta: meta({ overview: true }) }).hint?.kind).toBe('empty');
  });
});

describe('dock cards', () => {
  it('shows the out-of-date card with the last update and the reason', () => {
    expect(dockModel(input({
      outOfDate: true, hasData: false, failure: 'offline', count: 0, lastUpdated: NOW - 400_000,
    }))).toEqual({
      kind: 'outOfDate',
      title: { key: 'fail.outOfDate.title' },
      body: [{ key: 'fail.outOfDate.body', time: NOW - 400_000 }, { key: 'fail.offline' }],
      action: { key: 'fail.refresh' },
      busy: false,
    });
  });

  it('keeps the out-of-date card while a refresh runs, whatever else is true', () => {
    const model = dockModel(input({
      outOfDate: true, hasData: false, failure: 'unavailable', count: 0, loading: 'load', viewportProviders: [],
    }));
    expect(model).toMatchObject({ kind: 'outOfDate', busy: true, body: [{ key: 'fail.outOfDate.body' }, { key: 'fail.unavailable' }] });
  });

  it('shows the closest cities outside coverage, with whole kilometres', () => {
    const model = dockModel(input({ count: 0, providerCounts: {}, viewportProviders: [], viewportCenter: LUNGERN, unfilteredCount: 0 }));
    expect(model).toMatchObject({
      kind: 'outsideCoverage',
      title: { key: 'coverage.title' },
      body: { key: 'coverage.body' },
      label: { key: 'coverage.closest' },
    });
    if (model.kind !== 'outsideCoverage') return;
    expect(model.cities.map(({ city, distanceKm }) => `${city.city} · ${distanceKm} km`))
      .toEqual(['Zug · 52 km', 'Bern · 57 km', 'Grenchen · 73 km']);
    expect(model.cities[1].city.center).toEqual([46.948, 7.4474]);

    const templates: Record<string, string> = { 'coverage.city': '{city} · {distance}', 'distance.kilometers': '{count} km' };
    const i18n: UiTextFormatter = {
      locale: 'en',
      t: (key: TranslationKey, values = {}) => Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        templates[key] ?? key
      ),
      formatNumber: value => String(value),
    };
    expect(model.cities.map(city => formatCoverageCity(city, i18n)))
      .toEqual(['Zug · 52 km', 'Bern · 57 km', 'Grenchen · 73 km']);
  });

  it('shows how many scooters the filters hide and offers to show them', () => {
    expect(dockModel(input({
      count: 0, enabledProviders: new Set(['lime']), minBattery: 60, providerCounts: {}, unfilteredCount: 26,
    }))).toEqual({
      kind: 'filtersHideAll',
      title: { key: 'hidden.title.other', numbers: { count: 26 } },
      summary: [{ kind: 'providers', names: ['Lime'] }, { kind: 'battery', value: 60 }],
      showAll: { key: 'hidden.showAll.count', numbers: { count: 26 } },
      edit: { key: 'hidden.edit' },
      hiddenCount: 26,
    });
  });

  it('has a singular title for one hidden scooter', () => {
    expect(dockModel(input({ count: 0, minBattery: 80, unfilteredCount: 1 }))).toMatchObject({
      kind: 'filtersHideAll',
      title: { key: 'hidden.title.one' },
      showAll: { key: 'hidden.showAll.count', numbers: { count: 1 } },
    });
  });

  it('does not invent a number when the hidden count is unknown', () => {
    expect(dockModel(input({ count: 0, minBattery: 30, unfilteredCount: null }))).toMatchObject({
      kind: 'filtersHideAll',
      title: { key: 'hidden.title.unknown' },
      showAll: { key: 'hidden.showAll' },
      hiddenCount: null,
    });
  });

  it('shows no card while the view is loading or a refresh failed', () => {
    expect(dockModel(input({ count: 0, viewportProviders: [], loading: 'load' })).kind).toBe('summary');
    expect(dockModel(input({ count: 0, minBattery: 30, unfilteredCount: 9, failure: 'timeout' })).kind).toBe('summary');
  });

  it('keeps a card during a refresh', () => {
    expect(dockModel(input({ count: 0, viewportProviders: [], viewportCenter: LUNGERN, loading: 'refresh' })).kind)
      .toBe('outsideCoverage');
    expect(dockModel(input({ count: 0, minBattery: 30, unfilteredCount: 9, loading: 'refresh' })).kind).toBe('filtersHideAll');
  });
});

describe('dock issue, for the line above a card', () => {
  it('is nothing while the data is healthy', () => {
    expect(dockIssue(input())).toBeNull();
    expect(dockIssue(input({ lastUpdated: NOW - 20 * 60_000 }))).toBeNull();
    expect(dockIssue(input({ meta: meta({ overview: true, mode: 'clusters', zoom: 8 }) }))).toBeNull();
  });

  it('repeats a failed refresh with the same words and a retry', () => {
    const failed = input({ failure: 'timeout', loading: 'refresh' });
    expect(dockIssue(failed)).toEqual({
      status: summary({ failure: 'timeout' }).status,
      retry: true,
      busy: true,
    });
    expect(dockIssue(input({ failure: 'offline' }))).toEqual({
      status: { kind: 'failure', text: { key: 'dock.offline', time: NOW - 30_000 } },
      retry: true,
      busy: false,
    });
  });

  it('repeats delayed data without a retry, also where a card has replaced the count', () => {
    const hidden = input({ count: 0, minBattery: 30, unfilteredCount: 9, meta: meta({ stale: true }) });
    expect(dockModel(hidden).kind).toBe('filtersHideAll');
    expect(dockIssue(hidden)).toEqual({
      status: { kind: 'delayed', text: { key: 'dock.delayed', time: NOW - 30_000 } },
      retry: false,
      busy: false,
    });
  });

  it('leaves the explanation to the out-of-date card', () => {
    expect(dockIssue(input({ outOfDate: true, hasData: false, failure: 'offline' }))).toBeNull();
  });
});
