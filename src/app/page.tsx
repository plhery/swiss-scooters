'use client';

import { track } from '@/lib/analytics';

import { useState, useEffect, useEffectEvent, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import MapWrapper from '@/components/MapWrapper';
import type { MapPopover, MarkerLookup } from '@/components/MapComponent';
import BottomSheet from '@/components/BottomSheet';
import KeyHints from '@/components/KeyHints';
import ParkingCard, { type SelectedParking } from '@/components/ParkingCard';
import ScooterCard, { type SelectedVehicle } from '@/components/ScooterCard';
import MapControls from '@/components/MapControls';
import MapCredits from '@/components/MapCredits';
import MapNotices from '@/components/MapNotices';
import SearchIsland from '@/components/SearchIsland';
import ControlSheet from '@/components/ControlSheet';
import LocationHelpSheet from '@/components/LocationHelpSheet';
import { selectionFeedback } from '@/lib/feedback';
import type { MapBounds, ParkingLocation, ScooterCluster, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import {
  parseClientParams,
  parseStoredClientParams,
  serializeClientParams,
  type ClientParams,
  type MapStyleName,
  type ThemeName,
} from '@/lib/clientParams';
import { nearestCoveredCities, type NearbyCoveredCity } from '@/lib/coveredCities';
import { providerHealth, providersInView } from '@/lib/dataHealth';
import { dockIssue, dockModel, originInViewport, type DockInput } from '@/lib/dockModel';
import { useI18n } from '@/lib/i18n';
import { failureSurface } from '@/lib/loadFailure';
import { unfilteredCountInView } from '@/lib/nothingToShow';
import { recentPlaces, type Place } from '@/lib/places';
import { shortcutFor } from '@/lib/shortcuts';
import { useDesktopLayout } from '@/lib/useDesktopLayout';
import { useRecentPlaces } from '@/lib/useRecentPlaces';
import { useScooterData, type ScooterDataQuery } from '@/lib/useScooterData';
import { mapRepresentationsMatch, providersForViewport } from '@/lib/mapCoverage';
import {
  boundsContainBounds,
  boundsContainPoint,
  expandBounds,
} from '@/lib/geo';
import { useLiveLocation } from '@/lib/useLiveLocation';
import { walkEstimate, type WalkOrigin } from '@/lib/walking';
import { requestHeadingPermission, type HeadingPermission } from '@/lib/deviceHeading';

const SWITZERLAND_CENTER: [number, number] = [46.8182, 8.2275];
const INITIAL_ZOOM = 8;
// About 350 m across on a phone, as the iOS app shows after locating.
const LOCATE_ZOOM = 17;
// Where a city's scooters show as clusters, the same as a tap on its total.
const CITY_ZOOM = 13;
// Parking bays show from street level, where the server starts to send them.
const PARKING_MIN_ZOOM = 16;
// "Cities with scooters" in the open search: the covered cities nearest to the map centre.
const SEARCH_CITY_COUNT = 6;
// How often the age of the data in the dock is worked out again.
const CLOCK_TICK_MS = 30_000;
const VIEWPORT_FETCH_PADDING = 0.25;

// The colour the browser gives its own bars in each appearance.
const THEME_COLOR = { light: '#e0ddd8', dark: '#1c1c1e' };

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

// A control that removes itself when it is pressed hands the keyboard to the search bar.
function focusSearchBar() {
  document.querySelector<HTMLElement>('.bar-button')?.focus({ preventScroll: true });
}

// The list of sources over the map closes itself with Escape.
function creditsOpen(): boolean {
  try {
    return document.querySelector('.map-credits:popover-open') !== null;
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
  const { t } = useI18n();
  // A wide window with a mouse: the dock is a legend, cards open beside their marker, keys work.
  const desktop = useDesktopLayout();
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
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    new Set(Object.keys(PROVIDERS))
  );
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);
  const [viewportZoom, setViewportZoom] = useState(INITIAL_ZOOM);
  const [mapQuery, setMapQuery] = useState<ScooterMapQuery | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    location: [number, number] | null;
    /** The zoom to arrive at; null keeps the current zoom, or street level when further out. */
    zoom: number | null;
    version: number;
  }>({ location: null, zoom: null, version: 0 });
  const [zoomStep, setZoomStep] = useState<{ direction: 1 | -1; version: number }>({ direction: 1, version: 0 });
  // The origin for walking times until it is cleared; it wins over your location.
  const [searchedPlace, setSearchedPlace] = useState<Place | null>(null);
  const placeChoicesRef = useRef(0);
  const recent = useRecentPlaces();
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [locationHelpOpen, setLocationHelpOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'filters' | 'settings'>('filters');
  const [locatedOnce, setLocatedOnce] = useState<boolean | null>(null);
  const [locationNoticeDismissed, setLocationNoticeDismissed] = useState(false);
  // A scooter or a parking bay, never both: selecting one clears the other.
  const [selectedVehicleKey, setSelectedVehicleKey] = useState<string | null>(null);
  const [selectedParkingId, setSelectedParkingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const initializedRef = useRef(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const mapQueryRef = useRef<ScooterMapQuery | null>(null);
  const markerLookupRef = useRef<MarkerLookup | null>(null);

  const startLocating = useCallback((moveMap = true) => {
    setLocationNoticeDismissed(false);
    // Asked within the tap, before waiting for GPS. Without a tap the browser
    // cannot prompt, and the direction is then simply not drawn.
    void requestHeadingPermission().then(setHeadingPermission);
    // Locating clears the place: walking times are from your location again.
    setSearchedPlace(null);
    const placeChoices = placeChoicesRef.current;
    locate((coords) => {
      try { localStorage.setItem(LOCATED_ONCE_STORAGE_KEY, '1'); } catch {}
      setLocatedOnce(true);
      // A place chosen while the fix was on its way is the later wish: the map stays there.
      if (moveMap && placeChoicesRef.current === placeChoices) {
        setFocusRequest(current => ({ location: coords, zoom: LOCATE_ZOOM, version: current.version + 1 }));
      }
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

  /* eslint-enable react-hooks/set-state-in-effect */

  // The dock says how old the data is; the clock also catches up after a pause in the background.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  // Clustered responses are filtered by the server; single scooters by the client.
  const scooterQuery = useMemo<ScooterDataQuery | null>(
    () => mapQuery && { ...mapQuery, minBattery: mapQuery.zoom <= 15 ? minBattery : 0 },
    [mapQuery, minBattery]
  );
  const clearSelection = useCallback(() => {
    setSelectedVehicleKey(null);
    setSelectedParkingId(null);
  }, []);
  const {
    vehicles,
    clusters,
    parking,
    meta: responseMeta,
    lastUpdated,
    hasData,
    loading,
    answersQuery,
    failure,
    outOfDate,
    refresh,
  } = useScooterData(scooterQuery, { onOutOfDate: clearSelection });

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

  // A search result, a recent place or a city with scooters: it becomes the origin
  // for walking times, is remembered until the page is closed, and the map moves there.
  const handlePlaceSelect = (place: Place) => {
    track('search_select');
    const location: [number, number] = [place.lat, place.lng];
    clearSelection();
    placeChoicesRef.current += 1;
    setSearchedPlace(place);
    recentPlaces.add(place);
    setFocusRequest(current => ({ location, zoom: place.city ? CITY_ZOOM : null, version: current.version + 1 }));
  };

  const handleViewportChange = useCallback((bounds: MapBounds, zoom: number) => {
    setViewportBounds(current => boundsEqual(current, bounds) ? current : bounds);
    setViewportZoom(zoom);

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

  // Asked from a card for its walking time: the map stays where it is, so the card stays open.
  const handleLocateFromCard = useCallback(() => {
    track('locate');
    startLocating(false);
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

  // Its pin on the map is named as the search bar names the place.
  const destination = useMemo(() => searchedPlace && {
    lat: searchedPlace.lat,
    lng: searchedPlace.lng,
    display_name: [searchedPlace.title, searchedPlace.subtitle].filter(Boolean).join(', '),
  }, [searchedPlace]);

  // A searched place wins over your location until it is cleared.
  const walkOrigin = useMemo<WalkOrigin | null>(() => {
    if (searchedPlace) return { point: [searchedPlace.lat, searchedPlace.lng], place: searchedPlace.title };
    return userLocation ? { point: userLocation, place: null } : null;
  }, [searchedPlace, userLocation]);

  // Like the scooters: only the bays of the providers switched on, inside the exact viewport.
  const visibleParking = useMemo<ParkingLocation[]>(() => {
    if (!viewportBounds || viewportZoom < PARKING_MIN_ZOOM) return [];
    return parking.filter(location => enabledProviders.has(location.provider) &&
      boundsContainPoint(viewportBounds, location.lat, location.lng));
  }, [enabledProviders, parking, viewportBounds, viewportZoom]);

  const selectedParking = useMemo<SelectedParking | null>(() => {
    const bay = selectedParkingId === null ? undefined : visibleParking.find(location => location.id === selectedParkingId);
    return bay ? { parking: bay, walk: walkEstimate(walkOrigin, bay.lat, bay.lng) } : null;
  }, [selectedParkingId, visibleParking, walkOrigin]);

  const selectedVehicle = useMemo<SelectedVehicle | null>(() => {
    if (!selectedVehicleKey) return null;
    const vehicle = viewportData.visibleVehicles.find(candidate => {
      const key = candidate.vehicle_id
        ? `${candidate.provider}:${candidate.vehicle_id}`
        : `${candidate.provider}:${candidate.lat}:${candidate.lng}`;
      return key === selectedVehicleKey;
    });
    if (!vehicle) return null;
    return { vehicle, walk: walkEstimate(walkOrigin, vehicle.lat, vehicle.lng) };
  }, [selectedVehicleKey, viewportData.visibleVehicles, walkOrigin]);

  // What closes a card clears the selection, as in the iOS app: a scooter or a
  // bay that left the view, lost its provider or went with new data does not
  // open again by itself once it is back.
  if (selectedVehicleKey !== null && !selectedVehicle) setSelectedVehicleKey(null);
  if (selectedParkingId !== null && !selectedParking) setSelectedParkingId(null);

  const availableProviders = viewportBounds
    ? [...new Set([...providersForViewport(viewportBounds), ...Object.keys(viewportData.providerCounts)])]
    : Object.keys(PROVIDERS);
  const hasActiveFilters = minBattery > 0 || availableProviders.some(provider => !enabledProviders.has(provider));

  const viewportCenter = useMemo<[number, number] | null>(() => viewportBounds && [
    (viewportBounds.south + viewportBounds.north) / 2,
    (viewportBounds.west + viewportBounds.east) / 2,
  ], [viewportBounds]);
  const nearbyCities = useMemo(
    () => searchExpanded && viewportCenter ? nearestCoveredCities(viewportCenter, SEARCH_CITY_COUNT) : [],
    [searchExpanded, viewportCenter]
  );

  // Who has scooters here whatever the filters hide. Data loaded for another
  // view says nothing about this one, so it names nobody as not sharing data.
  const loadedProviders = useMemo(() => answersQuery
    ? providersInView({ vehicles, clusters, viewport: viewportBounds, serverMinBattery: scooterQuery?.minBattery ?? 0 })
    : null,
  [answersQuery, clusters, scooterQuery?.minBattery, vehicles, viewportBounds]);

  const dockInput: DockInput = {
    count: viewportData.totalCount,
    originInViewport: originInViewport(walkOrigin?.point ?? null, viewportBounds),
    loading,
    failure,
    outOfDate,
    hasData,
    meta: responseMeta,
    lastUpdated,
    now,
    representedCount: representedVehicleCount,
    viewportProviders: availableProviders,
    viewportCenter,
    providerCounts: viewportData.providerCounts,
    providersInView: loadedProviders,
    enabledProviders,
    minBattery,
    unfilteredCount: unfilteredCountInView({
      meta: responseMeta,
      vehicles,
      clusters,
      viewport: viewportBounds,
      serverMinBattery: scooterQuery?.minBattery ?? 0,
    }),
  };
  const dock = dockModel(dockInput);

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

  const handleCitySelect = (city: NearbyCoveredCity) => {
    setFocusRequest(current => ({ location: city.center, zoom: CITY_ZOOM, version: current.version + 1 }));
  };

  const closeCard = () => {
    if (selectedVehicle) track('vehicle_dismiss');
    clearSelection();
  };

  // The marker of the selection: the card in the dock hands the focus back to it when it closes.
  const selectionAnchor = useCallback(
    () => markerLookupRef.current?.(selectedVehicleKey, selectedParkingId) ?? null,
    [selectedParkingId, selectedVehicleKey]
  );

  // On a desktop the card of the selection opens beside its marker; the dock keeps the count.
  const popover: MapPopover | null = !desktop
    ? null
    : selectedVehicle
      ? {
          label: t('marker.scooter', {
            name: PROVIDERS[selectedVehicle.vehicle.provider]?.name ?? selectedVehicle.vehicle.provider,
          }),
          content: (
            <ScooterCard
              key={selectedVehicleKey}
              selection={selectedVehicle}
              onClose={closeCard}
              onLocate={handleLocateFromCard}
            />
          ),
        }
      : selectedParking
        ? {
            label: t('bay.title', {
              name: PROVIDERS[selectedParking.parking.provider]?.name ?? selectedParking.parking.provider,
            }),
            content: <ParkingCard key={selectedParking.parking.id} selection={selectedParking} onClose={closeCard} />,
          }
        : null;

  // The keys listed in the corner of the desktop layout.
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    // A sheet is a modal dialog: it closes itself with Escape and keeps the other keys from the map.
    if (panelOpen || locationHelpOpen) return;
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    if (searchExpanded) {
      // The open search has the keyboard; Escape closes it wherever the focus is.
      if (shortcut === 'close') {
        event.preventDefault();
        track('search_close');
        setSearchExpanded(false);
      }
      return;
    }
    switch (shortcut) {
      case 'search':
        // Keeps the "/" out of the field that opens.
        event.preventDefault();
        openSearch();
        break;
      case 'locate':
        if (!locating && !event.repeat) handleLocateMe();
        break;
      case 'zoomIn':
      case 'zoomOut': {
        const direction = shortcut === 'zoomIn' ? 1 : -1;
        track('map_zoom', { direction: direction > 0 ? 'in' : 'out' });
        setZoomStep(current => ({ direction, version: current.version + 1 }));
        break;
      }
      case 'close':
        if ((selectedVehicle || selectedParking) && !creditsOpen()) closeCard();
        break;
    }
  });
  useEffect(() => {
    if (!desktop) return;
    const onKeyDown = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktop]);

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
    // The stylesheet reads the appearance and the map style from here. Automatic
    // is left to it, so the system's appearance applies before any script runs.
    <div className="app-shell" data-theme={theme} data-map={mapStyle} data-searching={searchExpanded}>
      {/* One colour per system appearance; a chosen appearance holds in both. */}
      <meta
        name="theme-color"
        media="(prefers-color-scheme: light)"
        content={theme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light}
      />
      <meta
        name="theme-color"
        media="(prefers-color-scheme: dark)"
        content={theme === 'light' ? THEME_COLOR.light : THEME_COLOR.dark}
      />
      <MapWrapper
        parking={visibleParking}
        vehicles={viewportData.visibleVehicles}
        clusters={viewportData.visibleClusters}
        clustered={responseMeta?.mode === 'clusters'}
        origin={initialCenter}
        initialZoom={INITIAL_ZOOM}
        distanceOrigin={walkOrigin?.point ?? null}
        userLocation={userLocation}
        headingEnabled={headingPermission === 'granted' && locationError !== 'denied'}
        focusLocation={focusRequest.location}
        focusZoom={focusRequest.zoom}
        focusVersion={focusRequest.version}
        destination={destination}
        onViewportChange={handleViewportChange}
        selectedVehicleKey={selectedVehicleKey}
        onVehicleSelect={vehicle => {
          track('vehicle_select', { provider: vehicle.provider });
          selectionFeedback();
          setSelectedParkingId(null);
          setSelectedVehicleKey(vehicle.vehicle_id
            ? `${vehicle.provider}:${vehicle.vehicle_id}`
            : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`
          );
        }}
        selectedParkingId={selectedParkingId}
        onParkingSelect={location => {
          track('parking_select', { provider: location.provider });
          selectionFeedback();
          setSelectedVehicleKey(null);
          setSelectedParkingId(location.id);
        }}
        onMapClick={closeCard}
        revealAboveDock={!desktop}
        hoverTips={desktop}
        popover={popover}
        zoomStep={zoomStep}
        markerLookupRef={markerLookupRef}
      />

      <SearchIsland
        place={searchedPlace}
        placeHasData={searchedPlace?.covered !== false && dock.kind !== 'outsideCoverage'}
        hasLocation={Boolean(userLocation)}
        locating={locating}
        expanded={searchExpanded}
        hasActiveFilters={hasActiveFilters}
        recentPlaces={recent}
        nearbyCities={nearbyCities}
        onExpandedChange={expanded => { track(expanded ? 'search_open' : 'search_close'); setSearchExpanded(expanded); }}
        onSelect={handlePlaceSelect}
        onClear={() => { track('search_clear'); setSearchedPlace(null); }}
        onLocate={handleLocateMe}
        onShowFilters={() => openPanel('filters')}
        onShowSettings={() => openPanel('settings')}
      />

      <MapNotices
        loadFailure={failureSurface({ failure, hasData, outOfDate }) === 'banner' ? failure : null}
        loading={loading !== null}
        locationError={locating || locationNoticeDismissed ? null : locationError}
        hidden={searchExpanded}
        onRetryLoad={retryLoad}
        onRetryLocate={handleLocateMe}
        onSeeHow={() => setLocationHelpOpen(true)}
        onSearchPlace={openSearch}
        onDismissLocation={() => { setLocationNoticeDismissed(true); focusSearchBar(); }}
      />

      {/* One row in the corner of a desktop; on a phone each of the two places itself. */}
      <div className="map-corner">
        <MapControls
          locating={locating}
          locatedOnce={locatedOnce}
          hidden={searchExpanded}
          onLocateMe={handleLocateMe}
        />

        <MapCredits />
      </div>

      {desktop && <KeyHints />}

      <BottomSheet
        dock={dock}
        issue={dockIssue(dockInput)}
        selectedVehicle={selectedVehicle}
        selectedParking={selectedParking}
        desktop={desktop}
        selectionAnchor={selectionAnchor}
        hidden={searchExpanded}
        onShowAllProviders={handleShowAllProviders}
        onProviderToggle={handleQuickProviderToggle}
        onClearSelection={closeCard}
        // "Show all" and a closest city leave with their card.
        onResetFilters={() => { resetFilters(); focusSearchBar(); }}
        onEditFilters={() => openPanel('filters')}
        onRetry={retryLoad}
        onCitySelect={city => { handleCitySelect(city); focusSearchBar(); }}
        onLocate={handleLocateFromCard}
      />

      <ControlSheet
        open={panelOpen}
        panel={activePanel}
        onClose={() => { track('panel_close'); setPanelOpen(false); }}
        minBattery={minBattery}
        enabledProviders={enabledProviders}
        availableProviders={availableProviders}
        providerCounts={viewportData.providerCounts}
        downProviders={providerHealth({
          meta: responseMeta,
          viewportProviders: availableProviders,
          inView: loadedProviders,
        }).down}
        hasActiveFilters={hasActiveFilters}
        // While the answer for a new view or minimum is on its way there is no count to promise.
        showCount={loading === 'load' ? null : viewportData.totalCount}
        theme={theme}
        mapStyle={mapStyle}
        onMinBatteryChange={value => { track('battery_filter', { value }); setMinBattery(value); }}
        onProviderToggle={handleProviderToggle}
        onResetFilters={resetFilters}
        onThemeChange={next => { track('map_style', { style: next }); setTheme(next); }}
        onMapStyleChange={next => { track('map_style', { style: next }); setMapStyle(next); }}
      />

      <LocationHelpSheet open={locationHelpOpen} onClose={() => setLocationHelpOpen(false)} />
    </div>
  );
}
