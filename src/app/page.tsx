'use client';

import { track } from '@/lib/analytics';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import MapWrapper from '@/components/MapWrapper';
import BottomSheet, { type SelectedVehicle } from '@/components/BottomSheet';
import MapControls from '@/components/MapControls';
import MapCredits from '@/components/MapCredits';
import MapNotices from '@/components/MapNotices';
import SearchIsland from '@/components/SearchIsland';
import ControlSheet from '@/components/ControlSheet';
import { selectionFeedback } from '@/lib/feedback';
import type { AddressResult } from '@/components/AddressSearch';
import type { MapBounds, ScooterCluster, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import {
  parseClientParams,
  parseStoredClientParams,
  serializeClientParams,
  type ClientParams,
  type MapStyleName,
  type ThemeName,
} from '@/lib/clientParams';
import { scooterDataHealthNotice } from '@/lib/dataHealth';
import { useScooterData, type ScooterDataQuery } from '@/lib/useScooterData';
import { mapRepresentationsMatch, providersForViewport } from '@/lib/mapCoverage';
import { useI18n } from '@/lib/i18n';
import {
  boundsContainBounds,
  boundsContainPoint,
  expandBounds,
  haversineM,
} from '@/lib/geo';
import { useLiveLocation } from '@/lib/useLiveLocation';
import { requestHeadingPermission, type HeadingPermission } from '@/lib/deviceHeading';

const SWITZERLAND_CENTER: [number, number] = [46.8182, 8.2275];
const INITIAL_ZOOM = 8;
// About 350 m across on a phone, as the iOS app shows after locating.
const LOCATE_ZOOM = 17;
const VIEWPORT_FETCH_PADDING = 0.25;

const STORAGE_KEY = 'scooters-params';
const PROVIDERS_STORAGE_KEY = 'scooters-providers';
// Only the fact that locating has worked once on this device; never a position.
const LOCATED_ONCE_STORAGE_KEY = 'scooters-located-once';

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

// Until the settings sheet offers appearance and map detail separately, the
// two settings are shown through its single three-way map style.
type LegacyTileLayer = 'light' | 'dark' | 'osm';

function legacyTileLayer(theme: ThemeName, mapStyle: MapStyleName): LegacyTileLayer {
  if (mapStyle === 'detailed') return 'osm';
  return theme === 'dark' ? 'dark' : 'light';
}

function readUrlParams(): ClientParams {
  if (typeof window === 'undefined') {
    return { origin: null, minBattery: undefined, theme: undefined, map: undefined };
  }
  const p = new URLSearchParams(window.location.search);
  const hasUrlParams = p.toString().length > 0;

  // If no URL params, try to restore from localStorage (PWA home screen launch)
  if (!hasUrlParams) {
    const stored = loadParamsFromStorage();
    if (stored) {
      const sp = serializeClientParams({
        minBattery: stored.minBattery ?? 0,
        theme: stored.theme ?? 'auto',
        map: stored.map ?? 'calm',
      });
      window.history.replaceState(null, '', `?${sp.toString()}`);
      return stored;
    }
  }

  return parseClientParams(p);
}

// True only when the browser can tell without asking; a permission prompt needs a tap.
async function locationAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
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
  const {
    location: userLocation,
    locating,
    error: locationError,
    locate,
  } = useLiveLocation();
  const [headingPermission, setHeadingPermission] = useState<HeadingPermission | null>(null);
  const [minBattery, setMinBattery] = useState(0);
  const [theme, setTheme] = useState<ThemeName>('auto');
  const [mapStyle, setMapStyle] = useState<MapStyleName>('calm');
  const tileLayer = legacyTileLayer(theme, mapStyle);
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    new Set(Object.keys(PROVIDERS))
  );
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);
  const [mapQuery, setMapQuery] = useState<ScooterMapQuery | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    location: [number, number] | null;
    /** The zoom to arrive at; null keeps the current zoom, or street level when further out. */
    zoom: number | null;
    version: number;
  }>({ location: null, zoom: null, version: 0 });
  const [searchedAddress, setSearchedAddress] = useState<AddressResult | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'filters' | 'settings'>('filters');
  const [locatedOnce, setLocatedOnce] = useState<boolean | null>(null);
  const [locationNoticeDismissed, setLocationNoticeDismissed] = useState(false);
  const [selectedVehicleKey, setSelectedVehicleKey] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const mapQueryRef = useRef<ScooterMapQuery | null>(null);

  const startLocating = useCallback(() => {
    setLocationNoticeDismissed(false);
    // Asked within the tap, before waiting for GPS. Without a tap the browser
    // cannot prompt, and the direction is then simply not drawn.
    void requestHeadingPermission().then(setHeadingPermission);
    locate((coords) => {
      try { localStorage.setItem(LOCATED_ONCE_STORAGE_KEY, '1'); } catch {}
      setLocatedOnce(true);
      setFocusRequest(current => ({ location: coords, zoom: LOCATE_ZOOM, version: current.version + 1 }));
    });
  }, [locate]);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects intentionally
     restore browser-only state after hydration. */

  // Restore saved settings before live location tracking starts.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PROVIDERS_STORAGE_KEY) ?? 'null');
      if (Array.isArray(saved) && saved.every(key => typeof key === 'string' && Object.hasOwn(PROVIDERS, key))) {
        setEnabledProviders(new Set(saved));
      }
    } catch {}
    let located = false;
    try { located = localStorage.getItem(LOCATED_ONCE_STORAGE_KEY) === '1'; } catch {}
    setLocatedOnce(located);
    setPreferencesReady(true);
    const params = readUrlParams();
    if (params.minBattery !== undefined) setMinBattery(params.minBattery);
    if (params.theme) setTheme(params.theme);
    if (params.map) setMapStyle(params.map);

    // Preserve old shared links without persisting their coordinates again.
    if (params.origin) {
      setInitialCenter(params.origin);
      setFocusRequest(current => ({ location: params.origin, zoom: null, version: current.version + 1 }));
    } else {
      // As the iOS app does on launch: locate at once when that needs no prompt.
      void locationAlreadyGranted().then(granted => { if (granted) startLocating(); });
    }
  }, [startLocating]);

  useEffect(() => {
    if (!preferencesReady) return;
    try { localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify([...enabledProviders].sort())); } catch {}
  }, [enabledProviders, preferencesReady]);

  // Sync state to URL + localStorage
  useEffect(() => {
    if (!preferencesReady) return;
    const p = serializeClientParams({ minBattery, theme, map: mapStyle });
    const qs = p.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);

    // Persist to localStorage for PWA home screen launches
    const stored: Record<string, string> = {};
    p.forEach((v, k) => { stored[k] = v; });
    saveParamsToStorage(stored);
  }, [minBattery, theme, mapStyle, preferencesReady]);

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

  /* eslint-enable react-hooks/set-state-in-effect */

  // Clustered responses are filtered by the server; single scooters by the client.
  const scooterQuery = useMemo<ScooterDataQuery | null>(
    () => mapQuery && { ...mapQuery, minBattery: mapQuery.zoom <= 15 ? minBattery : 0 },
    [mapQuery, minBattery]
  );
  const clearSelection = useCallback(() => setSelectedVehicleKey(null), []);
  const {
    vehicles,
    clusters,
    parking,
    meta: responseMeta,
    lastUpdated: lastUpdatedAt,
    loading: loadingState,
    failure,
    refresh,
  } = useScooterData(scooterQuery, { onOutOfDate: clearSelection });
  const loading = loadingState !== null;
  const lastUpdated = useMemo(
    () => lastUpdatedAt === null ? null : new Date(lastUpdatedAt),
    [lastUpdatedAt]
  );

  const handleProviderToggle = (provider: string) => {
    track('provider_filter', { provider, enabled: !enabledProviders.has(provider), source: 'filters' });
    setEnabledProviders(current => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const handleShowAllProviders = () => {
    track('providers_all');
    setEnabledProviders(new Set(Object.keys(PROVIDERS)));
  };

  const handleAddressSelect = (result: AddressResult) => {
    track('search_select');
    const location: [number, number] = [result.lat, result.lng];
    setSelectedVehicleKey(null);
    setSearchedAddress(result);
    setFocusRequest(current => ({ location, zoom: null, version: current.version + 1 }));
  };

  const handleViewportChange = useCallback((bounds: MapBounds, zoom: number) => {
    setViewportBounds(current => boundsEqual(current, bounds) ? current : bounds);

    const current = mapQueryRef.current;
    const shouldFetch = !current || !mapRepresentationsMatch(current.zoom, zoom) ||
      !boundsContainBounds(current.bounds, bounds);
    if (!shouldFetch) return;

    // Padding also applies to clusters. Stable grid cells make nearby pans reuse
    // the response without refetching or rebuilding the entire marker layer.
    const next = { bounds: expandBounds(bounds, VIEWPORT_FETCH_PADDING), zoom };
    mapQueryRef.current = next;
    setMapQuery(next);
  }, []);

  const handleLocateMe = useCallback(() => {
    track('locate');
    startLocating();
  }, [startLocating]);

  // The only manual refresh: "Try again" where a failure is shown.
  const retryLoad = useCallback(() => {
    track('refresh');
    void refresh().then(succeeded => track('refresh_result', { result: succeeded ? 'success' : 'error' }));
  }, [refresh]);

  const resetFilters = useCallback(() => {
    track('filters_reset');
    setMinBattery(0);
    setEnabledProviders(new Set(Object.keys(PROVIDERS)));
  }, []);

  // The response covers a padded area; only markers inside the exact viewport
  // are rendered and counted. Provider counts intentionally ignore the active
  // provider selection so every pill shows how many are available on screen.
  const viewportData = useMemo(() => {
    const clustered = responseMeta?.mode === 'clusters';
    const providerCounts: Record<string, number> = {};
    const visibleVehicles: Vehicle[] = [];
    const visibleClusters: ScooterCluster[] = [];
    if (!viewportBounds) return { providerCounts, visibleVehicles, visibleClusters, totalCount: 0 };

    for (const vehicle of vehicles) {
      if (!boundsContainPoint(viewportBounds, vehicle.lat, vehicle.lng)) continue;
      if (minBattery > 0 && (vehicle.battery === null || vehicle.battery < minBattery)) continue;

      providerCounts[vehicle.provider] = (providerCounts[vehicle.provider] ?? 0) + 1;
      if (enabledProviders.has(vehicle.provider)) visibleVehicles.push(vehicle);
    }

    if (clustered) {
      for (const cluster of clusters) {
        if (!boundsContainPoint(viewportBounds, cluster.lat, cluster.lng)) continue;
        for (const [provider, count] of Object.entries(cluster.providers)) {
          providerCounts[provider] = (providerCounts[provider] ?? 0) + count;
        }
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
      parkingUnavailable: t('parking.unavailable'),
      parkingStale: t('parking.stale'),
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

  const availableProviders = viewportBounds
    ? [...new Set([...providersForViewport(viewportBounds), ...Object.keys(viewportData.providerCounts)])]
    : Object.keys(PROVIDERS);
  const hasActiveFilters = minBattery > 0 || availableProviders.some(provider => !enabledProviders.has(provider));

  const openPanel = (panel: 'filters' | 'settings') => {
    track(panel === 'filters' ? 'filters_open' : 'settings_open');
    selectionFeedback();
    setSearchExpanded(false);
    setActivePanel(panel);
    setPanelOpen(true);
  };

  const openSearch = () => {
    track('search_open');
    // Commit within the tap so mobile Safari can focus the newly mounted input.
    flushSync(() => setSearchExpanded(true));
  };

  const handleQuickProviderToggle = (provider: string) => {
    track('provider_filter', { provider, source: 'quick' });
    setEnabledProviders(current => {
      if (current.size === 1 && current.has(provider)) return new Set(Object.keys(PROVIDERS));
      if (availableProviders.every(key => current.has(key))) return new Set([provider]);
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  return (
    <div className="app-shell" data-map-theme={tileLayer} data-searching={searchExpanded}>
      <MapWrapper
        parking={parking.filter(location => enabledProviders.has(location.provider) &&
          viewportBounds && boundsContainPoint(viewportBounds, location.lat, location.lng))}
        vehicles={viewportData.visibleVehicles}
        clusters={viewportData.visibleClusters}
        clustered={responseMeta?.mode === 'clusters'}
        origin={initialCenter}
        initialZoom={INITIAL_ZOOM}
        distanceOrigin={userLocation}
        tileLayer={tileLayer}
        userLocation={userLocation}
        headingEnabled={headingPermission === 'granted' && locationError !== 'denied'}
        focusLocation={focusRequest.location}
        focusZoom={focusRequest.zoom}
        focusVersion={focusRequest.version}
        destination={searchedAddress}
        onViewportChange={handleViewportChange}
        selectedVehicleKey={selectedVehicleKey}
        onVehicleSelect={vehicle => {
          track('vehicle_select', { provider: vehicle.provider });
          selectionFeedback();
          setSelectedVehicleKey(vehicle.vehicle_id
            ? `${vehicle.provider}:${vehicle.vehicle_id}`
            : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`
          );
        }}
      />

      <SearchIsland
        address={searchedAddress}
        hasLocation={Boolean(userLocation)}
        expanded={searchExpanded}
        hasActiveFilters={hasActiveFilters}
        onExpandedChange={expanded => { track(expanded ? 'search_open' : 'search_close'); setSearchExpanded(expanded); }}
        onSelect={handleAddressSelect}
        onClear={() => setSearchedAddress(null)}
        onLocate={handleLocateMe}
        onShowFilters={() => openPanel('filters')}
        onShowSettings={() => openPanel('settings')}
      />

      <MapNotices
        loadFailure={failure}
        loading={loading}
        locationError={locating || locationNoticeDismissed ? null : locationError}
        hidden={searchExpanded}
        onRetryLoad={retryLoad}
        onRetryLocate={handleLocateMe}
        onSearchPlace={openSearch}
        onDismissLocation={() => setLocationNoticeDismissed(true)}
      />

      <MapControls
        locating={locating}
        locatedOnce={locatedOnce}
        hidden={searchExpanded}
        onLocateMe={handleLocateMe}
      />

      <MapCredits />

      <BottomSheet
        minBattery={minBattery}
        enabledProviders={enabledProviders}
        providerCounts={viewportData.providerCounts}
        availableProviders={availableProviders}
        totalCount={viewportData.totalCount}
        loading={loading}
        lastUpdated={lastUpdated}
        dataHealthNotice={dataHealthNotice}
        selectedVehicle={selectedVehicle}
        hidden={searchExpanded}
        onShowAllProviders={handleShowAllProviders}
        onProviderToggle={handleQuickProviderToggle}
        onClearSelection={() => { track('vehicle_dismiss'); setSelectedVehicleKey(null); }}
        onResetFilters={resetFilters}
      />

      <ControlSheet
        open={panelOpen}
        panel={activePanel}
        onClose={() => { track('panel_close'); setPanelOpen(false); }}
        minBattery={minBattery}
        enabledProviders={enabledProviders}
        availableProviders={availableProviders}
        hasActiveFilters={hasActiveFilters}
        tileLayer={tileLayer}
        onMinBatteryChange={value => { track('battery_filter', { value }); setMinBattery(value); }}
        onProviderToggle={handleProviderToggle}
        onResetFilters={resetFilters}
        onTileLayerChange={style => {
          track('map_style', { style });
          setMapStyle(style === 'osm' ? 'detailed' : 'calm');
          if (style !== 'osm') setTheme(style);
        }}
      />
    </div>
  );
}
