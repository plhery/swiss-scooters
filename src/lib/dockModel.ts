import { PROVIDERS, PROVIDER_KEYS } from '@/generated/providers';
import type { NearbyCoveredCity } from '@/lib/coveredCities';
import { providerHealth, providersDownNotice, type ProviderHealth } from '@/lib/dataHealth';
import { boundsContainPoint } from '@/lib/geo';
import { failureReasonKey, type LoadFailure } from '@/lib/loadFailure';
import {
  coverageDistanceKm,
  nothingToShow,
  type FilterSummaryPart,
} from '@/lib/nothingToShow';
import type { ScooterLoading } from '@/lib/scooterDataState';
import type { MapBounds, ScooterResponseMeta } from '@/lib/types';
import type { UiText, UiTextFormatter } from '@/lib/uiText';

const LIVE_MAX_AGE_MS = 90_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export function originInViewport(origin: [number, number] | null, viewport: MapBounds | null): boolean {
  return origin !== null && viewport !== null && boundsContainPoint(viewport, origin[0], origin[1]);
}

export interface DockChip {
  provider: string;
  name: string;
  /** Scooters of this provider in the viewport, whether or not it is switched on. */
  count: number;
  /** Switched on in the filters (aria-pressed). */
  enabled: boolean;
  /** Drawn as selected: switched on while at least one other provider here is off. */
  selected: boolean;
  /** Not sharing data, so nothing in view: dashed, never selected, with a warning icon. */
  down: boolean;
}

export interface DockChips {
  allCount: number;
  /** The "All" chip is selected while every provider here is switched on. */
  allSelected: boolean;
  /** In display order, after "All". */
  providers: DockChip[];
}

function catalogueIndex(provider: string): number {
  const index = (PROVIDER_KEYS as string[]).indexOf(provider);
  return index < 0 ? PROVIDER_KEYS.length : index;
}

export function dockChips({ viewportProviders, providerCounts, enabledProviders, down }: {
  viewportProviders: readonly string[];
  providerCounts: Readonly<Record<string, number>>;
  enabledProviders: ReadonlySet<string>;
  /** Providers that are not sharing data, from providerHealth(). */
  down: readonly string[];
}): DockChips {
  const keys = [...new Set(viewportProviders)]
    .filter(key => PROVIDERS[key])
    .sort((a, b) => catalogueIndex(a) - catalogueIndex(b));
  const allSelected = keys.every(key => enabledProviders.has(key));
  const chips = keys.map((provider): DockChip => {
    const count = providerCounts[provider] ?? 0;
    const enabled = enabledProviders.has(provider);
    const isDown = down.includes(provider);
    return {
      provider,
      name: PROVIDERS[provider].name,
      count,
      enabled,
      selected: enabled && !allSelected && !isDown,
      down: isDown,
    };
  });
  return {
    allCount: chips.reduce((total, chip) => total + chip.count, 0),
    allSelected,
    // The sort is stable, so equal counts stay in catalogue order.
    providers: [
      ...chips.filter(chip => chip.down),
      ...chips.filter(chip => !chip.down).sort((a, b) => b.count - a.count),
    ],
  };
}

export type DockStatus =
  /** Warning style; the header also carries a "Try again" pill. */
  | { kind: 'failure'; text: UiText }
  | { kind: 'overview'; text: UiText }
  | { kind: 'delayed'; text: UiText }
  /** With the green dot. */
  | { kind: 'live'; text: UiText }
  | { kind: 'updated'; text: UiText };

export interface DockNotice {
  kind: 'providers' | 'truncated' | 'parking';
  text: UiText;
}

export interface DockCoverageCity {
  /** The chip flies to city.center. */
  city: NearbyCoveredCity;
  /** From the centre of the viewport, in whole kilometres. */
  distanceKm: number;
}

/** "Bern · 61 km" */
export function formatCoverageCity({ city, distanceKm }: DockCoverageCity, { t, formatNumber }: UiTextFormatter): string {
  return t('coverage.city', {
    city: city.city,
    distance: t('distance.kilometers', { count: formatNumber(distanceKm) }),
  });
}

