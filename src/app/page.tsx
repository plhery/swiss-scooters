'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MapWrapper from '@/components/MapWrapper';
import BottomSheet, { type SelectedVehicle } from '@/components/BottomSheet';
import MapControls from '@/components/MapControls';
import type { AddressResult } from '@/components/AddressSearch';
import type { MapBounds, ScooterCluster, Vehicle, ScooterResponse } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import {
  parseClientParams,
  parseStoredClientParams,
  serializeClientParams,
  type ClientParams,
} from '@/lib/clientParams';
import { scooterDataHealthNotice } from '@/lib/dataHealth';
import { shouldAutoRefresh } from '@/lib/autoRefresh';
import { shouldClusterAtZoom } from '@/lib/clustering';
import { useI18n } from '@/lib/i18n';
import {
  boundsContainBounds,
  boundsContainPoint,
  expandBounds,
  haversineM,
} from '@/lib/geo';

const SWITZERLAND_CENTER: [number, number] = [46.8182, 8.2275];
const INITIAL_ZOOM = 8;
const VIEWPORT_FETCH_PADDING = 0.25;
const AUTO_REFRESH_INTERVAL_MS = 60_000;

const STORAGE_KEY = 'scooters-params';

interface ScooterMapQuery {
  bounds: MapBounds;
  zoom: number;
}

function saveParamsToStorage(params: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch {}
}

