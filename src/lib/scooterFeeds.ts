import {
  coverageForRegionNames,
  coverageIntersects,
  HOPP_COVERAGE,
  knownSystemCoverage,
  PUBLIBIKE_FREE_FLOATING_COVERAGE,
  SWISS_MOBILITY_BOUNDS,
} from '@/lib/feedCoverage';
import { boundsContainPoint, boundsIntersection, haversineM } from '@/lib/geo';
import { FRENCH_SCOOTER_SYSTEMS, type FrenchScooterSystem } from '@/lib/frenchScooterSystems';
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
  pricing_plan_id?: string;
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
  last_updated?: number | string;
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

interface PerMinutePrice {
  start?: number;
  rate?: number;
  interval?: number;
}

interface PricingPlan {
  plan_id?: string;
  currency?: string;
  price?: number;
  description?: string | Array<{ language: string; text: string }>;
  per_min_pricing?: PerMinutePrice[];
  // Hopp currently publishes this singular key instead of the GBFS key above.
  per_min_price?: PerMinutePrice[];
}

interface PricingPlansFeed {
  data?: {
    plans?: PricingPlan[];
    pricing_plans?: PricingPlan[];
  };
}

type VehiclePricing = NonNullable<Vehicle['pricing']>;

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
    france: FeedSourceStatus;
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

export interface CollectableScooterFeed {
  id: string;
  source: keyof ScooterFetchMetadata['sources'];
  provider: ProviderKey;
  coverage: MapBounds[];
  collect: () => Promise<SourceVehicles>;
}

// The persistent collector refreshes each system independently. A failing
// operator must not discard another city's last successful snapshot.
export async function discoverCollectableFeeds(): Promise<CollectableScooterFeed[]> {
  const query: FeedQuery = { bounds: SWISS_MOBILITY_BOUNDS, minBattery: 0 };
  const registry = await fetchJson<RegistryFeed>(NATIONAL_V23_REGISTRY_URL, {
    authenticated: true, revalidate: METADATA_REVALIDATE_SECONDS,
  });
  return [
    ...(registry.data.systems ?? []).flatMap(entry => {
      const system = registrySystem(entry.id, entry.url);
      return system ? [{
        id: `national:${system.id}`,
        source: 'national' as const,
        provider: system.provider,
        coverage: knownSystemCoverage(system.id) ?? [SWISS_MOBILITY_BOUNDS],
        collect: () => fetchSystemVehicles(system, query),
      }] : [];
    }),
    ...independentCollectableFeeds(),
  ];
}

export function independentCollectableFeeds(): CollectableScooterFeed[] {
  const query: FeedQuery = { bounds: SWISS_MOBILITY_BOUNDS, minBattery: 0 };
  return [
    { id: 'hopp', source: 'hopp', provider: 'hopp', coverage: [HOPP_COVERAGE],
      collect: () => fetchHoppVehicles(query) },
    { id: 'publibike', source: 'publibike', provider: 'publibike',
      coverage: [PUBLIBIKE_FREE_FLOATING_COVERAGE],
      collect: () => fetchPubliBikeFreeFloatingVehicles(query) },
    ...FRENCH_SCOOTER_SYSTEMS.map(system => ({
      id: `france:${system.id}`, source: 'france' as const, provider: system.provider,
      coverage: [system.bounds],
      collect: () => fetchFrenchSystemVehicles(system, { bounds: system.bounds, minBattery: 0 }),
    })),
  ];
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
  query: Pick<FeedQuery, 'origin'>,
  pricingByPlanId: Map<string, VehiclePricing>
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
  const pricing = raw.pricing_plan_id
    ? pricingByPlanId.get(raw.pricing_plan_id)
    : undefined;

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
    ...(pricing ? { pricing } : {}),
  };
}

function filterVehicles(
  systemId: string,
  vehicles: RawVehicle[],
  types: Map<string, VehicleType>,
  query: FeedQuery,
  pricingByPlanId: Map<string, VehiclePricing> = new Map()
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

    const vehicle = toVehicle(systemId, provider, raw, query, pricingByPlanId);
    if (!vehicle) continue;
    filtered.push(vehicle);
  }
  return filtered;
}

function typeMap(feed: VehicleTypesFeed): Map<string, VehicleType> {
  return new Map((feed.data?.vehicle_types ?? []).map(type => [type.vehicle_type_id, type]));
}

