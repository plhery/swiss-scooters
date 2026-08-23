import {
  coverageForRegionNames,
  coverageIntersects,
  HOPP_COVERAGE,
  knownSystemCoverage,
  PUBLIBIKE_FREE_FLOATING_COVERAGE,
} from '@/lib/feedCoverage';
import { boundsContainPoint, haversineM } from '@/lib/geo';
import type { MapBounds, Vehicle } from '@/lib/types';
import { legacyRentalLink, normalizeRentalUris } from '@/lib/rentalLinks';
import { upstreamJsonCache, type CachedJson } from '@/lib/upstreamJsonCache';
import {
  providerKeyForSystemId,
  type ProviderKey,
} from '@/generated/providers';

const NATIONAL_V23_REGISTRY_URL = 'https://sharedmobility.ch/v2/gbfs';
const SPATIAL_IDENTIFY_URL = 'https://api.sharedmobility.ch/v1/sharedmobility/identify';
const HOPP_DISCOVERY_URL = 'https://api.hopp.bike/gbfs/ch-zurich/gbfs.json';
const PUBLIBIKE_FREE_FLOATING_URL =
  'https://velospot.info/customer/public/api/pbvsng/freeFloating';
const PUBLIBIKE_ESCOOTER_TYPE = 5;

const STATUS_REVALIDATE_SECONDS = 30;
const METADATA_REVALIDATE_SECONDS = 3600;
const STATUS_STALE_IF_ERROR_SECONDS = 300;
const METADATA_STALE_IF_ERROR_SECONDS = 86400;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_EMAIL = 'swiss-scooters@plhery.com';

type AvailabilityFlag = boolean | 0 | 1;

interface RawVehicle {
  lat?: number;
  lon?: number;
  lng?: number;
  current_fuel_percent?: number;
  current_range_meters?: number;
  hopp_battery_level?: number;
  hopp_deeplink?: string;
  bike_id?: string;
  vehicle_id?: string;
  vehicle_type_id?: string;
  id?: string;
  is_reserved?: AvailabilityFlag;
  is_disabled?: AvailabilityFlag;
  rental_uris?: { ios?: string; android?: string; web?: string };
}

interface PubliBikeFreeFloatingVehicle {
  id?: string;
  latitude?: number;
  longitude?: number;
  type?: number;
}

interface VehicleType {
  vehicle_type_id: string;
  form_factor?: string;
  propulsion_type?: string;
}

interface StatusFeed {
  data?: {
    bikes?: RawVehicle[];
    vehicles?: RawVehicle[];
  };
}

interface VehicleTypesFeed {
  data?: {
    vehicle_types?: VehicleType[];
  };
}

interface RegistryFeed {
  systems?: Array<{
    id: string;
    url: string;
  }>;
}

interface DiscoveryFeedEntry {
  name: string;
  url: string;
}

interface DiscoveryFeed {
  data?: {
    feeds?: DiscoveryFeedEntry[];
    [language: string]: unknown;
  };
}

interface SystemRegionsFeed {
  data?: {
    regions?: Array<{
      name?: string;
    }>;
  };
}

interface SpatialFeature {
  properties?: {
    provider?: {
      id?: string;
    };
  };
}

type SpatialResponse = SpatialFeature[] | {
  geoJsonSearchInformations?: SpatialFeature[];
};

export interface FeedQuery {
  /** Legacy distance origin. New clients calculate distance locally. */
  origin?: [number, number] | null;
  bounds: MapBounds;
  minBattery: number;
  providers?: Set<string>;
  outsideCoverage?: boolean;
}

export type FeedSourceStatus = 'fresh' | 'stale' | 'partial' | 'failed' | 'skipped';

export interface ScooterFetchMetadata {
  partial: boolean;
  stale: boolean;
  failedSources: string[];
  sources: {
    national: FeedSourceStatus;
    hopp: FeedSourceStatus;
    publibike: FeedSourceStatus;
  };
}

export interface ScooterFetchResult {
  vehicles: Vehicle[];
  meta: ScooterFetchMetadata;
}

