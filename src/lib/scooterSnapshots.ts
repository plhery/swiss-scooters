import { SWISS_SCOOTER_AREAS, coverageIntersects } from '@/lib/feedCoverage';
import { REGIONAL_SCOOTER_CITIES, COUNTRY_SOURCES, isRegionalSource } from '@/lib/regionalScooterSystems';
import { boundsContainPoint, haversineM } from '@/lib/geo';
import { CITY_OVERVIEW_MAX_ZOOM, providersForViewport } from '@/lib/mapCoverage';
import { PARKING_MAX_AGE_MS, PARKING_MIN_ZOOM, type ParkingSnapshot } from '@/lib/parking';
import { scooterResponse } from '@/lib/scooterResponse';
import { ScooterFeedsUnavailableError, type FeedQuery, type ScooterFetchMetadata } from '@/lib/scooterFeeds';
import type { MapBounds, ScooterCluster, ScooterResponse, Vehicle } from '@/lib/types';

export const VEHICLE_MAX_AGE_MS = 5 * 60_000;
export const OVERVIEW_REFRESH_MS = 60 * 60_000;
const OVERVIEW_MAX_AGE_MS = 3 * OVERVIEW_REFRESH_MS;

export interface FeedSnapshot {
  parking?: ParkingSnapshot;
  id: string;
  source: keyof ScooterFetchMetadata['sources'];
  provider: string;
  coverage: MapBounds[];
  vehicles: Vehicle[];
  observedAt: number;
  attemptedAt: number;
  stale: boolean;
  failed: boolean;
  skipped: boolean;
}

interface CityTotals {
  id: string;
  city: string;
  lat: number;
  lng: number;
  // Bins 0..100 hold known battery percentages; bin 101 is unknown.
  batteries: Record<string, number[]>;
  sources: ScooterFetchMetadata['sources'];
  failedSources: string[];
}

export interface MobilitySnapshot {
  version: 1;
  updatedAt: number;
  feeds: FeedSnapshot[];
  overview: { generatedAt: number; cities: CityTotals[] };
}

function emptyHealth(): ScooterFetchMetadata {
  return { partial: false, stale: false, failedSources: [],
    sources: { national: 'skipped', hopp: 'skipped', publibike: 'skipped', france: 'skipped', germany: 'skipped', italy: 'skipped' } };
}

function healthFor(feeds: FeedSnapshot[], now: number): ScooterFetchMetadata {
  const meta = emptyHealth();
  for (const source of Object.keys(meta.sources) as Array<keyof typeof meta.sources>) {
    const relevant = feeds.filter(feed => feed.source === source && !feed.skipped);
    if (!relevant.length) continue;
    const usable = relevant.filter(feed => now - feed.observedAt <= VEHICLE_MAX_AGE_MS);
    const failed = relevant.filter(feed => feed.failed || now - feed.observedAt > VEHICLE_MAX_AGE_MS);
    const stale = usable.some(feed => feed.stale || now - feed.observedAt > 90_000);
    meta.sources[source] = usable.length === 0 ? 'failed' : failed.length ? 'partial' : stale ? 'stale' : 'fresh';
    meta.failedSources.push(...failed.map(feed => feed.id));
    meta.stale ||= stale;
  }
  meta.partial = meta.failedSources.length > 0;
  return meta;
}

const regionalCities = REGIONAL_SCOOTER_CITIES;

export function overviewNeedsRefresh(snapshot: MobilitySnapshot | undefined, feeds: FeedSnapshot[], now: number): boolean {
  if (!snapshot || snapshot.overview.cities.length !== regionalCities.length + SWISS_SCOOTER_AREAS.length ||
    now - snapshot.overview.generatedAt >= OVERVIEW_REFRESH_MS) return true;
  const recovered = new Set(feeds.filter(feed => !feed.failed && now - feed.observedAt < VEHICLE_MAX_AGE_MS).map(feed => feed.id));
  return snapshot.overview.cities.some(city => city.failedSources.some(id => recovered.has(id)));
}