function minorUnits(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function describedMinorUnits(
  description: PricingPlan['description'],
  currency: string,
  priceContext: 'unlock' | 'minute'
): number | null {
  if (Array.isArray(description)) {
    description = description.find(value => value.language === 'en')?.text;
  }
  if (typeof description !== 'string') return null;
  const suffix = priceContext === 'unlock' ? 'to\\s+unlock' : 'per\\s+minute';
  const match = description.match(new RegExp(
    `([0-9]+(?:[.,][0-9]+)?)\\s*${currency}\\s+${suffix}`,
    'i'
  ));
  if (!match) return null;
  return minorUnits(Number(match[1].replace(',', '.')));
}

function vehiclePricing(plan: PricingPlan): VehiclePricing | null {
  const currency = plan.currency?.trim().toUpperCase();
  const unlockFee = minorUnits(plan.price);
  const minuteBands = plan.per_min_pricing?.length
    ? plan.per_min_pricing
    : plan.per_min_price;
  const firstMinuteBand = minuteBands
    ?.filter(band => (
      band.rate != null && Number.isFinite(band.rate) && band.rate >= 0 &&
      band.interval != null && Number.isFinite(band.interval) && band.interval > 0
    ))
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))[0];
  const minuteFee = firstMinuteBand
    ? minorUnits(firstMinuteBand.rate! / firstMinuteBand.interval!)
    : null;

  if (!currency?.match(/^[A-Z]{3}$/) || unlockFee == null || minuteFee == null) {
    return null;
  }

  // Descriptions are never used as the tariff source, but they can expose a
  // contradictory canonical value. In that case omitting the estimate is safer.
  const describedUnlockFee = describedMinorUnits(plan.description, currency, 'unlock');
  const describedMinuteFee = describedMinorUnits(plan.description, currency, 'minute');
  if (
    (describedUnlockFee != null && describedUnlockFee !== unlockFee) ||
    (describedMinuteFee != null && describedMinuteFee !== minuteFee)
  ) {
    return null;
  }

  return {
    currency,
    unlock_fee_minor_units: unlockFee,
    minute_fee_minor_units: minuteFee,
  };
}

function pricingPlanMap(feed: PricingPlansFeed): Map<string, VehiclePricing> {
  const plans = feed.data?.plans ?? feed.data?.pricing_plans ?? [];
  const pricingByPlanId = new Map<string, VehiclePricing>();
  for (const plan of plans) {
    const planId = plan.plan_id?.trim();
    const pricing = vehiclePricing(plan);
    if (planId && pricing) pricingByPlanId.set(planId, pricing);
  }
  return pricingByPlanId;
}