export type DockModel =
  /** The scooters were removed. A card with one button, no count and no chips. */
  | { kind: 'outOfDate'; title: UiText; body: UiText[]; action: UiText; busy: boolean }
  /** No provider operates in the viewport. A card with the closest cities, no count and no chips. */
  | { kind: 'outsideCoverage'; title: UiText; body: UiText; label: UiText; cities: DockCoverageCity[] }
  /** A card with "Show all" (resets the filters) and "Edit filters". */
  | {
      kind: 'filtersHideAll';
      title: UiText;
      /** For formatFilterSummary(). */
      summary: FilterSummaryPart[];
      showAll: UiText;
      edit: UiText;
      hiddenCount: number | null;
    }
  | {
      kind: 'summary';
      /**
       * 'waiting': nothing has loaded and the load failed (the banner says why).
       * 'finding': the answer for this view is on its way. 'ready': the count is real.
       */
      phase: 'waiting' | 'finding' | 'ready';
      /** value is null while there is no count to show; then the label is the whole line. */
      count: { value: number | null; label: UiText };
      status: DockStatus | null;
      /** Show the "Try again" pill at the right of the header. */
      retry: boolean;
      /** A request is running; a retry or refresh button can show progress. */
      busy: boolean;
      notices: DockNotice[];
      chips: DockChips | null;
      /** A row under the chips. */
      hint: { kind: 'cityHint' | 'empty'; text: UiText } | null;
    };

export interface DockInput {
  /** Scooters shown in the viewport with the current filters, markers and cluster totals together. */
  count: number;
  /** The origin for walking times (your location or the chosen place) lies inside the viewport. */
  originInViewport: boolean;
  loading: ScooterLoading | null;
  failure: LoadFailure | null;
  outOfDate: boolean;
  hasData: boolean;
  meta: ScooterResponseMeta | null;
  lastUpdated: number | null;
  now: number;
  /** Scooters the whole response stands for (vehicles plus cluster totals), for the truncation notice. */
  representedCount: number;
  /** Providers that operate in the viewport. */
  viewportProviders: readonly string[];
  viewportCenter: [number, number] | null;
  /** Scooters per provider in the viewport, before the provider filter. */
  providerCounts: Readonly<Record<string, number>>;
  /**
   * Providers with a scooter in the viewport before any filter, from
   * providersInView(). Null while what is on screen cannot tell.
   */
  providersInView: ReadonlySet<string> | null;
  enabledProviders: ReadonlySet<string>;
  minBattery: number;
  /** From unfilteredCountInView(). */
  unfilteredCount: number | null;
}

type StatusInput = Pick<DockInput, 'failure' | 'meta' | 'lastUpdated' | 'now'>;

function dockStatus(input: StatusInput): { status: DockStatus | null; retry: boolean } {
  const { failure, meta, lastUpdated, now } = input;
  if (lastUpdated === null) return { status: null, retry: false };
  if (failure) {
    return {
      status: { kind: 'failure', text: { key: failure === 'offline' ? 'dock.offline' : 'dock.refreshFailed', time: lastUpdated } },
      retry: true,
    };
  }
  // Delayed data says so at every zoom, city totals included.
  if (meta?.stale) return { status: { kind: 'delayed', text: { key: 'dock.delayed', time: lastUpdated } }, retry: false };
  if (meta?.overview) return { status: { kind: 'overview', text: { key: 'dock.cityTotals' } }, retry: false };
  const age = Math.max(0, now - lastUpdated);
  if (age < LIVE_MAX_AGE_MS) return { status: { kind: 'live', text: { key: 'dock.live' } }, retry: false };
  return {
    status: {
      kind: 'updated',
      text: age < HOUR_MS
        ? { key: 'dock.updatedMinutes', numbers: { count: Math.floor(age / MINUTE_MS) } }
        : { key: 'dock.updatedAt', time: lastUpdated },
    },
    retry: false,
  };
}

export interface DockIssue {
  /** The failure or delayed status, with the same text as the dock's status line. */
  status: DockStatus;
  /** Show "Try again" beside it. */
  retry: boolean;
  busy: boolean;
}

/**
 * The card of a selected scooter or parking bay hides the count and the status
 * line. Trouble with the data then moves to one line above the card; healthy
 * data shows nothing there.
 */
export function dockIssue(input: StatusInput & Pick<DockInput, 'loading' | 'outOfDate'>): DockIssue | null {
  if (input.outOfDate) return null;
  const { status, retry } = dockStatus(input);
  if (status?.kind !== 'failure' && status?.kind !== 'delayed') return null;
  return { status, retry, busy: input.loading !== null };
}

