import { boundsContainPoint, haversineM } from '@/lib/geo';
import type { MapBounds, Vehicle } from '@/lib/types';
import { upstreamJsonCache, type CachedJson } from '@/lib/upstreamJsonCache';

const NATIONAL_V23_REGISTRY_URL = 'https://sharedmobility.ch/v2/gbfs';
const HOPP_STATUS_URL = 'https://api.hopp.bike/gbfs/ch-zurich/en/free_bike_status.json';
const HOPP_TYPES_URL = 'https://api.hopp.bike/gbfs/ch-zurich/en/vehicle_types.json';

const STATUS_REVALIDATE_SECONDS = 30;
const METADATA_REVALIDATE_SECONDS = 3600;
const STATUS_STALE_IF_ERROR_SECONDS = 300;
const METADATA_STALE_IF_ERROR_SECONDS = 86400;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_EMAIL = 'zurich-scooter@plhery.com';

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
  rental_uris?: { ios?: string; android?: string };
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

type ProviderKey = 'bolt' | 'bird' | 'dott' | 'lime' | 'voi' | 'hopp' | 'publibike';

export interface FeedQuery {
  lat: number;
  lng: number;
  bounds: MapBounds;
  minBattery: number;
  providers?: Set<string>;
}

export type FeedSourceStatus = 'fresh' | 'stale' | 'failed' | 'skipped';

export interface ScooterFetchMetadata {
  partial: boolean;
  stale: boolean;
  failedSources: string[];
  sources: {
    national: FeedSourceStatus;
    hopp: FeedSourceStatus;
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
    'User-Agent': 'scooters-web/2.0 (zurich-scooter.plhery.com)',
  };
}

async function fetchJson<T>(
  url: string,
  options: { authenticated?: boolean; revalidate: number }
): Promise<CachedJson<T>> {
  const headers = options.authenticated
    ? sharedMobilityHeaders()
    : { Accept: 'application/json', 'User-Agent': 'scooters-web/2.0 (zurich-scooter.plhery.com)' };

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

function normalizeProvider(systemId: string): ProviderKey | null {
  const id = systemId.toLowerCase();
  if (id.startsWith('bolt')) return 'bolt';
  if (id.startsWith('bird')) return 'bird';
  if (id.startsWith('dott')) return 'dott';
  if (id.startsWith('lime')) return 'lime';
  if (id === 'voiscooters.com' || id.startsWith('voi')) return 'voi';
  if (id === 'velospot' || id.startsWith('publibike')) return 'publibike';
  if (id.startsWith('hopp')) return 'hopp';
  return null;
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
  query: Pick<FeedQuery, 'lat' | 'lng'>
): Vehicle | null {
  const lat = raw.lat;
  const lng = raw.lon ?? raw.lng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const range = raw.current_range_meters;
  const rentalUris = raw.rental_uris ?? {};

  return {
    provider,
    lat,
    lng,
    battery: batteryPercent(raw),
    range_m: range != null && Number.isFinite(Number(range)) ? Math.round(Number(range)) : null,
    vehicle_id: vehicleId(systemId, raw),
    deep_link: raw.hopp_deeplink || rentalUris.ios || rentalUris.android || null,
    distance_m: Math.round(haversineM(query.lat, query.lng, lat, lng) * 10) / 10,
  };
}

function filterVehicles(
  systemId: string,
  vehicles: RawVehicle[],
  types: Map<string, VehicleType>,
  query: FeedQuery
): Vehicle[] {
  const provider = normalizeProvider(systemId);
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

function registryBaseUrl(systemUrl: string): string | null {
  try {
    const url = new URL(systemUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'sharedmobility.ch') return null;
    if (!url.pathname.endsWith('/gbfs')) return null;
    url.pathname = url.pathname.slice(0, -'/gbfs'.length);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function fetchSystemVehicles(
  systemId: string,
  baseUrl: string,
  query: FeedQuery
): Promise<SourceVehicles> {
  const status = await fetchJson<StatusFeed>(`${baseUrl}/free_bike_status`, {
    authenticated: true,
    revalidate: STATUS_REVALIDATE_SECONDS,
  });
  const nearbyVehicles = rawVehicles(status.data).filter(raw => {
    if (isUnavailable(raw.is_disabled) || isUnavailable(raw.is_reserved)) return false;
    if (!raw.vehicle_type_id) return false;

    const lat = raw.lat;
    const lng = raw.lon ?? raw.lng;
    return (
      lat != null && lng != null &&
      Number.isFinite(lat) && Number.isFinite(lng) &&
      boundsContainPoint(query.bounds, lat, lng)
    );
  });

  if (nearbyVehicles.length === 0) {
    return { vehicles: [], stale: status.stale };
  }

  const types = await fetchJson<VehicleTypesFeed>(`${baseUrl}/vehicle_types`, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  });

  return {
    vehicles: filterVehicles(systemId, nearbyVehicles, typeMap(types.data), query),
    stale: status.stale || types.stale,
  };
}

async function fetchNationalVehicles(query: FeedQuery): Promise<SourceVehicles> {
  const registry = await fetchJson<RegistryFeed>(NATIONAL_V23_REGISTRY_URL, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  });

  const systems =
    (registry.data.systems ?? [])
      .map(system => ({
        id: system.id,
        provider: normalizeProvider(system.id),
        baseUrl: registryBaseUrl(system.url),
      }))
      .filter((system): system is { id: string; provider: ProviderKey; baseUrl: string } => (
        system.provider !== null &&
        system.provider !== 'hopp' &&
        system.baseUrl !== null &&
        (!query.providers || query.providers.has(system.provider))
      ));

  if (systems.length === 0) {
    throw new Error('National GBFS registry contains no relevant supported systems');
  }

  const results = await Promise.allSettled(
    systems.map(system => fetchSystemVehicles(system.id, system.baseUrl, query))
  );

  const availableResults: SourceVehicles[] = [];
  let failedSystemCount = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      availableResults.push(result.value);
      return;
    }

    failedSystemCount += 1;
    logFallback(systems[index].id, result.reason);
  });

  if (availableResults.length === 0) {
    throw new Error('Every relevant national GBFS system failed');
  }

  return {
    vehicles: availableResults.flatMap(result => result.vehicles),
    stale: registry.stale || failedSystemCount > 0 || availableResults.some(result => result.stale),
  };
}