export function buildCityOverview(feeds: FeedSnapshot[], now: number): MobilitySnapshot['overview'] {
  const totals = new Map<string, CityTotals>();
  for (const city of [...regionalCities, ...SWISS_SCOOTER_AREAS]) {
    const country = regionalCities.find(candidate => candidate.id === city.id)?.country;
    const countrySource = country ? COUNTRY_SOURCES[country] : null;
    const relevant = feeds.filter(feed => (countrySource ? feed.source === countrySource : !isRegionalSource(feed.source)) && coverageIntersects(feed.coverage, city.bounds));
    const health = healthFor(relevant, now);
    totals.set(city.id, { id: city.id, city: city.city, lat: city.center[0], lng: city.center[1],
      batteries: {}, sources: health.sources, failedSources: health.failedSources });
  }
  const seen = new Set<string>();
  for (const feed of feeds) {
    if (feed.skipped || now - feed.observedAt > VEHICLE_MAX_AGE_MS) continue;
    const cities = isRegionalSource(feed.source)
      ? regionalCities.filter(city => COUNTRY_SOURCES[city.country] === feed.source) : SWISS_SCOOTER_AREAS;
    if (!cities.length) continue;
    for (const vehicle of feed.vehicles) {
      const key = `${vehicle.provider}:${vehicle.vehicle_id ?? `${vehicle.lat}:${vehicle.lng}`}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Assign each scooter once, including where neighbouring service areas overlap.
      const city = cities.reduce((nearest, candidate) => (
        haversineM(vehicle.lat, vehicle.lng, ...candidate.center as [number, number]) <
        haversineM(vehicle.lat, vehicle.lng, ...nearest.center as [number, number]) ? candidate : nearest
      ));
      const total = totals.get(city.id)!;
      const bins = total.batteries[vehicle.provider] ??= Array<number>(102).fill(0);
      bins[vehicle.battery ?? 101]++;
    }
  }
  return { generatedAt: now, cities: [...totals.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

function overviewResponse(snapshot: MobilitySnapshot, query: FeedQuery, zoom: number, now: number): ScooterResponse {
  if (now - snapshot.overview.generatedAt > OVERVIEW_MAX_AGE_MS) {
    throw new ScooterFeedsUnavailableError(['city-overview']);
  }
  const clusters: ScooterCluster[] = [];
  const providers: Record<string, number> = {};
  const meta = emptyHealth();
  for (const city of snapshot.overview.cities) {
    if (!boundsContainPoint(query.bounds, city.lat, city.lng)) continue;
    const counts: Record<string, number> = {};
    for (const [provider, bins] of Object.entries(city.batteries)) {
      if (query.providers && !query.providers.has(provider)) continue;
      const count = bins.slice(query.minBattery, query.minBattery > 0 ? 101 : 102).reduce((a, b) => a + b, 0);
      if (count > 0) {
        counts[provider] = count;
        providers[provider] = (providers[provider] ?? 0) + count;
      }
    }
    const count = Object.values(counts).reduce((a, b) => a + b, 0);
    if (count) clusters.push({ id: `city:${city.id}`, city: city.city, lat: city.lat, lng: city.lng, count, providers: counts });
    for (const source of Object.keys(meta.sources) as Array<keyof typeof meta.sources>) {
      const status = city.sources[source] ?? 'skipped';
      const previous = meta.sources[source];
      if (status === 'skipped') continue;
      meta.sources[source] = previous === 'skipped' || previous === status ? status
        : previous === 'failed' || status === 'failed' || previous === 'partial' || status === 'partial' ? 'partial'
          : previous === 'stale' || status === 'stale' ? 'stale' : 'fresh';
    }
    meta.failedSources.push(...city.failedSources);
  }
  meta.failedSources = [...new Set(meta.failedSources)];
  meta.partial = meta.failedSources.length > 0;
  meta.stale = Object.values(meta.sources).some(source => source === 'stale') || now - snapshot.overview.generatedAt > OVERVIEW_REFRESH_MS + 120_000;
  const attempted = Object.values(meta.sources).filter(source => source !== 'skipped');
  if (attempted.length > 0 && attempted.every(source => source === 'failed')) throw new ScooterFeedsUnavailableError(meta.failedSources);
  return {
    vehicles: [], clusters, providers,
    meta: { ...meta, generatedAt: new Date(snapshot.overview.generatedAt).toISOString(),
      truncated: false, totalVehicles: Object.values(providers).reduce((a, b) => a + b, 0),
      mode: 'clusters', zoom, overview: true, refreshAfterSeconds: 3600,
      availableProviders: providersForViewport(query.bounds) },
  };
}

export function querySnapshot(snapshot: MobilitySnapshot, query: FeedQuery, zoom: number | null, now = Date.now()): ScooterResponse {
  if (query.outsideCoverage) return scooterResponse({ vehicles: [], meta: emptyHealth() }, zoom, { availableProviders: [] });
  if (zoom !== null && zoom <= CITY_OVERVIEW_MAX_ZOOM) return overviewResponse(snapshot, query, zoom, now);
  const relevant = snapshot.feeds.filter(feed => (
    (!query.providers || query.providers.has(feed.provider)) && coverageIntersects(feed.coverage, query.bounds)
  ));
  const meta = healthFor(relevant, now);
  if (relevant.some(feed => !feed.skipped) && relevant.every(feed => feed.skipped || now - feed.observedAt > VEHICLE_MAX_AGE_MS)) {
    throw new ScooterFeedsUnavailableError(meta.failedSources);
  }
  const unique = new Map<string, Vehicle>();
  for (const feed of relevant) {
    if (feed.skipped || now - feed.observedAt > VEHICLE_MAX_AGE_MS) continue;
    for (const vehicle of feed.vehicles) {
      if (!boundsContainPoint(query.bounds, vehicle.lat, vehicle.lng)) continue;
      if (query.minBattery > 0 && (vehicle.battery === null || vehicle.battery < query.minBattery)) continue;
      const key = `${vehicle.provider}:${vehicle.vehicle_id ?? `${vehicle.lat}:${vehicle.lng}`}`;
      unique.set(key, query.origin ? { ...vehicle,
        distance_m: Math.round(haversineM(...query.origin, vehicle.lat, vehicle.lng) * 10) / 10,
      } : vehicle);
    }
  }
  const vehicles = [...unique.values()];
  if (query.origin) vehicles.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
  const response = scooterResponse({ vehicles, meta }, zoom, {
    generatedAt: new Date(Math.min(now, ...relevant.filter(feed => !feed.skipped && feed.observedAt > 0).map(feed => feed.observedAt))).toISOString(),
    refreshAfterSeconds: 60,
    availableProviders: providersForViewport(query.bounds),
  });
  if (zoom !== null && zoom >= PARKING_MIN_ZOOM) {
    const systems = relevant.filter(feed => isRegionalSource(feed.source));
    const available = systems.filter(feed => feed.parking && now - feed.parking.observedAt <= PARKING_MAX_AGE_MS);
    response.parking = available.flatMap(feed => feed.parking!.locations)
      .filter(location => boundsContainPoint(query.bounds, location.lat, location.lng));
    response.meta.parkingStatus = !systems.length ? 'skipped' : available.length === 0 ? 'failed'
      : available.length < systems.length ? 'partial' : available.some(feed => feed.parking!.stale) ? 'stale' : 'fresh';
  }
  return response;
}