function loadParamsFromStorage(): ClientParams | null {
  try { return parseStoredClientParams(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function readUrlParams(): ClientParams {
  if (typeof window === 'undefined') {
    return { origin: null, minBattery: undefined, tileLayer: undefined };
  }
  const p = new URLSearchParams(window.location.search);
  const hasUrlParams = p.toString().length > 0;

  // If no URL params, try to restore from localStorage (PWA home screen launch)
  if (!hasUrlParams) {
    const stored = loadParamsFromStorage();
    if (stored) {
      const sp = new URLSearchParams();
      if (stored.minBattery !== undefined) sp.set('minBattery', String(stored.minBattery));
      if (stored.tileLayer) sp.set('tile', stored.tileLayer);
      window.history.replaceState(null, '', `?${sp.toString()}`);
      return stored;
    }
  }

  return parseClientParams(p);
}

function boundsEqual(a: MapBounds | null, b: MapBounds): boolean {
  if (!a) return false;
  return (
    Math.abs(a.south - b.south) < 1e-7 &&
    Math.abs(a.west - b.west) < 1e-7 &&
    Math.abs(a.north - b.north) < 1e-7 &&
    Math.abs(a.east - b.east) < 1e-7
  );
}

export default function Home() {
  const { t, formatNumber } = useI18n();
  const [initialCenter, setInitialCenter] = useState<[number, number]>(SWITZERLAND_CENTER);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [minBattery, setMinBattery] = useState(0);
  const [tileLayer, setTileLayer] = useState<'dark' | 'light' | 'osm'>('light');
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    new Set(Object.keys(PROVIDERS))
  );
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [clusters, setClusters] = useState<ScooterCluster[]>([]);
  const [responseProviderCounts, setResponseProviderCounts] = useState<Record<string, number>>({});
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);
  const [mapQuery, setMapQuery] = useState<ScooterMapQuery | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    location: [number, number] | null;
    version: number;
  }>({ location: null, version: 0 });
  const [searchedAddress, setSearchedAddress] = useState<AddressResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [responseMeta, setResponseMeta] = useState<ScooterResponse['meta'] | null>(null);
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [showLocationIntro, setShowLocationIntro] = useState(true);
  const [selectedVehicleKey, setSelectedVehicleKey] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const mapQueryRef = useRef<ScooterMapQuery | null>(null);
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestSequenceRef = useRef(0);
  const lastUpdatedRef = useRef<number | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects intentionally
     restore browser-only state after hydration and fetch data when inputs change. */

  // Restore saved settings before live location tracking starts.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = readUrlParams();
    if (params.minBattery !== undefined) setMinBattery(params.minBattery);
    if (params.tileLayer) setTileLayer(params.tileLayer);

    // Preserve old shared links without persisting their coordinates again.
    if (params.origin) {
      setInitialCenter(params.origin);
      setShowLocationIntro(false);
      setFocusRequest(current => ({ location: params.origin, version: current.version + 1 }));
    }
  }, []);

  // Sync state to URL + localStorage
  useEffect(() => {
    const p = serializeClientParams({ minBattery, tileLayer });
    const qs = p.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);

    // Persist to localStorage for PWA home screen launches
    const stored: Record<string, string> = {};
    p.forEach((v, k) => { stored[k] = v; });
    saveParamsToStorage(stored);
  }, [minBattery, tileLayer]);

  useEffect(() => {
    const darkMap = tileLayer === 'dark';
    document.documentElement.style.colorScheme = darkMap ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', darkMap ? '#1c1c1e' : '#e0ddd8');

    return () => {
      document.documentElement.style.colorScheme = '';
    };
  }, [tileLayer]);

  const fetchScooters = useCallback(async (requestedQuery?: ScooterMapQuery) => {
    const query = requestedQuery ?? mapQueryRef.current;
    if (!query) return;
    const { bounds, zoom } = query;

    requestRef.current?.controller.abort();
    const request = {
      id: ++requestSequenceRef.current,
      controller: new AbortController(),
    };
    requestRef.current = request;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({
        south: bounds.south.toFixed(5),
        west: bounds.west.toFixed(5),
        north: bounds.north.toFixed(5),
        east: bounds.east.toFixed(5),
        zoom: String(zoom),
        minBattery: String(minBattery),
      });
      const res = await fetch(`/api/scooters?${params}`, {
        signal: request.controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ScooterResponse = await res.json();
      setVehicles(data.vehicles);
      setClusters(data.clusters ?? []);
      setResponseProviderCounts(data.providers ?? {});
      setResponseMeta(data.meta);
      const generatedAt = data.meta?.generatedAt ? new Date(data.meta.generatedAt) : new Date();
      const updatedAt = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;
      lastUpdatedRef.current = updatedAt.getTime();
      setLastUpdated(updatedAt);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      console.error('Failed to fetch scooters:', e);
      setError(true);
    } finally {
      if (requestRef.current?.id === request.id) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [minBattery]);

  useEffect(() => {
    if (mapQuery) void fetchScooters(mapQuery);
  }, [fetchScooters, mapQuery]);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  useEffect(() => {
    const refreshIfDue = () => {
      const lastUpdatedAt = lastUpdatedRef.current;
      if (!shouldAutoRefresh({
        visible: document.visibilityState === 'visible',
        requestInFlight: requestRef.current !== null,
        hasBounds: mapQueryRef.current !== null,
        lastUpdatedAt,
        now: Date.now(),
        intervalMs: AUTO_REFRESH_INTERVAL_MS,
      })) return;

      void fetchScooters();
    };

    const intervalId = window.setInterval(refreshIfDue, AUTO_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshIfDue);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshIfDue);
    };
  }, [fetchScooters]);

  /* eslint-enable react-hooks/set-state-in-effect */

  const handleProviderToggle = (provider: string) => {
    setEnabledProviders(current => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const handleShowAllProviders = () => {
    setEnabledProviders(new Set(Object.keys(PROVIDERS)));
  };

  const handleAddressSelect = (result: AddressResult) => {
    const location: [number, number] = [result.lat, result.lng];
    setShowLocationIntro(false);
    setSelectedVehicleKey(null);
    setSearchedAddress(result);
    setFocusRequest(current => ({ location, version: current.version + 1 }));
  };

  const handleViewportChange = useCallback((bounds: MapBounds, zoom: number) => {
    setViewportBounds(current => boundsEqual(current, bounds) ? current : bounds);

    const clustered = shouldClusterAtZoom(zoom);
    const current = mapQueryRef.current;
    const shouldFetch = !current || (clustered
      ? !shouldClusterAtZoom(current.zoom) || current.zoom !== zoom || !boundsEqual(current.bounds, bounds)
      : shouldClusterAtZoom(current.zoom) || !boundsContainBounds(current.bounds, bounds));
    if (!shouldFetch) return;

    const next = {
      bounds: clustered ? bounds : expandBounds(bounds, VIEWPORT_FETCH_PADDING),
      zoom,
    };
    mapQueryRef.current = next;
    setMapQuery(next);
  }, []);

  const handleLocateMe = useCallback(() => {
    setShowLocationIntro(false);
    const focusOn = (coords: [number, number]) => {
      setFocusRequest(current => ({ location: coords, version: current.version + 1 }));
    };

    // The live watch already supplies the blue-marker position. Reusing it
    // makes this control immediate and avoids a second permission/GPS roundtrip.
    if (userLocation) {
      focusOn(userLocation);
      return;
    }

    if (!('geolocation' in navigator)) return;

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(coords);
        focusOn(coords);
        setLocating(false);
        setLocationDenied(false);
      },
      (positionError) => {
        setLocating(false);
        setLocationDenied(positionError.code === positionError.PERMISSION_DENIED);
      },
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 10000 }
    );
  }, [userLocation]);

  const resetFilters = useCallback(() => {
    setMinBattery(0);
    setEnabledProviders(new Set(Object.keys(PROVIDERS)));
  }, []);

  // The response covers a padded area; only markers inside the exact viewport
  // are rendered and counted. Provider counts intentionally ignore the active
  // provider selection so every pill shows how many are available on screen.
  const viewportData = useMemo(() => {
    const clustered = responseMeta?.mode === 'clusters';
    const providerCounts: Record<string, number> = clustered
      ? { ...responseProviderCounts }
      : {};
    const visibleVehicles: Vehicle[] = [];
    const visibleClusters: ScooterCluster[] = [];
    if (!viewportBounds) return { providerCounts, visibleVehicles, visibleClusters, totalCount: 0 };

    for (const vehicle of vehicles) {
      if (!boundsContainPoint(viewportBounds, vehicle.lat, vehicle.lng)) continue;
      if (minBattery > 0 && (vehicle.battery === null || vehicle.battery < minBattery)) continue;

      if (!clustered) {
        providerCounts[vehicle.provider] = (providerCounts[vehicle.provider] ?? 0) + 1;
      }
      if (enabledProviders.has(vehicle.provider)) visibleVehicles.push(vehicle);
    }

    if (clustered) {
      for (const cluster of clusters) {
        if (!boundsContainPoint(viewportBounds, cluster.lat, cluster.lng)) continue;
        const providers = Object.fromEntries(
          Object.entries(cluster.providers).filter(([provider]) => enabledProviders.has(provider))
        );
        const count = Object.values(providers).reduce((total, value) => total + value, 0);
        if (count > 0) visibleClusters.push({ ...cluster, count, providers });
      }
    }

    const totalCount = visibleVehicles.length + visibleClusters.reduce(
      (total, cluster) => total + cluster.count,
      0
    );
    return { providerCounts, visibleVehicles, visibleClusters, totalCount };
  }, [
    clusters,
    enabledProviders,
    minBattery,
    responseMeta?.mode,
    responseProviderCounts,
    vehicles,
    viewportBounds,
  ]);

  const representedVehicleCount = vehicles.length + clusters.reduce(
    (total, cluster) => total + cluster.count,
    0
  );

  const dataHealthNotice = useMemo(
    () => scooterDataHealthNotice(responseMeta, representedVehicleCount, {
      cached: t('data.cached'),
      partial: t('data.partial'),
      truncated: (shown, total) => t('data.truncated', {
        shown: formatNumber(shown),
        total: formatNumber(total),
      }),
    }),
    [formatNumber, representedVehicleCount, responseMeta, t]
  );

  const selectedVehicle = useMemo<SelectedVehicle | null>(() => {
    if (!selectedVehicleKey) return null;
    const vehicle = viewportData.visibleVehicles.find(candidate => {
      const key = candidate.vehicle_id
        ? `${candidate.provider}:${candidate.vehicle_id}`
        : `${candidate.provider}:${candidate.lat}:${candidate.lng}`;
      return key === selectedVehicleKey;
    });
    if (!vehicle) return null;
    return {
      vehicle,
      distanceM: userLocation
        ? haversineM(userLocation[0], userLocation[1], vehicle.lat, vehicle.lng)
        : null,
    };
  }, [selectedVehicleKey, userLocation, viewportData.visibleVehicles]);

  return (
    <div className="app-shell" data-map-theme={tileLayer}>
      <MapWrapper
        vehicles={viewportData.visibleVehicles}
        clusters={viewportData.visibleClusters}
        clustered={responseMeta?.mode === 'clusters'}
        origin={initialCenter}
        initialZoom={INITIAL_ZOOM}
        distanceOrigin={userLocation}
        tileLayer={tileLayer}
        userLocation={userLocation}
        focusLocation={focusRequest.location}
        focusVersion={focusRequest.version}
        destination={searchedAddress}
        onViewportChange={handleViewportChange}
        selectedVehicleKey={selectedVehicleKey}
        onVehicleSelect={vehicle => setSelectedVehicleKey(
          vehicle.vehicle_id
            ? `${vehicle.provider}:${vehicle.vehicle_id}`
            : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`
        )}
      />

      {showLocationIntro && !userLocation && !searchedAddress && (
        <div className="location-intro glass" role="dialog" aria-labelledby="location-intro-title">
          <div>
            <strong id="location-intro-title">{t('intro.title')}</strong>
            <span>{t('intro.body')}</span>
          </div>
          <div className="location-intro-actions">
            <button className="intro-primary" onClick={handleLocateMe}>{t('intro.useLocation')}</button>
            <button onClick={() => setShowLocationIntro(false)}>{t('intro.browse')}</button>
          </div>
        </div>
      )}

      {locating && (
        <div className="toast glass" role="status">
          <span className="mini-spinner" aria-hidden="true" />
          {t('status.updatingLocation')}
        </div>
      )}

      {error && !locating && (
        <div className="toast glass toast-error" role="alert">
          {t('errors.fetchScooters')}
          <button onClick={() => void fetchScooters()}>{t('status.retry')}</button>
        </div>
      )}

      {locationDenied && !locating && !error && (
        <div className="toast glass toast-location" role="status">
          {t('errors.locationDenied')}
        </div>
      )}

      <MapControls
        loading={loading}
        hidden={controlsExpanded}
        onLocateMe={handleLocateMe}
        onRefresh={() => void fetchScooters()}
      />

      <BottomSheet
        minBattery={minBattery}
        enabledProviders={enabledProviders}
        providerCounts={viewportData.providerCounts}
        totalCount={viewportData.totalCount}
        loading={loading}
        lastUpdated={lastUpdated}
        dataHealthNotice={dataHealthNotice}
        tileLayer={tileLayer}
        selectedVehicle={selectedVehicle}
        onMinBatteryChange={setMinBattery}
        onAddressSelect={handleAddressSelect}
        onAddressClear={() => setSearchedAddress(null)}
        onShowAllProviders={handleShowAllProviders}
        onProviderToggle={handleProviderToggle}
        onTileLayerChange={setTileLayer}
        onExpandedChange={setControlsExpanded}
        onClearSelection={() => setSelectedVehicleKey(null)}
        onResetFilters={resetFilters}
      />
    </div>
  );
}