function dockNotices(input: DockInput, health: ProviderHealth): DockNotice[] {
  const { meta } = input;
  const notices: DockNotice[] = [];
  const providers = providersDownNotice(health);
  if (providers) notices.push({ kind: 'providers', text: providers });
  if (meta?.truncated) {
    notices.push({
      kind: 'truncated',
      text: { key: 'dock.truncated', numbers: { shown: input.representedCount, total: meta.totalVehicles } },
    });
  }
  if (meta?.parkingStatus === 'failed' || meta?.parkingStatus === 'partial') {
    notices.push({ kind: 'parking', text: { key: 'dock.parkingUnavailable' } });
  } else if (meta?.parkingStatus === 'stale') {
    notices.push({ kind: 'parking', text: { key: 'dock.parkingStale' } });
  }
  return notices;
}

/**
 * Everything the dock shows while no scooter or parking bay is selected. The
 * caller renders it as it is; the texts go through formatUiText().
 */
export function dockModel(input: DockInput): DockModel {
  const busy = input.loading !== null;

  if (input.outOfDate) {
    return {
      kind: 'outOfDate',
      title: { key: 'fail.outOfDate.title' },
      body: [
        ...(input.lastUpdated === null ? [] : [{ key: 'fail.outOfDate.body', time: input.lastUpdated } satisfies UiText]),
        { key: failureReasonKey(input.failure ?? 'failed') },
      ],
      action: { key: 'fail.refresh' },
      busy,
    };
  }

  // No count yet: one line, without a status, notices or a hint.
  const pending = (phase: 'waiting' | 'finding', chips: DockChips | null): DockModel => ({
    kind: 'summary',
    phase,
    count: { value: null, label: { key: phase === 'waiting' ? 'dock.waiting' : 'dock.finding' } },
    status: null,
    retry: false,
    busy,
    notices: [],
    chips,
    hint: null,
  });
  if (!input.hasData) return pending(input.failure ? 'waiting' : 'finding', null);

  const nothing = nothingToShow(input);
  if (nothing?.kind === 'outsideCoverage') {
    return {
      kind: 'outsideCoverage',
      title: { key: 'coverage.title' },
      body: { key: 'coverage.body' },
      label: { key: 'coverage.closest' },
      cities: nothing.cities.map(city => ({ city, distanceKm: coverageDistanceKm(city.distanceM) })),
    };
  }
  if (nothing?.kind === 'filtersHideAll') {
    const { hiddenCount } = nothing;
    return {
      kind: 'filtersHideAll',
      title: hiddenCount === null
        ? { key: 'hidden.title.unknown' }
        : hiddenCount === 1
          ? { key: 'hidden.title.one' }
          : { key: 'hidden.title.other', numbers: { count: hiddenCount } },
      summary: nothing.summary,
      showAll: hiddenCount === null
        ? { key: 'hidden.showAll' }
        : { key: 'hidden.showAll.count', numbers: { count: hiddenCount } },
      edit: { key: 'hidden.edit' },
      hiddenCount,
    };
  }

  const health = providerHealth({
    meta: input.meta,
    viewportProviders: input.viewportProviders,
    inView: input.providersInView,
  });
  const providerChips = dockChips({ ...input, down: health.down });
  // "All" on its own filters nothing, so there are chips only where providers operate.
  const chips = providerChips.providers.length > 0 ? providerChips : null;
  // A failure already explains an empty view, so it never reads "Finding scooters…".
  if (input.loading === 'load' && input.count === 0 && !input.failure) return pending('finding', chips);

  const scope = input.originInViewport ? 'nearby' : 'onMap';
  return {
    kind: 'summary',
    phase: 'ready',
    count: {
      value: input.count,
      // Which counts take the singular depends on the language: French says "0 trottinette".
      label: { key: `dock.${scope}.other`, one: { key: `dock.${scope}.one`, count: input.count } },
    },
    ...dockStatus(input),
    busy,
    notices: dockNotices(input, health),
    chips,
    hint: nothing?.kind === 'empty'
      ? { kind: 'empty', text: { key: 'dock.empty' } }
      : input.meta?.overview && input.count > 0
        ? { kind: 'cityHint', text: { key: 'dock.cityHint' } }
        : null,
  };
}
