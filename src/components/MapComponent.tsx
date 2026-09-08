'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapBounds, ParkingLocation, ScooterCluster, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { AddressResult } from '@/components/AddressSearch';
import { haversineM } from '@/lib/geo';
import { browserRentalLink } from '@/lib/rentalLinks';
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

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const MOBILITY_ATTRIBUTION = '<a href="https://opentransportdata.swiss/en/cookbook/shared-mobility/">Mobility data CH</a> · <a href="https://transport.data.gouv.fr/datasets?type=vehicles-sharing">FR: Dott, Bird, Lime, Voi, Pony</a>';
const ADDRESS_ATTRIBUTION = '<a href="https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api">&copy; swisstopo</a>';
const TILE_ATTRIBUTION = `${OSM_ATTRIBUTION} · ${MOBILITY_ATTRIBUTION} · ${ADDRESS_ATTRIBUTION}`;

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
  distanceM: number | null,
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
  if (distanceM !== null) {
    head.appendChild(makeElement(
      'span',
      'popup-dist',
      formatDistance(distanceM, t, formatNumber)
    ));
  }
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

  const actions = makeElement('div', 'popup-actions');
  const directions = makeElement('a', 'popup-cta popup-walk', t('marker.walkThere'));
  const destination = `${vehicle.lat},${vehicle.lng}`;
  directions.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`;
  directions.target = '_blank';
  directions.rel = 'noopener noreferrer';
  actions.appendChild(directions);

  const rentalLink = browserRentalLink(
    vehicle,
    navigator.userAgent,
    navigator.maxTouchPoints
  );
  if (rentalLink) {
    const link = makeElement('a', 'popup-cta', t('marker.openIn', {
      name: cfg?.name ?? t('marker.app'),
    }));
    link.href = rentalLink;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.background = cfg?.color ?? '#0a84ff';
    actions.appendChild(link);
  }
  root.appendChild(actions);

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

function updateMarkerLabel(marker: L.Marker, label: string) {
  marker.options.title = label;
  const element = marker.getElement();
  element?.setAttribute('aria-label', label);
  element?.setAttribute('title', label);
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
  parking?: ParkingLocation[];
  vehicles: Vehicle[];
  clusters: ScooterCluster[];
  clustered: boolean;
  origin: [number, number];
  initialZoom: number;
  distanceOrigin: [number, number] | null;
  tileLayer: 'dark' | 'light' | 'osm';
  userLocation: [number, number] | null;
  focusLocation: [number, number] | null;
  focusVersion: number;
  destination: AddressResult | null;
  onViewportChange: (bounds: MapBounds, zoom: number) => void;
  selectedVehicleKey: string | null;
  onVehicleSelect: (vehicle: Vehicle) => void;
}

export default function MapComponent({
  parking = [],
  vehicles,
  clusters,
  clustered,
  origin,
  initialZoom,
  distanceOrigin,
  tileLayer,
  userLocation,
  focusLocation,
  focusVersion,
  destination,
  onViewportChange,
  selectedVehicleKey,
  onVehicleSelect,
}: MapComponentProps) {
  const { t, formatNumber } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const scooterLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const destinationLayerRef = useRef<L.LayerGroup | null>(null);
  const vehicleMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const clusterMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const parkingMarkersRef = useRef<Map<string, { marker: L.Marker; signature: string }>>(new Map());
  const markerSignaturesRef = useRef<Map<string, string>>(new Map());
  const vehicleDataRef = useRef<Map<string, Vehicle>>(new Map());
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const initialOriginRef = useRef(origin);
  const onViewportChangeRef = useRef(onViewportChange);
  const onVehicleSelectRef = useRef(onVehicleSelect);
  const [mapReady, setMapReady] = useState(false);
  const [zoom, setZoom] = useState(initialZoom);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onVehicleSelectRef.current = onVehicleSelect;
  }, [onVehicleSelect]);

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
      preferCanvas: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });
    mapRef.current = map;
    scooterLayerRef.current = L.layerGroup().addTo(map);
    destinationLayerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

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
      scooterLayerRef.current = null;
      userLayerRef.current = null;
      destinationLayerRef.current = null;
      vehicleMarkers.clear();
      clusterMarkers.clear();
      parkingMarkers.clear();
      markerSignatures.clear();
      vehicleDataRef.current.clear();
      tileLayerRef.current = null;
      delete container.dataset.zoom;
    };
  }, [initialZoom, reportViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const markers = parkingMarkersRef.current;
    const shown = zoom >= 16 ? parking : [];
    const ids = new Set(shown.map(location => location.id));
    for (const [id, entry] of markers) {
      if (!ids.has(id)) { entry.marker.remove(); markers.delete(id); }
    }
    for (const location of shown) {
      const provider = PROVIDERS[location.provider];
      const label = t('parking.label', { name: provider?.name ?? location.provider, place: location.name });
      const signature = JSON.stringify([location, label, t('parking.check')]);
      const old = markers.get(location.id);
      if (old?.signature === signature) continue;
      old?.marker.remove();
      const popup = makeElement('div', 'parking-popup', '');
      popup.appendChild(makeElement('strong', '', label));
      popup.appendChild(makeElement('p', '', t(location.mandatory ? 'parking.required' : 'parking.designated')));
      popup.appendChild(makeElement('p', '', t('parking.check')));
      const link = makeElement('a', 'popup-cta', t('parking.directions'));
      link.href = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}&travelmode=walking`;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; popup.appendChild(link);
      const marker = L.marker([location.lat, location.lng], {
        icon: L.divIcon({ className: 'parking-marker-wrap',
          html: `<span class="parking-marker" style="--parking-provider:${provider?.color ?? '#2166c2'}">P</span>`,
          iconSize: [36, 36], iconAnchor: [8, 28] }),
        title: label, zIndexOffset: 100,
      }).bindPopup(popup).addTo(map);
      labelMarker(marker, label);
      markers.set(location.id, { marker, signature });
    }
  }, [mapReady, parking, t, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    tileLayerRef.current?.remove();
    const layer = L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      className: `map-basemap-${tileLayer}`,
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
  }, [mapReady, tileLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !focusLocation || focusVersion === 0) return;
    map.stop();
    map.flyTo(focusLocation, Math.max(map.getZoom(), 16), {
      animate: true,
      duration: 0.5,
      easeLinearity: 0.25,
    });
  }, [focusLocation, focusVersion, mapReady]);

  useEffect(() => {
    const layer = userLayerRef.current;
    if (!mapReady || !layer) return;
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
  }, [mapReady, t, userLocation, userLocationIcon]);

  useEffect(() => {
    const layer = destinationLayerRef.current;
    if (!mapReady || !layer) return;
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
  }, [destination, destinationIcon, mapReady, t]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = scooterLayerRef.current;
    if (!mapReady || !map || !layer) return;

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
      const signature = JSON.stringify([vehicle, selected, distanceM, label]);
      if (markerSignaturesRef.current.get(`v:${key}`) === signature) continue;
      markerSignaturesRef.current.set(`v:${key}`, signature);
      const icon = selected
        ? selectedIconMap[vehicle.provider] ?? createScooterIcon(vehicle.provider, true)
        : iconMap[vehicle.provider] ?? createScooterIcon(vehicle.provider);
      const existing = vehicleMarkersRef.current.get(key);
      if (existing) {
        if (!existing.getLatLng().equals([vehicle.lat, vehicle.lng])) existing.setLatLng([vehicle.lat, vehicle.lng]);
        if (existing.options.icon !== icon) existing.setIcon(icon);
        existing.setPopupContent(vehiclePopup(vehicle, distanceM, t, formatNumber));
        updateMarkerLabel(existing, label);
      } else {
        const marker = L.marker([vehicle.lat, vehicle.lng], { icon, riseOnHover: true, title: label })
          .bindPopup(vehiclePopup(vehicle, distanceM, t, formatNumber), {
            className: 'scooter-popup', closeButton: false,
          })
          .on('click', () => {
            const current = vehicleDataRef.current.get(key);
            if (current) onVehicleSelectRef.current(current);
          })
          .addTo(layer);
        labelMarker(marker, label);
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
        const marker = L.marker(center, { icon: createClusterIcon(cluster), zIndexOffset: 500, title: label })
          .on('click', () => map.flyTo(marker.getLatLng(), cluster.city ? 13 : Math.min(map.getZoom() + 2, 20), {
            animate: true, duration: 0.55,
          }))
          .addTo(layer);
        labelMarker(marker, label);
        clusterMarkersRef.current.set(cluster.id, marker);
      }
    }
  }, [
    clustered,
    clusters,
    distanceOrigin,
    formatNumber,
    iconMap,
    mapReady,
    selectedIconMap,
    selectedVehicleKey,
    t,
    vehicles,
    zoom,
  ]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <MapZoomControls mapRef={mapRef} />
    </>
  );
}
