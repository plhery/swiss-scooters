import { boundsContainPoint, haversineM } from '@/lib/geo';
import type { MapBounds, Vehicle } from '@/lib/types';

const NATIONAL_STATUS_URL = 'https://sharedmobility.ch/free_bike_status.json';
const NATIONAL_TYPES_URL = 'https://sharedmobility.ch/vehicle_types.json';
const NATIONAL_V23_REGISTRY_URL = 'https://sharedmobility.ch/v2/gbfs';
const HOPP_STATUS_URL = 'https://api.hopp.bike/gbfs/ch-zurich/en/free_bike_status.json';
const HOPP_TYPES_URL = 'https://api.hopp.bike/gbfs/ch-zurich/en/vehicle_types.json';

const STATUS_REVALIDATE_SECONDS = 30;
const METADATA_REVALIDATE_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_EMAIL = 'zurich-scooter@plhery.com';
const MAX_MEMORY_CACHE_ENTRIES = 64;

interface CacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
}

const jsonCache = new Map<string, CacheEntry>();

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
  provider_id?: string;
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
): Promise<T> {
  const now = Date.now();
  const cached = jsonCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value as Promise<T>;
  if (cached) jsonCache.delete(url);

  for (const [key, entry] of jsonCache) {
    if (entry.expiresAt <= now) jsonCache.delete(key);
  }
  while (jsonCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = jsonCache.keys().next().value;
    if (oldestKey === undefined) break;
    jsonCache.delete(oldestKey);
  }

  const headers = options.authenticated
    ? sharedMobilityHeaders()
    : { Accept: 'application/json', 'User-Agent': 'scooters-web/2.0 (zurich-scooter.plhery.com)' };

  const value = fetch(url, {
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).then(async response => {
    if (!response.ok) {
      throw new Error(`GBFS request failed with HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  });

  jsonCache.set(url, {
    expiresAt: now + options.revalidate * 1000,
    value,
  });

  try {
    return await value;
  } catch (error) {
    if (jsonCache.get(url)?.value === value) jsonCache.delete(url);
    throw error;
  }
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
): Promise<Vehicle[]> {
  const [status, types] = await Promise.all([
    fetchJson<StatusFeed>(`${baseUrl}/free_bike_status`, {
      authenticated: true,
      revalidate: STATUS_REVALIDATE_SECONDS,
    }),
    fetchJson<VehicleTypesFeed>(`${baseUrl}/vehicle_types`, {
      authenticated: true,
      revalidate: METADATA_REVALIDATE_SECONDS,
    }),
  ]);

  return filterVehicles(systemId, rawVehicles(status), typeMap(types), query);
}

async function fetchNationalVehicles(query: FeedQuery): Promise<Vehicle[]> {
  const registryPromise = fetchJson<RegistryFeed>(NATIONAL_V23_REGISTRY_URL, {
    authenticated: true,
    revalidate: METADATA_REVALIDATE_SECONDS,
  }).catch(() => ({ systems: [] }));

  const [status, types, registry] = await Promise.all([
    fetchJson<StatusFeed>(NATIONAL_STATUS_URL, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchJson<VehicleTypesFeed>(NATIONAL_TYPES_URL, { revalidate: METADATA_REVALIDATE_SECONDS }),
    registryPromise,
  ]);

  const nationalTypes = typeMap(types);
  const nearbyBySystem = new Map<string, RawVehicle[]>();

  for (const raw of rawVehicles(status)) {
    const systemId = raw.provider_id;
    const provider = systemId ? normalizeProvider(systemId) : null;
    if (!systemId || !provider || (query.providers && !query.providers.has(provider))) continue;
    if (isUnavailable(raw.is_disabled) || isUnavailable(raw.is_reserved)) continue;
    if (!raw.vehicle_type_id || !isElectricScooter(nationalTypes.get(raw.vehicle_type_id))) continue;

    const lat = raw.lat;
    const lng = raw.lon ?? raw.lng;
    if (lat == null || lng == null) continue;
    if (!boundsContainPoint(query.bounds, lat, lng)) continue;

    const current = nearbyBySystem.get(systemId) ?? [];
    current.push(raw);
    nearbyBySystem.set(systemId, current);
  }

  const registryUrls = new Map(
    (registry.systems ?? [])
      .map(system => [system.id, registryBaseUrl(system.url)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null)
  );

  const results = await Promise.all(
    [...nearbyBySystem.entries()].map(async ([systemId, fallbackVehicles]) => {
      const baseUrl = registryUrls.get(systemId);
      if (!baseUrl) {
        return filterVehicles(systemId, fallbackVehicles, nationalTypes, query);
      }

      try {
        return await fetchSystemVehicles(systemId, baseUrl, query);
      } catch {
        return filterVehicles(systemId, fallbackVehicles, nationalTypes, query);
      }
    })
  );

  return results.flat();
}

async function fetchHoppVehicles(query: FeedQuery): Promise<Vehicle[]> {
  if (query.providers && !query.providers.has('hopp')) return [];

  const [status, types] = await Promise.all([
    fetchJson<StatusFeed>(HOPP_STATUS_URL, { revalidate: STATUS_REVALIDATE_SECONDS }),
    fetchJson<VehicleTypesFeed>(HOPP_TYPES_URL, { revalidate: METADATA_REVALIDATE_SECONDS }),
  ]);

  return filterVehicles('hopp', rawVehicles(status), typeMap(types), query);
}

export async function fetchScooters(query: FeedQuery): Promise<Vehicle[]> {
  const [nationalResult, hoppResult] = await Promise.allSettled([
    fetchNationalVehicles(query),
    fetchHoppVehicles(query),
  ]);

  const vehicles = [
    ...(nationalResult.status === 'fulfilled' ? nationalResult.value : []),
    ...(hoppResult.status === 'fulfilled' ? hoppResult.value : []),
  ];

  const unique = new Map<string, Vehicle>();
  for (const vehicle of vehicles) {
    const key = vehicle.vehicle_id
      ? `${vehicle.provider}:${vehicle.vehicle_id}`
      : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`;
    unique.set(key, vehicle);
  }

  return [...unique.values()]
    .filter(vehicle => (
      query.minBattery === 0 ||
      (vehicle.battery !== null && vehicle.battery >= query.minBattery)
    ))
    .sort((a, b) => a.distance_m - b.distance_m);
}
