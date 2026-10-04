'use client';

import { track } from '@/lib/analytics';

import { prefersReducedMotion, selectionFeedback } from '@/lib/feedback';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import '@tomickigrzegorz/leaflet-rotate';
import 'leaflet/dist/leaflet.css';
import MapCompass from './MapCompass';
import MarkerPopover, { followMarker } from './MarkerPopover';
import UserLocationMarker from './UserLocationMarker';
import type { MapBounds, ParkingLocation, ScooterCluster, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { AddressResult } from '@/components/AddressSearch';
import { haversineM } from '@/lib/geo';
import { stopMapRotation, syncRotationMotion } from '@/lib/mapRotation';
import { scooterTip } from '@/lib/scooterTip';
import './map.css';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

function createScooterIcon(provider: string, selected = false): L.DivIcon {
  const cfg = PROVIDERS[provider] ?? { color: '#999', initial: '?' };
  return L.divIcon({
    className: 'scooter-marker-wrap',
    html: `<div class="scooter-marker${selected ? ' scooter-marker-selected' : ''}" style="--marker-color:${cfg.color}"><span>${cfg.initial}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function createParkingIcon(provider: string, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'parking-marker-wrap',
    html: `<span class="parking-marker${selected ? ' parking-marker-selected' : ''}" style="--parking-provider:${PROVIDERS[provider]?.color ?? '#2166c2'}">P</span>`,
    // The sign is small; what can be pressed around it is 44 px, as for a scooter.
    iconSize: [44, 44],
    iconAnchor: [12, 32],
  });
}

function createDestinationIcon(): L.DivIcon {
  return L.divIcon({
    className: 'destination-marker-wrap',
    html: `<div class="destination-marker"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 34],
  });
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

// A scooter's disc is 34 px inside the 44 px its marker takes; the hover tip sits just above the disc.
const MARKER_INSET = 5;
const TIP_GAP = 8;
const TIP_MARGIN = 8;

function formatDistance(meters: number, t: Translate, formatNumber: FormatNumber): string {
  return meters < 1000
    ? t('distance.meters', { count: formatNumber(Math.round(meters)) })
    : t('distance.kilometers', {
        count: formatNumber(meters / 1000, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      });
}

function createClusterIcon(cluster: ScooterCluster): L.DivIcon {
  const providerOrder = Object.keys(PROVIDERS);
  const entries = Object.entries(cluster.providers).sort(([a], [b]) => {
    const aIndex = providerOrder.indexOf(a);
    const bIndex = providerOrder.indexOf(b);
    return (aIndex < 0 ? providerOrder.length : aIndex) -
      (bIndex < 0 ? providerOrder.length : bIndex);
  });
  const mixed = entries.length > 1;

  let progress = 0;
  const segments = entries.map(([provider, count]) => {
    const start = progress;
    progress += (count / cluster.count) * 360;
    return `${PROVIDERS[provider]?.color ?? '#999'} ${start}deg ${progress}deg`;
  });

  const providerBadges = entries.slice(0, 4).map(([provider]) => {
    const cfg = PROVIDERS[provider] ?? { color: '#999', initial: '?' };
    return `<span style="--provider-color:${cfg.color}">${cfg.initial}</span>`;
  }).join('');
  const hiddenProviderCount = Math.max(0, entries.length - 4);
  const primaryProvider = PROVIDERS[entries[0][0]] ?? { color: '#999', initial: '?' };
  const background = mixed
    ? `conic-gradient(${segments.join(',')})`
    : primaryProvider.color;
  const contents = mixed
    ? `<span class="cluster-total">${cluster.count}</span><span class="cluster-provider-list">${providerBadges}${hiddenProviderCount ? `<span class="cluster-provider-more">+${hiddenProviderCount}</span>` : ''}</span>`
    : `<span class="cluster-single-brand">${primaryProvider.initial}</span><span class="cluster-single-count">${cluster.count}</span>`;

  return L.divIcon({
    className: 'cluster-marker-wrap',
    html: `<div class="cluster-marker ${mixed ? 'cluster-marker-mixed' : 'cluster-marker-single'}" style="--cluster-background:${background}">${contents}</div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

function clusterTitle(cluster: ScooterCluster, t: Translate, formatNumber: FormatNumber): string {
  const providers = Object.entries(cluster.providers)
    .map(([provider, count]) => `${PROVIDERS[provider]?.name ?? provider} ${formatNumber(count)}`)
    .join(', ');
  return t('marker.cluster', { count: formatNumber(cluster.count), providers });
}

/** The name of a marker, and the browser's own tooltip unless the map shows one itself. */
function updateMarkerLabel(marker: L.Marker, label: string, tooltip = true) {
  // Leaflet writes this to the icon whenever it draws it.
  marker.options.title = tooltip ? label : '';
  const element = marker.getElement();
  element?.setAttribute('aria-label', label);
  if (tooltip) element?.setAttribute('title', label);
  else element?.removeAttribute('title');
}

function labelMarker(marker: L.Marker, label: string, tooltip = true) {
  const applyLabel = () => updateMarkerLabel(marker, label, tooltip);
  marker.on('add', applyLabel);
  applyLabel();
}

/** Leaflet makes a marker a button that can be reached with Tab, but only a pointer presses it: Enter and Space do too. */
function onMarkerPress(marker: L.Marker, press: () => void): L.Marker {
  return marker.on('click', press).on('keypress', (event) => {
    const { key } = event.originalEvent;
    if (key === 'Enter' || key === ' ') press();
  });
}

function vehicleMarkerKey(vehicle: Vehicle): string {
  return vehicle.vehicle_id
    ? `${vehicle.provider}:${vehicle.vehicle_id}`
    : `${vehicle.provider}:${vehicle.lat}:${vehicle.lng}`;
}

function MapZoomControls({ mapRef }: { mapRef: { current: L.Map | null } }) {
  const { t } = useI18n();
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!controlRef.current) return;
    L.DomEvent.disableClickPropagation(controlRef.current);
    L.DomEvent.disableScrollPropagation(controlRef.current);
  }, []);

  return (
    <div ref={controlRef} className="map-zoom-controls" role="group" aria-label={t('controls.zoomGroup')}>
      <button
        type="button"
        aria-label={t('controls.zoomIn')}
        title={t('controls.zoomIn')}
        onClick={() => { selectionFeedback(); track('map_zoom', { direction: 'in' }); mapRef.current?.zoomIn(1, { animate: !prefersReducedMotion() }); }}
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        aria-label={t('controls.zoomOut')}
        title={t('controls.zoomOut')}
        onClick={() => { selectionFeedback(); track('map_zoom', { direction: 'out' }); mapRef.current?.zoomOut(1, { animate: !prefersReducedMotion() }); }}
      >
        <span aria-hidden="true">−</span>
      </button>
    </div>
  );
}

interface MapComponentProps {
  parking?: ParkingLocation[];
  vehicles: Vehicle[];
  clusters: ScooterCluster[];
  clustered: boolean;
  origin: [number, number];
  initialZoom: number;
  distanceOrigin: [number, number] | null;
  userLocation: [number, number] | null;
  headingEnabled: boolean;
  focusLocation: [number, number] | null;
  /** The zoom to arrive at; null keeps the current zoom, or street level when further out. */
  focusZoom: number | null;
  focusVersion: number;
  destination: AddressResult | null;
  onViewportChange: (bounds: MapBounds, zoom: number) => void;
  selectedVehicleKey: string | null;
  onVehicleSelect: (vehicle: Vehicle) => void;
  selectedParkingId: string | null;
  onParkingSelect: (location: ParkingLocation) => void;
  /** Desktop: a scooter under the pointer says what it is, in place of the browser's tooltip. */
  hoverTips?: boolean;
  /** Desktop: the card of the selected scooter or parking bay, shown beside its marker. */
  popover?: MapPopover | null;
  /** A step in or out asked for from the keyboard; each new version is one step. */
  zoomStep?: { direction: 1 | -1; version: number };
}

export interface MapPopover {
  /** Names the card for screen readers: "Lime scooter", "Dott parking bay". */
  label: string;
  content: ReactNode;
}

export default function MapComponent({
  parking = [],
  vehicles,
  clusters,
  clustered,
  origin,
  initialZoom,
  distanceOrigin,
  userLocation,
  headingEnabled,
  focusLocation,
  focusZoom,
  focusVersion,
  destination,
  onViewportChange,
  selectedVehicleKey,
  onVehicleSelect,
  selectedParkingId,
  onParkingSelect,
  hoverTips = false,
  popover = null,
  zoomStep,
}: MapComponentProps) {
  const { t, formatNumber } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const scooterLayerRef = useRef<L.LayerGroup | null>(null);
  const destinationLayerRef = useRef<L.LayerGroup | null>(null);
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const parkingMarkersRef = useRef<Map<string, { marker: L.Marker; signature: string }>>(new Map());
  const markerSignaturesRef = useRef<Map<string, string>>(new Map());
  const vehicleDataRef = useRef<Map<string, Vehicle>>(new Map());
  const parkingDataRef = useRef<Map<string, ParkingLocation>>(new Map());
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const initialOriginRef = useRef(origin);
  const onViewportChangeRef = useRef(onViewportChange);
  const onVehicleSelectRef = useRef(onVehicleSelect);
  const onParkingSelectRef = useRef(onParkingSelect);
  const [readyMap, setReadyMap] = useState<L.Map | null>(null);
  const [zoom, setZoom] = useState(initialZoom);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onVehicleSelectRef.current = onVehicleSelect;
  }, [onVehicleSelect]);

  useEffect(() => {
    onParkingSelectRef.current = onParkingSelect;
  }, [onParkingSelect]);

  const iconMap = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const provider of Object.keys(PROVIDERS)) {
      icons[provider] = createScooterIcon(provider);
    }
    return icons;
  }, []);
  const selectedIconMap = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const provider of Object.keys(PROVIDERS)) {
      icons[provider] = createScooterIcon(provider, true);
    }
    return icons;
  }, []);
  const destinationIcon = useMemo(() => createDestinationIcon(), []);

  const reportViewport = useCallback((map: L.Map) => {
    const bounds = map.getBounds();
    const next = {
      south: Math.min(90, Math.max(-90, bounds.getSouth())),
      west: Math.min(180, Math.max(-180, bounds.getWest())),
      north: Math.min(90, Math.max(-90, bounds.getNorth())),
      east: Math.min(180, Math.max(-180, bounds.getEast())),
    };
    if (next.south < next.north && next.west < next.east) {
      onViewportChangeRef.current(next, map.getZoom());
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const vehicleMarkers = vehicleMarkersRef.current;
    const clusterMarkers = clusterMarkersRef.current;
    const parkingMarkers = parkingMarkersRef.current;
    const markerSignatures = markerSignaturesRef.current;

    const map = L.map(container, {
      center: initialOriginRef.current,
      zoom: initialZoom,
      zoomControl: false,
      attributionControl: false,
      rotate: true,
      touchRotate: true,
      shiftKeyRotate: true,
      dragRotate: true,
      rotateControl: false,
      preferCanvas: true,
      zoomAnimation: !prefersReducedMotion(),
      fadeAnimation: !prefersReducedMotion(),
      markerZoomAnimation: !prefersReducedMotion(),
    });
    mapRef.current = map;
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => syncRotationMotion(map);
    syncMotion();
    motionQuery.addEventListener('change', syncMotion);
    scooterLayerRef.current = L.layerGroup().addTo(map);
    destinationLayerRef.current = L.layerGroup().addTo(map);

    const updateZoom = () => {
      const currentZoom = map.getZoom();
      container.dataset.zoom = String(currentZoom);
      setZoom(currentZoom);
    };
    const updateViewport = () => reportViewport(map);
    map.on('zoomend', updateZoom);
    map.on('moveend', updateViewport);
    map.on('rotateend', updateViewport);
    updateZoom();
    map.whenReady(updateViewport);
    setReadyMap(map);

    return () => {
      setReadyMap(null);
      map.off('zoomend', updateZoom);
      map.off('moveend', updateViewport);
      map.off('rotateend', updateViewport);
      motionQuery.removeEventListener('change', syncMotion);
      stopMapRotation(map);
      map.remove();
      mapRef.current = null;
      scooterLayerRef.current = null;
      destinationLayerRef.current = null;
      vehicleMarkers.clear();
      clusterMarkers.clear();
      parkingMarkers.clear();
      markerSignatures.clear();
      vehicleDataRef.current.clear();
      parkingDataRef.current.clear();
      tileLayerRef.current = null;
      delete container.dataset.zoom;
    };
  }, [initialZoom, reportViewport]);

  // Parking bays open in the dock, as scooters do: a tap selects, the page shows the card.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || !map) return;
    const markers = parkingMarkersRef.current;
    parkingDataRef.current = new Map(parking.map(location => [location.id, location]));
    for (const [id, entry] of markers) {
      if (!parkingDataRef.current.has(id)) { entry.marker.remove(); markers.delete(id); }
    }
    for (const location of parking) {
      const { id } = location;
      const label = t('parking.label', { name: PROVIDERS[location.provider]?.name ?? location.provider, place: location.name });
      const selected = id === selectedParkingId;
      const signature = JSON.stringify([location, label, selected]);
      const existing = markers.get(id);
      if (existing?.signature === signature) continue;
      const icon = createParkingIcon(location.provider, selected);
      if (existing) {
        // Changed in place, so that a bay selected from the keyboard keeps the focus.
        if (!existing.marker.getLatLng().equals([location.lat, location.lng])) existing.marker.setLatLng([location.lat, location.lng]);
        existing.marker.setIcon(icon);
        updateMarkerLabel(existing.marker, label);
        existing.signature = signature;
        continue;
      }
      const marker = onMarkerPress(
        L.marker([location.lat, location.lng], { icon, title: label, zIndexOffset: 100 }),
        () => {
          const current = parkingDataRef.current.get(id);
          if (current) onParkingSelectRef.current(current);
        }
      ).addTo(map);
      labelMarker(marker, label);
      markers.set(id, { marker, signature });
    }
  }, [readyMap, parking, selectedParkingId, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || !map) return;

    tileLayerRef.current?.remove();
    const layer = L.tileLayer(TILE_URL, {
      attribution: OSM_ATTRIBUTION,
      // Calm or detailed, light or dark: the stylesheet filters this one layer.
      className: 'map-basemap',
      // Identify the site without sending a shared link's coordinates in Referer.
      referrerPolicy: 'origin',
      maxNativeZoom: 19,
      maxZoom: 22,
      updateWhenZooming: false,
      keepBuffer: 2,
    }).addTo(map);
    tileLayerRef.current = layer;

    return () => {
      layer.remove();
      if (tileLayerRef.current === layer) tileLayerRef.current = null;
    };
  }, [readyMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || !map || !focusLocation || focusVersion === 0) return;
    map.stop();
    map.flyTo(focusLocation, focusZoom ?? Math.max(map.getZoom(), 16), {
      animate: !prefersReducedMotion(),
      duration: 0.5,
      easeLinearity: 0.25,
    });
  }, [focusLocation, focusVersion, focusZoom, readyMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || !map || !zoomStep || zoomStep.version === 0) return;
    const options = { animate: !prefersReducedMotion() };
    if (zoomStep.direction > 0) map.zoomIn(1, options);
    else map.zoomOut(1, options);
  }, [readyMap, zoomStep]);

  useEffect(() => {
    const layer = destinationLayerRef.current;
    if (!readyMap || !layer) return;
    layer.clearLayers();

    if (destination) {
      const label = t('marker.searchedAddress', { name: destination.display_name });
      const marker = L.marker([destination.lat, destination.lng], {
        icon: destinationIcon,
        zIndexOffset: 1800,
        title: label,
      }).addTo(layer);
      labelMarker(marker, label);
    }
  }, [destination, destinationIcon, readyMap, t]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = scooterLayerRef.current;
    if (!readyMap || !map || !layer) return;

    const distanceFor = (vehicle: Vehicle) => distanceOrigin
      ? haversineM(distanceOrigin[0], distanceOrigin[1], vehicle.lat, vehicle.lng)
      : null;
    const labelFor = (vehicle: Vehicle, distanceM: number | null) => {
      const cfg = PROVIDERS[vehicle.provider];
      const name = cfg?.name ?? vehicle.provider;
      return distanceM === null
        ? t('marker.scooter', { name })
        : t('marker.scooterAway', {
            name,
            distance: formatDistance(distanceM, t, formatNumber),
          });
    };

    vehicleDataRef.current = new Map(vehicles.map(vehicle => [vehicleMarkerKey(vehicle), vehicle]));
    const incomingKeys = new Set(vehicleDataRef.current.keys());
    for (const [key, marker] of vehicleMarkersRef.current) {
      if (incomingKeys.has(key)) continue;
      layer.removeLayer(marker);
      vehicleMarkersRef.current.delete(key);
      markerSignaturesRef.current.delete(`v:${key}`);
    }
    for (const vehicle of vehicles) {
      const key = vehicleMarkerKey(vehicle);
      const distanceM = distanceFor(vehicle);
      const label = labelFor(vehicle, distanceM);
      const selected = key === selectedVehicleKey;
      const signature = JSON.stringify([vehicle, selected, distanceM, label, hoverTips]);
      if (markerSignaturesRef.current.get(`v:${key}`) === signature) continue;
      markerSignaturesRef.current.set(`v:${key}`, signature);
      const icon = selected
        ? selectedIconMap[vehicle.provider] ?? createScooterIcon(vehicle.provider, true)
        : iconMap[vehicle.provider] ?? createScooterIcon(vehicle.provider);
      const existing = vehicleMarkersRef.current.get(key);
      if (existing) {
        if (!existing.getLatLng().equals([vehicle.lat, vehicle.lng])) existing.setLatLng([vehicle.lat, vehicle.lng]);
        if (existing.options.icon !== icon) existing.setIcon(icon);
        updateMarkerLabel(existing, label, !hoverTips);
      } else {
        const marker = onMarkerPress(
          L.marker([vehicle.lat, vehicle.lng], { icon, riseOnHover: true, title: hoverTips ? '' : label }),
          () => {
            const current = vehicleDataRef.current.get(key);
            if (current) onVehicleSelectRef.current(current);
          }
        ).addTo(layer);
        labelMarker(marker, label, !hoverTips);
        vehicleMarkersRef.current.set(key, marker);
      }
    }

    const visibleClusters = clustered ? clusters : [];
    const incomingClusters = new Set(visibleClusters.map(cluster => cluster.id));
    for (const [id, marker] of clusterMarkersRef.current) {
      if (incomingClusters.has(id)) continue;
      layer.removeLayer(marker);
      clusterMarkersRef.current.delete(id);
      markerSignaturesRef.current.delete(`c:${id}`);
    }
    for (const cluster of visibleClusters) {
      const center: [number, number] = [cluster.lat, cluster.lng];
      const label = `${cluster.city ? `${cluster.city}: ` : ''}${clusterTitle(cluster, t, formatNumber)}`;
      const signature = JSON.stringify([cluster, label]);
      if (markerSignaturesRef.current.get(`c:${cluster.id}`) === signature) continue;
      markerSignaturesRef.current.set(`c:${cluster.id}`, signature);
      const existing = clusterMarkersRef.current.get(cluster.id);
      if (existing) {
        if (!existing.getLatLng().equals(center)) existing.setLatLng(center);
        existing.setIcon(createClusterIcon(cluster));
        updateMarkerLabel(existing, label);
      } else {
        const marker = onMarkerPress(
          L.marker(center, { icon: createClusterIcon(cluster), zIndexOffset: 500, title: label }),
          () => {
            selectionFeedback();
            track('cluster_select');
            map.flyTo(marker.getLatLng(), cluster.city ? 13 : Math.min(map.getZoom() + 2, 20), {
              animate: !prefersReducedMotion(), duration: 0.55,
            });
          }
        ).addTo(layer);
        labelMarker(marker, label);
        clusterMarkersRef.current.set(cluster.id, marker);
      }
    }
  }, [
    clustered,
    clusters,
    distanceOrigin,
    formatNumber,
    hoverTips,
    iconMap,
    readyMap,
    selectedIconMap,
    selectedVehicleKey,
    t,
    vehicles,
    zoom,
  ]);

  // On a desktop a scooter under the pointer, or reached with the keyboard, says
  // who runs it, how charged it is and how far the walk is.
  useEffect(() => {
    const map = mapRef.current;
    const tip = tipRef.current;
    if (!readyMap || !map || !tip || !hoverTips) return;
    const container = map.getContainer();
    const hide = () => { tip.hidden = true; };
    const show = (event: Event) => {
      const icon = event.target instanceof Element ? event.target.closest<HTMLElement>('.scooter-marker-wrap') : null;
      const key = icon && [...vehicleMarkersRef.current].find(([, marker]) => marker.getElement() === icon)?.[0];
      const vehicle = key ? vehicleDataRef.current.get(key) : undefined;
      // The card of the selected scooter already says all of it.
      if (!icon || !vehicle || key === selectedVehicleKey) {
        hide();
        return;
      }
      const distanceM = distanceOrigin
        ? haversineM(distanceOrigin[0], distanceOrigin[1], vehicle.lat, vehicle.lng)
        : null;
      tip.textContent = scooterTip(vehicle, distanceM, { t, formatNumber });
      tip.hidden = false;
      const target = icon.getBoundingClientRect();
      const centred = target.left + target.width / 2 - tip.offsetWidth / 2;
      const above = target.top + MARKER_INSET - TIP_GAP - tip.offsetHeight;
      tip.style.left = `${Math.round(Math.max(TIP_MARGIN, Math.min(centred, window.innerWidth - tip.offsetWidth - TIP_MARGIN)))}px`;
      // Under the scooter where there is no room above it.
      tip.style.top = `${Math.round(above < TIP_MARGIN ? target.bottom - MARKER_INSET + TIP_GAP : above)}px`;
    };
    container.addEventListener('mouseover', show);
    container.addEventListener('mouseleave', hide);
    container.addEventListener('focusin', show);
    container.addEventListener('focusout', hide);
    map.on('movestart zoomstart', hide);
    return () => {
      hide();
      container.removeEventListener('mouseover', show);
      container.removeEventListener('mouseleave', hide);
      container.removeEventListener('focusin', show);
      container.removeEventListener('focusout', hide);
      map.off('movestart zoomstart', hide);
    };
  }, [distanceOrigin, formatNumber, hoverTips, readyMap, selectedVehicleKey, t]);

  const popoverAnchor = useCallback(() => {
    const marker = selectedVehicleKey !== null
      ? vehicleMarkersRef.current.get(selectedVehicleKey)
      : selectedParkingId !== null ? parkingMarkersRef.current.get(selectedParkingId)?.marker : undefined;
    return marker?.getElement() ?? null;
  }, [selectedParkingId, selectedVehicleKey]);
  const hasPopover = popover !== null;

  // The card stays beside its marker. Declared after the effects that draw the
  // markers, so that the marker is there to stand beside; new data may move it.
  useEffect(() => {
    const map = mapRef.current;
    const card = popoverRef.current;
    if (!readyMap || !map || !card || !hasPopover) return;
    return followMarker(map, card, popoverAnchor);
  }, [hasPopover, parking, popoverAnchor, readyMap, vehicles]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      {readyMap && (
        <UserLocationMarker map={readyMap} location={userLocation} headingEnabled={headingEnabled} />
      )}
      <div className="map-navigation">
        <MapCompass map={readyMap} />
        <MapZoomControls mapRef={mapRef} />
      </div>
      <div ref={tipRef} className="map-tip glass" aria-hidden="true" hidden />
      {readyMap && popover && (
        <MarkerPopover
          cardRef={popoverRef}
          label={popover.label}
          selectionKey={selectedVehicleKey ?? selectedParkingId ?? ''}
          anchor={popoverAnchor}
        >
          {popover.content}
        </MarkerPopover>
      )}
    </>
  );
}