async function fetchPricingPlans(
  url: string | null,
  options: { authenticated?: boolean; source: string }
): Promise<Map<string, VehiclePricing>> {
  if (!url) return new Map();

  try {
    const result = await fetchJson<PricingPlansFeed>(url, {
      authenticated: options.authenticated,
      revalidate: METADATA_REVALIDATE_SECONDS,
    });
    return pricingPlanMap(result.data);
  } catch (error) {
    // Pricing enriches availability and must never make otherwise-valid scooters disappear.
    logFallback(`${options.source}:system_pricing_plans`, error);
    return new Map();
  }
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
      url.origin !== base.origin ||
      url.username || url.password ||
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
  const pricingUrl = discoveredFeedUrl(entries, 'system_pricing_plans', system.baseUrl);
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

  const [status, pricingByPlanId] = await Promise.all([
    fetchJson<StatusFeed>(statusUrl, {
      authenticated: true,
      revalidate: STATUS_REVALIDATE_SECONDS,
    }),
    fetchPricingPlans(pricingUrl, { authenticated: true, source: system.id }),
  ]);

  return {
    vehicles: filterVehicles(
      system.id,
      rawVehicles(status.data),
      typesById,
      query,
      pricingByPlanId
    ),
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
  const pricingUrl = discoveredFeedUrl(entries, 'system_pricing_plans', hoppBaseUrl);
  if (!statusUrl || !typesUrl) {
    throw new Error('Hopp GBFS discovery contains no supported scooter feeds');
  }

  const [status, types, pricingByPlanId] = await Promise.all([
    fetchJson<StatusFeed>(statusUrl, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchJson<VehicleTypesFeed>(typesUrl, { revalidate: METADATA_REVALIDATE_SECONDS }),
    fetchPricingPlans(pricingUrl, { source: 'hopp' }),
  ]);
  const typesById = typeMap(types.data);
  if (!hasElectricScooter(typesById)) {
    return { vehicles: [], stale: discovery.stale || types.stale, skipped: true };
  }

  return {
    vehicles: filterVehicles(
      'hopp',
      rawVehicles(status.data),
      typesById,
      query,
      pricingByPlanId
    ),
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

async function fetchFrenchSystemVehicles(
  system: FrenchScooterSystem,
  query: FeedQuery
): Promise<SourceVehicles> {
  const bounds = boundsIntersection(system.bounds, query.bounds);
  if (!bounds) return { vehicles: [], stale: false, skipped: true };

  const baseUrl = new URL('.', system.discoveryUrl).toString();
  const discovery = await fetchJson<DiscoveryFeed>(system.discoveryUrl, {
    revalidate: METADATA_REVALIDATE_SECONDS,
  });
  const entries = discoveryFeedEntries(discovery.data);
  const statusUrl = discoveredFeedUrl(entries, 'vehicle_status', baseUrl) ??
    discoveredFeedUrl(entries, 'free_bike_status', baseUrl);
  const typesUrl = discoveredFeedUrl(entries, 'vehicle_types', baseUrl);
  if (!statusUrl || !typesUrl) {
    throw new Error(`${system.id} discovery contains no supported scooter feeds`);
  }

  const types = await fetchJson<VehicleTypesFeed>(typesUrl, {
    revalidate: METADATA_REVALIDATE_SECONDS,
  });
  const typesById = typeMap(types.data);
  if (!hasElectricScooter(typesById)) {
    return { vehicles: [], stale: discovery.stale || types.stale, skipped: true };
  }

  const [status, pricing] = await Promise.all([
    fetchJson<StatusFeed>(statusUrl, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchPricingPlans(discoveredFeedUrl(entries, 'system_pricing_plans', baseUrl), {
      source: system.id,
    }),
  ]);
  if (!Array.isArray(status.data.data?.bikes) && !Array.isArray(status.data.data?.vehicles)) {
    throw new Error(`${system.id} status contains no vehicle array`);
  }
  const updatedAt = typeof status.data.last_updated === 'number'
    ? status.data.last_updated * 1000
    : Date.parse(status.data.last_updated ?? '');
  const ageSeconds = (Date.now() - updatedAt) / 1000;
  // Several published French endpoints still return successful but abandoned
  // feeds. HTTP 200 alone must not make old locations look live.
  if (!Number.isFinite(updatedAt) || ageSeconds > 900 || ageSeconds < -300) {
    throw new Error(`${system.id} status timestamp is missing or out of date`);
  }

  return {
    vehicles: filterVehicles(system.id, rawVehicles(status.data), typesById, {
      ...query,
      bounds,
    }, pricing),
    stale: discovery.stale || types.stale || status.stale || ageSeconds > 300,
  };
}

async function fetchFrenchVehicles(query: FeedQuery): Promise<SourceVehicles> {
  const systems = FRENCH_SCOOTER_SYSTEMS.filter(system => (
    (!query.providers || query.providers.has(system.provider)) &&
    coverageIntersects([system.bounds], query.bounds)
  ));
  if (systems.length === 0) return { vehicles: [], stale: false, skipped: true };

  const available: SourceVehicles[] = [];
  const failedSources: string[] = [];
  // Country-level views should not open dozens of concurrent upstream requests.
  let nextSystem = 0;
  await Promise.all(Array.from({ length: Math.min(4, systems.length) }, async () => {
    while (nextSystem < systems.length) {
      const system = systems[nextSystem++];
      try {
        available.push(await fetchFrenchSystemVehicles(system, query));
      } catch (error) {
        failedSources.push(`france:${system.id}`);
        logFallback(system.id, error);
      }
    }
  }));

  const served = available.filter(result => !result.skipped);
  if (served.length === 0 && failedSources.length > 0) {
    throw new ScooterFeedsUnavailableError(failedSources.sort());
  }
  return {
    vehicles: served.flatMap(result => result.vehicles),
    stale: served.some(result => result.stale),
    skipped: served.length === 0,
    failedSources: failedSources.sort(),
  };
}

function nationalSourceIsRelevant(query: FeedQuery): boolean {
  if (!coverageIntersects([SWISS_MOBILITY_BOUNDS], query.bounds)) return false;
  if (!query.providers) return true;
  return [...query.providers].some(provider => provider !== 'hopp' && provider !== 'pony');
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
        sources: { national: 'skipped', hopp: 'skipped', publibike: 'skipped', france: 'skipped' },
      },
    };
  }

  const [nationalResult, hoppResult, publibikeResult, franceResult] = await Promise.allSettled([
    nationalSourceIsRelevant(query)
      ? fetchNationalVehicles({
        ...query,
        bounds: boundsIntersection(query.bounds, SWISS_MOBILITY_BOUNDS)!,
      })
      : Promise.resolve<SourceVehicles>({ vehicles: [], stale: false, skipped: true }),
    fetchHoppVehicles(query),
    fetchPubliBikeFreeFloatingVehicles(query),
    fetchFrenchVehicles(query),
  ]);

  const sourceResults = [
    ['national', nationalResult],
    ['hopp', hoppResult],
    ['publibike', publibikeResult],
    ['france', franceResult],
  ] as const;
  const failedSources: string[] = [];
  let rejectedSourceCount = 0;
  for (const [source, result] of sourceResults) {
    if (result.status === 'rejected') {
      rejectedSourceCount++;
      logSourceFailure(source, result.reason);
      failedSources.push(...(result.reason instanceof ScooterFeedsUnavailableError
        ? result.reason.failedSources
        : [source]));
    }
  }

  const attemptedSourceCount = sourceResults.filter(([, result]) => (
    result.status === 'rejected' || !result.value.skipped
  )).length;
  if (attemptedSourceCount > 0 && rejectedSourceCount === attemptedSourceCount) {
    throw new ScooterFeedsUnavailableError(failedSources);
  }

  for (const [, result] of sourceResults) {
    if (result.status === 'fulfilled') {
      failedSources.push(...(result.value.failedSources ?? []));
    }
  }

  const vehicles = sourceResults.flatMap(([, result]) => (
    result.status === 'fulfilled' ? result.value.vehicles : []
  ));

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
    france: sourceStatus(franceResult),
  };
  return {
    vehicles: filtered,
    meta: {
      partial: failedSources.length > 0,
      stale: sourceResults.some(([, result]) => result.status === 'fulfilled' && result.value.stale),
      failedSources,
      sources,
    },
  };
}
