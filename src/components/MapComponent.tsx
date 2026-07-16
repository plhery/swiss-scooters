'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  AttributionControl,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapBounds, Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';

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

function ViewportController({
  focusLocation,
  focusVersion,
  onViewportChange,
}: {
  focusLocation: [number, number] | null;
  focusVersion: number;
  onViewportChange: (bounds: MapBounds) => void;
}) {
  const map = useMap();

  const reportViewport = useCallback(() => {
    const bounds = map.getBounds();
    const next = {
      south: Math.min(90, Math.max(-90, bounds.getSouth())),
      west: Math.min(180, Math.max(-180, bounds.getWest())),
      north: Math.min(90, Math.max(-90, bounds.getNorth())),
      east: Math.min(180, Math.max(-180, bounds.getEast())),
    };

    if (next.south < next.north && next.west < next.east) {
      onViewportChange(next);
    }
  }, [map, onViewportChange]);

  useMapEvents({ moveend: reportViewport });

  useEffect(() => {
    reportViewport();
  }, [reportViewport]);

  useEffect(() => {
    if (!focusLocation || focusVersion === 0) return;
    map.stop();
    map.flyTo(focusLocation, Math.max(map.getZoom(), 15), {
      animate: true,
      duration: 0.5,
      easeLinearity: 0.25,
    });
  }, [focusLocation, focusVersion, map]);

  return null;
}

const TILE_URLS: Record<string, string> = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function batteryColor(pct: number): string {
  if (pct >= 50) return '#34c759';
  if (pct >= 20) return '#ff9500';
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
    return (aIndex < 0 ? providerOrder.length : aIndex) - (bIndex < 0 ? providerOrder.length : bIndex);
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

function clusterTitle(vehicles: Vehicle[]): string {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles) {
    counts.set(vehicle.provider, (counts.get(vehicle.provider) ?? 0) + 1);
  }
  const providers = [...counts.entries()]
    .map(([provider, count]) => `${PROVIDERS[provider]?.name ?? provider} ${count}`)
    .join(', ');
  return `${vehicles.length} scooters: ${providers}. Zoom in to separate.`;
}

