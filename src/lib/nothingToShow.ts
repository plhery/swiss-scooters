import { PROVIDERS, PROVIDER_KEYS } from '@/generated/providers';
import { nearestCoveredCities, type NearbyCoveredCity } from '@/lib/coveredCities';
import { boundsContainPoint } from '@/lib/geo';
import type { LoadFailure } from '@/lib/loadFailure';
import type { ScooterLoading } from '@/lib/scooterDataState';
import type { MapBounds, ScooterCluster, ScooterResponseMeta, Vehicle } from '@/lib/types';
import type { UiTextFormatter } from '@/lib/uiText';

/** How many cities the outside-coverage card offers. */
export const COVERAGE_CITY_COUNT = 3;

export interface FilterState {
  minBattery: number;
  enabledProviders: ReadonlySet<string>;
  /** Providers that operate in the viewport. */
  viewportProviders: readonly string[];
}

/** A filter is active when it can hide something here; providers elsewhere do not count. */
export function filtersActive({ minBattery, enabledProviders, viewportProviders }: FilterState): boolean {
  return minBattery > 0 || viewportProviders.some(provider => !enabledProviders.has(provider));
}

export type FilterSummaryPart =
  | { kind: 'providers'; names: string[] }
  | { kind: 'battery'; value: number };

/** The parts of a line such as "Lime only · battery 60% or more", in that order. */
export function filterSummary({ minBattery, enabledProviders, viewportProviders }: FilterState): FilterSummaryPart[] {
  const parts: FilterSummaryPart[] = [];
  if (viewportProviders.some(provider => !enabledProviders.has(provider))) {
    const enabled = PROVIDER_KEYS.filter(key => enabledProviders.has(key));
    const here = enabled.filter(key => viewportProviders.includes(key));
    // The selection may consist of providers that only operate elsewhere.
    const names = (here.length > 0 ? here : enabled).map(key => PROVIDERS[key].name);
    if (names.length > 0) parts.push({ kind: 'providers', names });
  }
  if (minBattery > 0) parts.push({ kind: 'battery', value: minBattery });
  return parts;
}

export function formatFilterSummary(parts: readonly FilterSummaryPart[], { locale, t, formatNumber }: UiTextFormatter): string {
  const line = parts.map(part => part.kind === 'battery'
    ? t('hidden.battery', { value: formatNumber(part.value) })
    // "Lime and Voi", "Lime und Voi", "Lime et Voi", "Lime e Voi".
    : t('hidden.only', {
        names: new Intl.ListFormat(`${locale}-CH`, { style: 'long', type: 'conjunction' }).format(part.names),
      })
  ).join(' · ');
  // The battery part starts in lower case because it usually follows the providers.
  return line.charAt(0).toLocaleUpperCase(locale) + line.slice(1);
}

/**
 * How many scooters the viewport holds when the filters are ignored: what the
 * filters hide once they hide everything. Null when the response cannot tell,
 * because the server already filtered by battery or cut the list short.
 */
export function unfilteredCountInView({ meta, vehicles, clusters, viewport, serverMinBattery }: {
  meta: Pick<ScooterResponseMeta, 'truncated'> | null;
  vehicles: readonly Pick<Vehicle, 'lat' | 'lng'>[];
  clusters: readonly Pick<ScooterCluster, 'lat' | 'lng' | 'providers'>[];
  viewport: MapBounds | null;
  /** The minBattery of the query that produced the response. */
  serverMinBattery: number;
}): number | null {
  if (!meta || !viewport || meta.truncated || serverMinBattery > 0) return null;
  let count = 0;
  for (const vehicle of vehicles) {
    if (boundsContainPoint(viewport, vehicle.lat, vehicle.lng)) count++;
  }
  for (const cluster of clusters) {
    if (!boundsContainPoint(viewport, cluster.lat, cluster.lng)) continue;
    for (const providerCount of Object.values(cluster.providers)) count += providerCount;
  }
  return count;
}

export interface NothingToShowInput extends FilterState {
  /** Scooters shown in the viewport with the current filters. */
  count: number;
  loading: ScooterLoading | null;
  failure: LoadFailure | null;
  hasData: boolean;
  /** For the closest cities; null before the map has reported its viewport. */
  viewportCenter: [number, number] | null;
  /** From unfilteredCountInView(). */
  unfilteredCount: number | null;
}

export type NothingToShow =
  /** No provider operates here. */
  | { kind: 'outsideCoverage'; cities: NearbyCoveredCity[] }
  /** hiddenCount is null when it is not known. */
  | { kind: 'filtersHideAll'; hiddenCount: number | null; summary: FilterSummaryPart[] }
  /** A covered area that has no scooters at the moment. */
  | { kind: 'empty' };

/**
 * Why the map is empty, or null when it is not, is still loading its first
 * answer for this view, or a failure already explains it. A refresh keeps the
 * answer it had.
 */
export function nothingToShow(input: NothingToShowInput): NothingToShow | null {
  if (input.count > 0 || input.loading === 'load' || input.failure || !input.hasData) return null;
  if (input.viewportProviders.length === 0) {
    return {
      kind: 'outsideCoverage',
      cities: input.viewportCenter ? nearestCoveredCities(input.viewportCenter, COVERAGE_CITY_COUNT) : [],
    };
  }
  // Filters that are set but hide nothing are not the reason the map is empty.
  if (filtersActive(input) && input.unfilteredCount !== 0) {
    return { kind: 'filtersHideAll', hiddenCount: input.unfilteredCount, summary: filterSummary(input) };
  }
  return { kind: 'empty' };
}

/** Whole kilometres for "Bern · 61 km"; never 0. */
export function coverageDistanceKm(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / 1000));
}