interface SourceVehicles {
  vehicles: Vehicle[];
  stale: boolean;
  skipped?: boolean;
  failedSources?: string[];
}

interface NationalSystem {
  id: string;
  provider: ProviderKey;
  discoveryUrl: string;
  baseUrl: string;
}

export class ScooterFeedsUnavailableError extends Error {
  readonly failedSources: string[];

  constructor(failedSources: string[]) {
    super('Every configured scooter feed failed');
    this.name = 'ScooterFeedsUnavailableError';
    this.failedSources = failedSources;
  }
}

function sharedMobilityHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: process.env.SHAREDMOBILITY_AUTH_EMAIL ?? DEFAULT_AUTH_EMAIL,
    'User-Agent': 'swiss-scooters/2.0 (swiss-scooters.plhery.com)',
  };
}

async function fetchJson<T>(
  url: string,
  options: { authenticated?: boolean; revalidate: number }
): Promise<CachedJson<T>> {
  const headers = options.authenticated
    ? sharedMobilityHeaders()
    : { Accept: 'application/json', 'User-Agent': 'swiss-scooters/2.0 (swiss-scooters.plhery.com)' };

  return upstreamJsonCache.fetch<T>(url, {
    headers,
    freshSeconds: options.revalidate,
    staleIfErrorSeconds: options.revalidate === STATUS_REVALIDATE_SECONDS
      ? STATUS_STALE_IF_ERROR_SECONDS
      : METADATA_STALE_IF_ERROR_SECONDS,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
}

function rawVehicles(feed: StatusFeed): RawVehicle[] {
  return feed.data?.bikes ?? feed.data?.vehicles ?? [];
}

function isUnavailable(value: AvailabilityFlag | undefined): boolean {
  return value === true || value === 1;
}

function isElectricScooter(type: VehicleType | undefined): boolean {
  return (
    (type?.form_factor === 'scooter' || type?.form_factor === 'scooter_standing') &&
    type.propulsion_type === 'electric'
  );
}

function batteryPercent(vehicle: RawVehicle): number | null {
  if (vehicle.hopp_battery_level != null && Number.isFinite(vehicle.hopp_battery_level)) {
    return Math.max(0, Math.min(100, Math.round(vehicle.hopp_battery_level)));
  }

  if (vehicle.current_fuel_percent == null || !Number.isFinite(vehicle.current_fuel_percent)) {
    return null;
  }

  const value = vehicle.current_fuel_percent <= 1
    ? vehicle.current_fuel_percent * 100
    : vehicle.current_fuel_percent;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function vehicleId(systemId: string, vehicle: RawVehicle): string | null {
  const id = vehicle.bike_id ?? vehicle.vehicle_id ?? vehicle.id;
  if (!id) return null;
  return id.startsWith(`${systemId}:`) ? id : `${systemId}:${id}`;
}

function toVehicle(
  systemId: string,
  provider: ProviderKey,
  raw: RawVehicle,
  query: Pick<FeedQuery, 'origin'>
): Vehicle | null {
  const lat = raw.lat;
  const lng = raw.lon ?? raw.lng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const range = raw.current_range_meters;
  const rentalUris = normalizeRentalUris(
    provider,
    raw.rental_uris,
    raw.hopp_deeplink
  );

  const distance = query.origin
    ? Math.round(haversineM(query.origin[0], query.origin[1], lat, lng) * 10) / 10
    : null;

  return {
    provider,
    lat,
    lng,
    battery: batteryPercent(raw),
    range_m: range != null && Number.isFinite(Number(range)) ? Math.round(Number(range)) : null,
    vehicle_id: vehicleId(systemId, raw),
    deep_link: legacyRentalLink(rentalUris),
    rental_uris: rentalUris,
    distance_m: distance,
  };
}

function filterVehicles(
  systemId: string,
  vehicles: RawVehicle[],
  types: Map<string, VehicleType>,
  query: FeedQuery
): Vehicle[] {
  const provider = providerKeyForSystemId(systemId);
  if (!provider || (query.providers && !query.providers.has(provider))) return [];

  const filtered: Vehicle[] = [];
  for (const raw of vehicles) {
    if (isUnavailable(raw.is_disabled) || isUnavailable(raw.is_reserved)) continue;
    if (!raw.vehicle_type_id || !isElectricScooter(types.get(raw.vehicle_type_id))) continue;

    const lat = raw.lat;
    const lng = raw.lon ?? raw.lng;
    if (
      lat == null || lng == null ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      !boundsContainPoint(query.bounds, lat, lng)
    ) continue;

    const vehicle = toVehicle(systemId, provider, raw, query);
    if (!vehicle) continue;
    filtered.push(vehicle);
  }
  return filtered;
}

function typeMap(feed: VehicleTypesFeed): Map<string, VehicleType> {
  return new Map((feed.data?.vehicle_types ?? []).map(type => [type.vehicle_type_id, type]));
}

function registrySystem(systemId: string, systemUrl: string): NationalSystem | null {
  try {
    const url = new URL(systemUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'sharedmobility.ch') return null;
    if (!url.pathname.endsWith('/gbfs')) return null;

    const provider = providerKeyForSystemId(systemId);
    if (!provider || provider === 'hopp') return null;

    const discoveryUrl = url.toString();
    url.pathname = url.pathname.slice(0, -'/gbfs'.length);
    url.search = '';
    url.hash = '';
    return {
      id: systemId,
      provider,
      discoveryUrl,
      baseUrl: url.toString().replace(/\/$/, ''),
    };
  } catch {
    return null;
  }
}

function discoveryFeedEntries(feed: DiscoveryFeed): DiscoveryFeedEntry[] {
  const data = feed.data;
  if (!data) return [];
  if (Array.isArray(data.feeds)) return data.feeds;

  for (const value of Object.values(data)) {
    if (
      value &&
      typeof value === 'object' &&
      'feeds' in value &&
      Array.isArray(value.feeds)
    ) {
      return value.feeds as DiscoveryFeedEntry[];
    }
  }
  return [];
}

function trustedFeedUrl(rawUrl: string | undefined, trustedBaseUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const base = new URL(trustedBaseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    if (
      url.protocol !== 'https:' ||
      url.hostname !== base.hostname ||
      !url.pathname.startsWith(`${basePath}/`)
    ) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function discoveredFeedUrl(
  entries: DiscoveryFeedEntry[],
  name: string,
  trustedBaseUrl: string
): string | null {
  return trustedFeedUrl(entries.find(entry => entry.name === name)?.url, trustedBaseUrl);
}

function hasElectricScooter(types: Map<string, VehicleType>): boolean {
  return [...types.values()].some(isElectricScooter);
}

function spatialFeatures(response: SpatialResponse): SpatialFeature[] {
  return Array.isArray(response) ? response : response.geoJsonSearchInformations ?? [];
}

function spatialQueryUrl(systemId: string, bounds: MapBounds): string {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const radiusM = Math.ceil(Math.max(
    haversineM(centerLat, centerLng, bounds.south, bounds.west),
    haversineM(centerLat, centerLng, bounds.south, bounds.east),
    haversineM(centerLat, centerLng, bounds.north, bounds.west),
    haversineM(centerLat, centerLng, bounds.north, bounds.east)
  ) + 250);
  const url = new URL(SPATIAL_IDENTIFY_URL);
  url.searchParams.append('filters', 'ch.bfe.sharedmobility.vehicle_type=E-Scooter');
  url.searchParams.append('filters', `ch.bfe.sharedmobility.provider.id=${systemId}`);
  url.searchParams.set('Geometry', `${centerLng},${centerLat}`);
  url.searchParams.set('Tolerance', String(radiusM));
  url.searchParams.set('offset', '0');
  url.searchParams.set('geometryFormat', 'geojson');
  return url.toString();
}

async function spatialSystemMayServe(
  systemId: string,
  bounds: MapBounds
): Promise<{ mayServe: boolean; stale: boolean }> {
  const result = await fetchJson<SpatialResponse>(spatialQueryUrl(systemId, bounds), {
    revalidate: STATUS_REVALIDATE_SECONDS,
  });
  const mayServe = spatialFeatures(result.data).some(feature => (
    feature.properties?.provider?.id === systemId
  ));
  return { mayServe, stale: result.stale };
}

async function unresolvedSystemMayServe(
  system: NationalSystem,
  entries: DiscoveryFeedEntry[],
  query: FeedQuery
): Promise<{ mayServe: boolean; stale: boolean }> {
  // Velospot regions mix many vehicle modes, so region membership cannot prove
  // that e-scooters are offered there. Use the spatial API for it directly.
  const regionsUrl = system.id === 'velospot'
    ? null
    : discoveredFeedUrl(entries, 'system_regions', system.baseUrl);

  if (regionsUrl) {
    try {
      const regions = await fetchJson<SystemRegionsFeed>(regionsUrl, {
        authenticated: true,
        revalidate: METADATA_REVALIDATE_SECONDS,
      });
      const names = (regions.data.data?.regions ?? [])
        .map(region => region.name)
        .filter((name): name is string => Boolean(name));
      const coverage = coverageForRegionNames(names);
      if (coverageIntersects(coverage.bounds, query.bounds)) {
        return { mayServe: true, stale: regions.stale };
      }
      if (coverage.complete) {
        return { mayServe: false, stale: regions.stale };
      }
    } catch (error) {
      logFallback(`${system.id}:system_regions`, error);
    }
  }

  try {
    return await spatialSystemMayServe(system.id, query.bounds);
  } catch (error) {
    // Coverage discovery must never hide valid scooters during an API outage.
    // Fetching one extra GBFS system is the conservative failure mode.
    logFallback(`${system.id}:spatial_coverage`, error);
    return { mayServe: true, stale: true };
  }
}

async function fetchSystemVehicles(
  system: NationalSystem,
  query: FeedQuery
): Promise<SourceVehicles> {
  const knownCoverage = knownSystemCoverage(system.id);
  if (knownCoverage && !coverageIntersects(knownCoverage, query.bounds)) {
    return { vehicles: [], stale: false, skipped: true };
  }

  const discovery = await fetchJson<DiscoveryFeed>(system.discoveryUrl, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  });
  const entries = discoveryFeedEntries(discovery.data);
  const statusUrl = discoveredFeedUrl(entries, 'free_bike_status', system.baseUrl);
  const typesUrl = discoveredFeedUrl(entries, 'vehicle_types', system.baseUrl);
  if (!statusUrl || !typesUrl) {
    return { vehicles: [], stale: discovery.stale, skipped: true };
  }

  const types = await fetchJson<VehicleTypesFeed>(typesUrl, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  });
  const typesById = typeMap(types.data);
  if (!hasElectricScooter(typesById)) {
    return { vehicles: [], stale: discovery.stale || types.stale, skipped: true };
  }

  let coverageStale = false;
  if (!knownCoverage) {
    const coverage = await unresolvedSystemMayServe(system, entries, query);
    coverageStale = coverage.stale;
    if (!coverage.mayServe) {
      return {
        vehicles: [],
        stale: discovery.stale || types.stale || coverageStale,
        skipped: true,
      };
    }
  }

  const status = await fetchJson<StatusFeed>(statusUrl, {
    authenticated: true,
    revalidate: STATUS_REVALIDATE_SECONDS,
  });

  return {
    vehicles: filterVehicles(system.id, rawVehicles(status.data), typesById, query),
    stale: discovery.stale || types.stale || coverageStale || status.stale,
  };
}

async function fetchNationalVehicles(query: FeedQuery): Promise<SourceVehicles> {
  const registry = await fetchJson<RegistryFeed>(NATIONAL_V23_REGISTRY_URL, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  });

  const systems =
    (registry.data.systems ?? [])
      .map(system => registrySystem(system.id, system.url))
      .filter((system): system is NationalSystem => (
        system !== null &&
        (!query.providers || query.providers.has(system.provider))
      ));

  if (systems.length === 0) {
    return { vehicles: [], stale: registry.stale, skipped: true };
  }

  const results = await Promise.allSettled(
    systems.map(system => fetchSystemVehicles(system, query))
  );

  const availableResults: SourceVehicles[] = [];
  const fulfilledResults: SourceVehicles[] = [];
  const failedSources: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      fulfilledResults.push(result.value);
      if (!result.value.skipped) availableResults.push(result.value);
      return;
    }

    failedSources.push(`national:${systems[index].id}`);
    logFallback(systems[index].id, result.reason);
  });

  if (availableResults.length === 0) {
    if (failedSources.length > 0) {
      throw new Error('Every relevant national GBFS system failed or was unavailable');
    }
    return {
      vehicles: [],
      stale: registry.stale || fulfilledResults.some(result => result.stale),
      skipped: true,
    };
  }

  return {
    vehicles: availableResults.flatMap(result => result.vehicles),
    stale: registry.stale || availableResults.some(result => result.stale),
    failedSources,
  };
}