function VehicleMarker({ vehicle, icon }: { vehicle: Vehicle; icon: L.DivIcon }) {
  const cfg = PROVIDERS[vehicle.provider];
  return (
    <Marker
      key={`${vehicle.provider}-${vehicle.vehicle_id ?? `${vehicle.lat}-${vehicle.lng}`}`}
      position={[vehicle.lat, vehicle.lng]}
      icon={icon}
      riseOnHover
      title={`${cfg?.name ?? vehicle.provider} scooter, ${formatDistance(vehicle.distance_m)} away`}
    >
      <Popup className="scooter-popup" closeButton={false}>
        <div>
          <div className="popup-head">
            <span className="popup-dot" style={{ background: cfg?.color ?? '#999' }} aria-hidden="true" />
            <span className="popup-name">{cfg?.name ?? vehicle.provider}</span>
            <span className="popup-dist">{formatDistance(vehicle.distance_m)}</span>
          </div>
          {vehicle.battery !== null && (
            <div className="popup-batt">
              <div className="popup-batt-bar">
                <div style={{ width: `${vehicle.battery}%`, background: batteryColor(vehicle.battery) }} />
              </div>
              <span>
                {vehicle.battery}%{vehicle.range_m !== null ? ` · ${(vehicle.range_m / 1000).toFixed(1)} km` : ''}
              </span>
            </div>
          )}
          {vehicle.deep_link && (
            <a
              href={vehicle.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="popup-cta"
              style={{ background: cfg?.color ?? '#0a84ff' }}
            >
              Open in {cfg?.name ?? 'app'}
            </a>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

const VehicleMarkers = memo(function VehicleMarkers({
  vehicles,
  icons,
}: {
  vehicles: Vehicle[];
  icons: Record<string, L.DivIcon>;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useMapEvents({
    zoomend: event => setZoom(event.target.getZoom()),
  });

  const groups = useMemo(() => {
    const baseCellSize = zoom >= 19 ? 16 : zoom >= 18 ? 22 : zoom >= 17 ? 30 : zoom >= 16 ? 38 : zoom >= 15 ? 44 : zoom >= 13 ? 52 : 60;
    const densityScale = vehicles.length > 1200 ? 1.35 : vehicles.length > 700 ? 1.2 : vehicles.length > 400 ? 1.1 : 1;
    const cellSize = Math.round(baseCellSize * densityScale);
    const cells = new Map<string, Vehicle[]>();

    vehicles.forEach(vehicle => {
      const point = map.project([vehicle.lat, vehicle.lng], zoom);
      const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      const group = cells.get(key);
      if (group) group.push(vehicle);
      else cells.set(key, [vehicle]);
    });

    return Array.from(cells.entries()).map(([key, items]) => ({
      key,
      items,
      center: [
        items.reduce((sum, item) => sum + item.lat, 0) / items.length,
        items.reduce((sum, item) => sum + item.lng, 0) / items.length,
      ] as [number, number],
    }));
  }, [map, vehicles, zoom]);

  const minimumClusterSize = zoom >= 19 ? 5 : zoom >= 18 ? 4 : zoom >= 17 ? 3 : 2;

  return groups.flatMap(group => {
    if (group.items.length >= minimumClusterSize) {
      return [
        <Marker
          key={`cluster-${zoom}-${group.key}`}
          position={group.center}
          icon={createClusterIcon(group.items)}
          zIndexOffset={500}
          title={clusterTitle(group.items)}
          eventHandlers={{
            click: () => map.flyTo(group.center, Math.min(zoom + 2, 20), {
              animate: true,
              duration: 0.55,
            }),
          }}
        />,
      ];
    }

    return group.items.map(vehicle => (
      <VehicleMarker
        key={`${vehicle.provider}-${vehicle.vehicle_id ?? `${vehicle.lat}-${vehicle.lng}`}`}
        vehicle={vehicle}
        icon={icons[vehicle.provider]}
      />
    ));
  });
});

interface MapComponentProps {
  vehicles: Vehicle[];
  origin: [number, number];
  tileLayer: 'dark' | 'light' | 'osm';
  userLocation: [number, number] | null;
  focusLocation: [number, number] | null;
  focusVersion: number;
  onViewportChange: (bounds: MapBounds) => void;
}

export default function MapComponent({
  vehicles,
  origin,
  tileLayer,
  userLocation,
  focusLocation,
  focusVersion,
  onViewportChange,
}: MapComponentProps) {
  // Pre-create all provider icons (stable across renders)
  const iconMap = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const provider of Object.keys(PROVIDERS)) {
      icons[provider] = createScooterIcon(provider);
    }
    return icons;
  }, []);

  const userLocationIcon = useMemo(() => createUserLocationIcon(), []);

  return (
    <MapContainer
      center={origin}
      zoom={15}
      className="w-full h-full"
      zoomControl={false}
      attributionControl={false}
      preferCanvas
      zoomAnimation
      fadeAnimation
      markerZoomAnimation
    >
      <AttributionControl position="topright" prefix={false} />
      <TileLayer
        key={tileLayer}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> · Mobility data: <a href="https://sharedmobility.ch/">SFOE Shared Mobility</a>'
        url={TILE_URLS[tileLayer]}
        subdomains="abc"
        updateWhenZooming={false}
        keepBuffer={2}
      />

      <ViewportController
        focusLocation={focusLocation}
        focusVersion={focusVersion}
        onViewportChange={onViewportChange}
      />

      {userLocation && (
        <Marker
          position={userLocation}
          icon={userLocationIcon}
          zIndexOffset={2000}
          title="Your live location"
        />
      )}

      <VehicleMarkers vehicles={vehicles} icons={iconMap} />
    </MapContainer>
  );
}