async function fetchHoppVehicles(query: FeedQuery): Promise<SourceVehicles> {
  if (query.providers && !query.providers.has('hopp')) {
    return { vehicles: [], stale: false, skipped: true };
  }

  const [status, types] = await Promise.all([
    fetchJson<StatusFeed>(HOPP_STATUS_URL, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchJson<VehicleTypesFeed>(HOPP_TYPES_URL, { revalidate: METADATA_REVALIDATE_SECONDS }),
  ]);

  return {
    vehicles: filterVehicles('hopp', rawVehicles(status.data), typeMap(types.data), query),
    stale: status.stale || types.stale,
  };
}

function nationalSourceIsRelevant(query: FeedQuery): boolean {
  if (!query.providers) return true;
  return [...query.providers].some(provider => provider !== 'hopp');
}

function sourceStatus(result: PromiseSettledResult<SourceVehicles>): FeedSourceStatus {
  if (result.status === 'rejected') return 'failed';
  if (result.value.skipped) return 'skipped';
  return result.value.stale ? 'stale' : 'fresh';
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
  const [nationalResult, hoppResult] = await Promise.allSettled([
    nationalSourceIsRelevant(query)
      ? fetchNationalVehicles(query)
      : Promise.resolve({ vehicles: [], stale: false, skipped: true }),
    fetchHoppVehicles(query),
  ]);

  const sourceResults = [
    ['national', nationalResult],
    ['hopp', hoppResult],
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

  const vehicles = [
    ...(nationalResult.status === 'fulfilled' ? nationalResult.value.vehicles : []),
    ...(hoppResult.status === 'fulfilled' ? hoppResult.value.vehicles : []),
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
    .sort((a, b) => a.distance_m - b.distance_m);

  const sources = {
    national: sourceStatus(nationalResult),
    hopp: sourceStatus(hoppResult),
  };

  return {
    vehicles: filtered,
    meta: {
      partial: failedSources.length > 0,
      stale: sources.national === 'stale' || sources.hopp === 'stale',
      failedSources,
      sources,
    },
  };
}
