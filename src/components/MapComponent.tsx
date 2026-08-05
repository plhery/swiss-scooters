'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapBounds, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { AddressResult } from '@/components/AddressSearch';
import { shouldClusterAtZoom } from '@/lib/clustering';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

function createScooterIcon(provider: string): L.DivIcon {
  const cfg = PROVIDERS[provider] ?? { color: '#999', initial: '?' };
  return L.divIcon({
    className: 'scooter-marker-wrap',
    html: `<div class="scooter-marker" style="--marker-color:${cfg.color}"><span>${cfg.initial}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
}

function createUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center">
      <div class="user-loc-pulse" style="position:absolute;width:24px;height:24px;border-radius:50%;background:rgba(10,132,255,0.35)"></div>
      <div style="width:16px;height:16px;border-radius:50%;background:#0a84ff;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);position:relative;z-index:1"></div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
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

const TILE_URLS: Record<string, string> = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const MOBILITY_ATTRIBUTION = 'Mobility data: <a href="https://opentransportdata.swiss/en/cookbook/shared-mobility/">opentransportdata.swiss</a>';
const ADDRESS_ATTRIBUTION = 'Address data: <a href="https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api">&copy; swisstopo</a>';
const TILE_ATTRIBUTIONS: Record<string, string> = {
  osm: `${OSM_ATTRIBUTION} · ${MOBILITY_ATTRIBUTION} · ${ADDRESS_ATTRIBUTION}`,
  dark: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a> · ${MOBILITY_ATTRIBUTION} · ${ADDRESS_ATTRIBUTION}`,
  light: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a> · ${MOBILITY_ATTRIBUTION} · ${ADDRESS_ATTRIBUTION}`,
};

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

function batteryColor(percentage: number): string {
  if (percentage >= 50) return '#34c759';
  if (percentage >= 20) return '#ff9500';
  return '#ff3b30';
}

function createClusterIcon(vehicles: Vehicle[]): L.DivIcon {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    counts.set(vehicle.provider, (counts.get(vehicle.provider) ?? 0) + 1);
  }

  const providerOrder = Object.keys(PROVIDERS);
  const entries = [...counts.entries()].sort(([a], [b]) => {
    const aIndex = providerOrder.indexOf(a);
    const bIndex = providerOrder.indexOf(b);
    return (aIndex < 0 ? providerOrder.length : aIndex) -
      (bIndex < 0 ? providerOrder.length : bIndex);
  });
  const mixed = entries.length > 1;

  let progress = 0;
  const segments = entries.map(([provider, count]) => {
    const start = progress;
    progress += (count / vehicles.length) * 360;
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
    ? `<span class="cluster-total">${vehicles.length}</span><span class="cluster-provider-list">${providerBadges}${hiddenProviderCount ? `<span class="cluster-provider-more">+${hiddenProviderCount}</span>` : ''}</span>`
    : `<span class="cluster-single-brand">${primaryProvider.initial}</span><span class="cluster-single-count">${vehicles.length}</span>`;

  return L.divIcon({
    className: 'cluster-marker-wrap',
    html: `<div class="cluster-marker ${mixed ? 'cluster-marker-mixed' : 'cluster-marker-single'}" style="--cluster-background:${background}">${contents}</div>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

function clusterTitle(vehicles: Vehicle[], t: Translate, formatNumber: FormatNumber): string {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    counts.set(vehicle.provider, (counts.get(vehicle.provider) ?? 0) + 1);
  }
  const providers = [...counts.entries()]
    .map(([provider, count]) => `${PROVIDERS[provider]?.name ?? provider} ${formatNumber(count)}`)
    .join(', ');
  return t('marker.cluster', { count: formatNumber(vehicles.length), providers });
}

function makeElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function vehiclePopup(
  vehicle: Vehicle,
  t: Translate,
  formatNumber: FormatNumber
): HTMLElement {
  const cfg = PROVIDERS[vehicle.provider];
  const root = makeElement('div');
  const head = makeElement('div', 'popup-head');
  const dot = makeElement('span', 'popup-dot');
  dot.style.background = cfg?.color ?? '#999';
  dot.setAttribute('aria-hidden', 'true');
  head.appendChild(dot);
  head.appendChild(makeElement('span', 'popup-name', cfg?.name ?? vehicle.provider));
  head.appendChild(makeElement(
    'span',
    'popup-dist',
    formatDistance(vehicle.distance_m, t, formatNumber)
  ));
  root.appendChild(head);

  if (vehicle.battery !== null) {
    const battery = makeElement('div', 'popup-batt');
    const track = makeElement('div', 'popup-batt-bar');
    const fill = makeElement('div');
    fill.style.width = `${vehicle.battery}%`;
    fill.style.background = batteryColor(vehicle.battery);
    track.appendChild(fill);
    const range = vehicle.range_m === null
      ? ''
      : ` · ${formatDistance(vehicle.range_m, t, formatNumber)}`;
    battery.appendChild(track);
    battery.appendChild(makeElement(
      'span',
      undefined,
      `${formatNumber(vehicle.battery)}%${range}`
    ));
    root.appendChild(battery);
  }

  if (vehicle.deep_link) {
    const link = makeElement('a', 'popup-cta', t('marker.openIn', {
      name: cfg?.name ?? t('marker.app'),
    }));
    link.href = vehicle.deep_link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.background = cfg?.color ?? '#0a84ff';
    root.appendChild(link);
  }

  return root;
}

function labelMarker(marker: L.Marker, label: string) {
  const applyLabel = () => {
    const element = marker.getElement();
    element?.setAttribute('aria-label', label);
    element?.setAttribute('title', label);
  };
  marker.on('add', applyLabel);
  applyLabel();
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
        onClick={() => mapRef.current?.zoomIn()}
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        type="button"
        aria-label={t('controls.zoomOut')}
        title={t('controls.zoomOut')}
        onClick={() => mapRef.current?.zoomOut()}
      >
        <span aria-hidden="true">−</span>
      </button>
    </div>
  );
}

interface MapComponentProps {
  vehicles: Vehicle[];
  origin: [number, number];
  tileLayer: 'dark' | 'light' | 'osm';
  userLocation: [number, number] | null;
  focusLocation: [number, number] | null;
  focusVersion: number;
  destination: AddressResult | null;
  onViewportChange: (bounds: MapBounds) => void;
}

export default function MapComponent({
  vehicles,
  origin,
  tileLayer,
  userLocation,
  focusLocation,
  focusVersion,
  destination,
  onViewportChange,
}: MapComponentProps) {
  const { t, formatNumber } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const initialOriginRef = useRef(origin);
  const onViewportChangeRef = useRef(onViewportChange);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(17);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  const iconMap = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const provider of Object.keys(PROVIDERS)) {
      icons[provider] = createScooterIcon(provider);
    }
    return icons;
  }, []);
  const userLocationIcon = useMemo(() => createUserLocationIcon(), []);
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
      onViewportChangeRef.current(next);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: initialOriginRef.current,
      zoom: 17,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });
    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);
    L.control.attribution({ position: 'topright', prefix: false }).addTo(map);

    const updateZoom = () => {
      const currentZoom = map.getZoom();
      container.dataset.zoom = String(currentZoom);
      setZoom(currentZoom);
    };
    const updateViewport = () => reportViewport(map);
    map.on('zoomend', updateZoom);
    map.on('moveend', updateViewport);
    updateZoom();
    map.whenReady(updateViewport);
    setMapReady(true);

    return () => {
      setMapReady(false);
      map.off('zoomend', updateZoom);
      map.off('moveend', updateViewport);
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      tileLayerRef.current = null;
      delete container.dataset.zoom;
    };
  }, [reportViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    tileLayerRef.current?.remove();
    const layer = L.tileLayer(TILE_URLS[tileLayer], {
      attribution: TILE_ATTRIBUTIONS[tileLayer],
      subdomains: 'abc',
      updateWhenZooming: false,
      keepBuffer: 2,
    }).addTo(map);
    tileLayerRef.current = layer;

    return () => {
      layer.remove();
      if (tileLayerRef.current === layer) tileLayerRef.current = null;
    };
  }, [mapReady, tileLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !focusLocation || focusVersion === 0) return;
    map.stop();
    map.flyTo(focusLocation, Math.max(map.getZoom(), 15), {
      animate: true,
      duration: 0.5,
      easeLinearity: 0.25,
    });
  }, [focusLocation, focusVersion, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!mapReady || !map || !layer) return;
    layer.clearLayers();

    if (userLocation) {
      const label = t('marker.yourLocation');
      const marker = L.marker(userLocation, {
        icon: userLocationIcon,
        zIndexOffset: 2000,
        title: label,
      }).addTo(layer);
      labelMarker(marker, label);
    }

    if (destination) {
      const label = t('marker.searchedAddress', { name: destination.display_name });
      const marker = L.marker([destination.lat, destination.lng], {
        icon: destinationIcon,
        zIndexOffset: 1800,
        title: label,
      }).addTo(layer);
      labelMarker(marker, label);
    }

    const addVehicle = (vehicle: Vehicle) => {
      const cfg = PROVIDERS[vehicle.provider];
      const distance = formatDistance(vehicle.distance_m, t, formatNumber);
      const label = t('marker.scooterAway', {
        name: cfg?.name ?? vehicle.provider,
        distance,
      });
      const marker = L.marker([vehicle.lat, vehicle.lng], {
        icon: iconMap[vehicle.provider] ?? createScooterIcon(vehicle.provider),
        riseOnHover: true,
        title: label,
      })
        .bindPopup(vehiclePopup(vehicle, t, formatNumber), {
          className: 'scooter-popup',
          closeButton: false,
        })
        .addTo(layer);
      labelMarker(marker, label);
    };

    if (!shouldClusterAtZoom(zoom)) {
      vehicles.forEach(addVehicle);
      return;
    }

    const baseCellSize = zoom >= 15 ? 44 : zoom >= 13 ? 52 : 60;
    const densityScale = vehicles.length > 1200
      ? 1.35
      : vehicles.length > 700
        ? 1.2
        : vehicles.length > 400
          ? 1.1
          : 1;
    const cellSize = Math.round(baseCellSize * densityScale);
    const cells = new Map<string, Vehicle[]>();
    for (const vehicle of vehicles) {
      const point = map.project([vehicle.lat, vehicle.lng], zoom);
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const group = cells.get(key);
      if (group) group.push(vehicle);
      else cells.set(key, [vehicle]);
    }

    for (const items of cells.values()) {
      if (items.length < 2) {
        addVehicle(items[0]);
        continue;
      }

      const center: [number, number] = [
        items.reduce((sum, item) => sum + item.lat, 0) / items.length,
        items.reduce((sum, item) => sum + item.lng, 0) / items.length,
      ];
      const label = clusterTitle(items, t, formatNumber);
      const marker = L.marker(center, {
        icon: createClusterIcon(items),
        zIndexOffset: 500,
        title: label,
      })
        .on('click', () => map.flyTo(center, Math.min(zoom + 2, 20), {
          animate: true,
          duration: 0.55,
        }))
        .addTo(layer);
      labelMarker(marker, label);
    }
  }, [
    destination,
    destinationIcon,
    formatNumber,
    iconMap,
    mapReady,
    t,
    userLocation,
    userLocationIcon,
    vehicles,
    zoom,
  ]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      <MapZoomControls mapRef={mapRef} />
    </>
  );
}
