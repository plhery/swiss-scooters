'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import MapWrapper from '@/components/MapWrapper';
import BottomSheet from '@/components/BottomSheet';
import MapControls from '@/components/MapControls';
import type { MapBounds, Vehicle, ScooterResponse } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import {
  boundsContainBounds,
  boundsContainPoint,
  expandBounds,
  shouldRefreshLocation,
} from '@/lib/geo';

const ZURICH_CENTER: [number, number] = [47.3769, 8.5417];
const LOCATION_REFRESH_DISTANCE_M = 75;
const VIEWPORT_FETCH_PADDING = 0.25;

function parseCoord(s: string | null): [number, number] | null {
  if (!s) return null;
  const parts = s.split(',').map(Number);
  if (parts.length === 2 && parts.every(n => isFinite(n))) return [parts[0], parts[1]];
  return null;
}

const STORAGE_KEY = 'scooters-params';

function saveParamsToStorage(params: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(params)); } catch {}
}

function loadParamsFromStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

interface UrlParams {
  origin: [number, number] | null;
  minBattery: number | undefined;
  tileLayer: 'dark' | 'light' | 'osm' | undefined;
}

function readUrlParams(): UrlParams {
  if (typeof window === 'undefined') {
    return { origin: null, minBattery: undefined, tileLayer: undefined };
  }
  const p = new URLSearchParams(window.location.search);
  const hasUrlParams = p.toString().length > 0;

  // If no URL params, try to restore from localStorage (PWA home screen launch)
  if (!hasUrlParams) {
    const stored = loadParamsFromStorage();
    if (Object.keys(stored).length > 0) {
      const sp = new URLSearchParams(stored);
      window.history.replaceState(null, '', `?${sp.toString()}`);
      return {
        origin: parseCoord(stored.origin ?? null),
        minBattery: stored.minBattery ? parseInt(stored.minBattery) : undefined,
        tileLayer: (['dark', 'light', 'osm'] as const).includes(stored.tile as 'dark' | 'light' | 'osm')
          ? (stored.tile as 'dark' | 'light' | 'osm')
          : undefined,
      };
    }
  }

  return {
    origin: parseCoord(p.get('origin')),
    minBattery: p.get('minBattery') ? parseInt(p.get('minBattery')!) : undefined,
    tileLayer: (['dark', 'light', 'osm'] as const).includes(p.get('tile') as 'dark' | 'light' | 'osm')
      ? (p.get('tile') as 'dark' | 'light' | 'osm')
      : undefined,
  };
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
  const [origin, setOrigin] = useState<[number, number]>(ZURICH_CENTER);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [minBattery, setMinBattery] = useState(0);
  const [tileLayer, setTileLayer] = useState<'dark' | 'light' | 'osm'>('light');
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    new Set(Object.keys(PROVIDERS))
  );
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);
  const [queryBounds, setQueryBounds] = useState<MapBounds | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    location: [number, number] | null;
    version: number;
  }>({ location: null, version: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const initializedRef = useRef(false);
  const hasFocusedInitialLocationRef = useRef(false);
  const queryBoundsRef = useRef<MapBounds | null>(null);
  const originRef = useRef(origin);
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects intentionally
     restore browser-only state after hydration and fetch data when inputs change. */

  // Restore saved settings before live location tracking starts.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const params = readUrlParams();
    if (params.minBattery !== undefined) setMinBattery(params.minBattery);
    if (params.tileLayer) setTileLayer(params.tileLayer);

    // Show the map immediately with the last known origin while we geolocate
    if (params.origin) setOrigin(params.origin);
  }, []);

  // Track the phone continuously. Small moves update only the blue marker;
  // larger moves advance the distance origin without interrupting map panning.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    setLocating(true);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(coords);
        if (!hasFocusedInitialLocationRef.current) {
          hasFocusedInitialLocationRef.current = true;
          setFocusRequest(current => ({ location: coords, version: current.version + 1 }));
        }
        setOrigin(prev => {
          return shouldRefreshLocation(
            prev,
            coords,
            pos.coords.accuracy,
            LOCATION_REFRESH_DISTANCE_M
          )
            ? coords
            : prev;
        });
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { timeout: 20000, enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    originRef.current = origin;
  }, [origin]);

  // Sync state to URL + localStorage
  useEffect(() => {
    const p = new URLSearchParams();
    p.set('origin', `${origin[0].toFixed(4)},${origin[1].toFixed(4)}`);
    if (minBattery !== 0) p.set('minBattery', String(minBattery));
    if (tileLayer !== 'light') p.set('tile', tileLayer);
    const qs = p.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);

    // Persist to localStorage for PWA home screen launches
    const stored: Record<string, string> = {};
    p.forEach((v, k) => { stored[k] = v; });
    saveParamsToStorage(stored);
  }, [origin, minBattery, tileLayer]);

  const fetchScooters = useCallback(async (requestedBounds?: MapBounds) => {
    const bounds = requestedBounds ?? queryBoundsRef.current;
    if (!bounds) return;

    requestRef.current?.controller.abort();
    const request = {
      id: (requestRef.current?.id ?? 0) + 1,
      controller: new AbortController(),
    };
    requestRef.current = request;
    setLoading(true);
    setError(null);
    try {
      const currentOrigin = originRef.current;
      const params = new URLSearchParams({
        lat: currentOrigin[0].toString(),
        lng: currentOrigin[1].toString(),
        south: bounds.south.toFixed(5),
        west: bounds.west.toFixed(5),
        north: bounds.north.toFixed(5),
        east: bounds.east.toFixed(5),
      });
      const res = await fetch(`/api/scooters?${params}`, {
        signal: request.controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ScooterResponse = await res.json();
      setVehicles(data.vehicles);
      setLastUpdated(new Date());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      console.error('Failed to fetch scooters:', e);
      setError('Couldn’t load scooters');
    } finally {
      if (requestRef.current?.id === request.id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (queryBounds) void fetchScooters(queryBounds);
  }, [fetchScooters, queryBounds]);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  /* eslint-enable react-hooks/set-state-in-effect */

  const handleProviderSelect = (p: string) => {
    setEnabledProviders(prev =>
      prev.size === 1 && prev.has(p)
        ? new Set(Object.keys(PROVIDERS))
        : new Set([p])
    );
  };

  const handleViewportChange = useCallback((bounds: MapBounds) => {
    setViewportBounds(current => boundsEqual(current, bounds) ? current : bounds);

    if (!queryBoundsRef.current || !boundsContainBounds(queryBoundsRef.current, bounds)) {
      const expanded = expandBounds(bounds, VIEWPORT_FETCH_PADDING);
      queryBoundsRef.current = expanded;
      setQueryBounds(expanded);
    }
  }, []);

  const handleLocateMe = useCallback(() => {
    const proceed = () => {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(coords);
          setOrigin(coords);
          setFocusRequest(current => ({ location: coords, version: current.version + 1 }));
          setLocating(false);
        },
        () => setLocating(false),
        { timeout: 10000, enableHighAccuracy: true }
      );
    };

    try {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if (result.state === 'denied') return;
        proceed();
      }).catch(proceed);
    } catch {
      proceed();
    }
  }, []);

  // The response covers a padded area; only markers inside the exact viewport
  // are rendered and counted. Provider counts intentionally ignore the active
  // provider selection so every pill shows how many are available on screen.
  const viewportData = useMemo(() => {
    const providerCounts: Record<string, number> = {};
    const visibleVehicles: Vehicle[] = [];
    if (!viewportBounds) return { providerCounts, visibleVehicles };

    for (const vehicle of vehicles) {
      if (!boundsContainPoint(viewportBounds, vehicle.lat, vehicle.lng)) continue;
      if (minBattery > 0 && (vehicle.battery === null || vehicle.battery < minBattery)) continue;

      providerCounts[vehicle.provider] = (providerCounts[vehicle.provider] ?? 0) + 1;
      if (enabledProviders.has(vehicle.provider)) visibleVehicles.push(vehicle);
    }

    return { providerCounts, visibleVehicles };
  }, [vehicles, viewportBounds, minBattery, enabledProviders]);

  return (
    <div className="app-shell">
      <MapWrapper
        vehicles={viewportData.visibleVehicles}
        origin={origin}
        tileLayer={tileLayer}
        userLocation={userLocation}
        focusLocation={focusRequest.location}
        focusVersion={focusRequest.version}
        onViewportChange={handleViewportChange}
      />

      {locating && (
        <div className="toast glass" role="status">
          <span className="mini-spinner" aria-hidden="true" />
          Updating location…
        </div>
      )}

      {error && !locating && (
        <div className="toast glass toast-error" role="alert">
          {error}
          <button onClick={() => void fetchScooters()}>Retry</button>
        </div>
      )}

      <MapControls
        loading={loading}
        onLocateMe={handleLocateMe}
        onRefresh={() => void fetchScooters()}
      />

      <BottomSheet
        minBattery={minBattery}
        enabledProviders={enabledProviders}
        providerCounts={viewportData.providerCounts}
        totalCount={viewportData.visibleVehicles.length}
        loading={loading}
        lastUpdated={lastUpdated}
        tileLayer={tileLayer}
        onMinBatteryChange={setMinBattery}
        onProviderSelect={handleProviderSelect}
        onTileLayerChange={setTileLayer}
      />
    </div>
  );
}