async function fetchHoppVehicles(query: FeedQuery): Promise<SourceVehicles> {
  if (query.providers && !query.providers.has('hopp')) {
    return { vehicles: [], stale: false, skipped: true };
  }

  if (!coverageIntersects([HOPP_COVERAGE], query.bounds)) {
    return { vehicles: [], stale: false, skipped: true };
  }

  const discovery = await fetchJson<DiscoveryFeed>(HOPP_DISCOVERY_URL, {
    revalidate: METADATA_REVALIDATE_SECONDS,
  });
  const entries = discoveryFeedEntries(discovery.data);
  const hoppBaseUrl = 'https://api.hopp.bike/gbfs/ch-zurich';
  const statusUrl = discoveredFeedUrl(entries, 'free_bike_status', hoppBaseUrl);
  const typesUrl = discoveredFeedUrl(entries, 'vehicle_types', hoppBaseUrl);
  if (!statusUrl || !typesUrl) {
    throw new Error('Hopp GBFS discovery contains no supported scooter feeds');
  }

  const [status, types] = await Promise.all([
    fetchJson<StatusFeed>(statusUrl, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchJson<VehicleTypesFeed>(typesUrl, { revalidate: METADATA_REVALIDATE_SECONDS }),
  ]);
  const typesById = typeMap(types.data);
  if (!hasElectricScooter(typesById)) {
    return { vehicles: [], stale: discovery.stale || types.stale, skipped: true };
  }

  return {
    vehicles: filterVehicles('hopp', rawVehicles(status.data), typesById, query),
    stale: discovery.stale || status.stale || types.stale,
  };
}

async function fetchPubliBikeFreeFloatingVehicles(
  query: FeedQuery
): Promise<SourceVehicles> {
  if (query.providers && !query.providers.has('publibike')) {
    return { vehicles: [], stale: false, skipped: true };
  }

  if (!coverageIntersects([PUBLIBIKE_FREE_FLOATING_COVERAGE], query.bounds)) {
    return { vehicles: [], stale: false, skipped: true };
  }

  const result = await fetchJson<unknown>(PUBLIBIKE_FREE_FLOATING_URL, {
    revalidate: STATUS_REVALIDATE_SECONDS,
  });
  if (!Array.isArray(result.data)) {
    throw new Error('PubliBike free-floating response is not an array');
  }

  const vehicles: Vehicle[] = [];
  for (const raw of result.data as PubliBikeFreeFloatingVehicle[]) {
    const lat = raw.latitude;
    const lng = raw.longitude;
    if (
      raw.type !== PUBLIBIKE_ESCOOTER_TYPE ||
      typeof raw.id !== 'string' || raw.id.length === 0 ||
      lat == null || lng == null ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      !boundsContainPoint(PUBLIBIKE_FREE_FLOATING_COVERAGE, lat, lng) ||
      !boundsContainPoint(query.bounds, lat, lng)
    ) continue;

    const distance = query.origin
      ? Math.round(haversineM(query.origin[0], query.origin[1], lat, lng) * 10) / 10
      : null;
    vehicles.push({
      provider: 'publibike',
      lat,
      lng,
      battery: null,
      range_m: null,
      vehicle_id: `publibike-freefloating:${raw.id}`,
      deep_link: null,
      rental_uris: { ios: null, android: null, web: null },
      distance_m: distance,
    });
  }

  return { vehicles, stale: result.stale };
}

function nationalSourceIsRelevant(query: FeedQuery): boolean {
  if (!query.providers) return true;
  return [...query.providers].some(provider => provider !== 'hopp');
}

function sourceStatus(result: PromiseSettledResult<SourceVehicles>): FeedSourceStatus {
  if (result.status === 'rejected') return 'failed';
  if (result.value.skipped) return 'skipped';
  if (result.value.failedSources?.length) return 'partial';
  return result.value.stale ? 'stale' : 'fresh';
}

function compareVehicles(a: Vehicle, b: Vehicle): number {
  if (a.distance_m !== null && b.distance_m !== null && a.distance_m !== b.distance_m) {
    return a.distance_m - b.distance_m;
  }
  if (a.distance_m !== null) return -1;
  if (b.distance_m !== null) return 1;

  return a.provider.localeCompare(b.provider) ||
    (a.vehicle_id ?? '').localeCompare(b.vehicle_id ?? '') ||
    a.lat - b.lat ||
    a.lng - b.lng;
}

function logSourceFailure(source: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(JSON.stringify({ event: 'scooter_feed_failure', source, message }));
}

function logFallback(source: string, reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.warn(JSON.stringify({ event: 'scooter_feed_fallback', source, message }));
}

export async function fetchScooters(query: FeedQuery): Promise<ScooterFetchResult> {
  if (query.outsideCoverage) {
    return {
      vehicles: [],
      meta: {
        partial: false,
        stale: false,
        failedSources: [],
        sources: { national: 'skipped', hopp: 'skipped', publibike: 'skipped' },
      },
    };
  }

  const [nationalResult, hoppResult, publibikeResult] = await Promise.allSettled([
    nationalSourceIsRelevant(query)
      ? fetchNationalVehicles(query)
      : Promise.resolve<SourceVehicles>({ vehicles: [], stale: false, skipped: true }),
    fetchHoppVehicles(query),
    fetchPubliBikeFreeFloatingVehicles(query),
  ]);

  const sourceResults = [
    ['national', nationalResult],
    ['hopp', hoppResult],
    ['publibike', publibikeResult],
  ] as const;
  const failedSources: string[] = [];
  for (const [source, result] of sourceResults) {
    if (result.status === 'rejected') {
      logSourceFailure(source, result.reason);
      failedSources.push(source);
    }
  }

  const attemptedSourceCount = sourceResults.filter(([, result]) => (
    result.status === 'rejected' || !result.value.skipped
  )).length;
  if (attemptedSourceCount > 0 && failedSources.length === attemptedSourceCount) {
    throw new ScooterFeedsUnavailableError(failedSources);
  }

  if (nationalResult.status === 'fulfilled') {
    failedSources.push(...(nationalResult.value.failedSources ?? []));
  }

  const vehicles = [
    ...(nationalResult.status === 'fulfilled' ? nationalResult.value.vehicles : []),
    ...(hoppResult.status === 'fulfilled' ? hoppResult.value.vehicles : []),
    ...(publibikeResult.status === 'fulfilled' ? publibikeResult.value.vehicles : []),
  ];

  const unique = new Map<string, Vehicle>();
  for (const vehicle of vehicles) {
    const key = vehicle.vehicle_id
      ? `${vehicle.provider}:${vehicle.vehicle_id}`
      : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`;
    unique.set(key, vehicle);
  }

  const filtered = [...unique.values()]
    .filter(vehicle => (
      query.minBattery === 0 ||
      (vehicle.battery !== null && vehicle.battery >= query.minBattery)
    ))
    .sort(compareVehicles);

  const sources = {
    national: sourceStatus(nationalResult),
    hopp: sourceStatus(hoppResult),
    publibike: sourceStatus(publibikeResult),
  };
  return {
    vehicles: filtered,
    meta: {
      partial: failedSources.length > 0,
      stale: Object.values(sources).includes('stale'),
      failedSources,
      sources,
    },
  };
}
