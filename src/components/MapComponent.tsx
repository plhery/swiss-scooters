'use client';

import { useEffect, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  AttributionControl,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Vehicle } from '@/lib/types';
import { PROVIDERS } from '@/lib/types';

function createScooterIcon(provider: string): L.DivIcon {
  const cfg = PROVIDERS[provider] ?? { color: '#999', initial: '?' };
  return L.divIcon({
    className: '',
    html: `<div style="background:${cfg.color};color:#fff;font:700 11px -apple-system,BlinkMacSystemFont,sans-serif;width:30px;height:30px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center">${cfg.initial}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
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

function createPinIcon(label: string, bg: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="background:${bg};color:#fff;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;padding:5px 11px;border-radius:999px;border:2px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 16],
  });
}

function FitBounds({ vehicles, origin, destination }: {
  vehicles: Vehicle[];
  origin: [number, number];
  destination: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [origin];
    if (destination) points.push(destination);
    vehicles.forEach(v => points.push([v.lat, v.lng]));
    if (points.length > 1) {
      map.fitBounds(points, {
        paddingTopLeft: [40, 70],
        paddingBottomRight: [40, 190], // keep markers clear of the bottom sheet
        maxZoom: 17,
      });
    }
  }, [vehicles, origin, destination, map]);
  return null;
}

function getCorridorPolygon(
  origin: [number, number],
  dest: [number, number],
  widthM: number
): [number, number][] {
  const [alat, alng] = origin;
  const [blat, blng] = dest;
  const dx = blng - alng;
  const dy = blat - alat;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [];

  // Approximate degrees per meter
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(((alat + blat) / 2) * Math.PI / 180);
  const offsetLat = (widthM / mPerDegLat) * (dx / len);
  const offsetLng = (widthM / mPerDegLng) * (-dy / len);

  return [
    [alat + offsetLat, alng + offsetLng],
    [blat + offsetLat, blng + offsetLng],
    [blat - offsetLat, blng - offsetLng],
    [alat - offsetLat, alng - offsetLng],
  ];
}

const TILE_URLS: Record<string, string> = {
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function batteryColor(pct: number): string {
  if (pct >= 50) return '#34c759';
  if (pct >= 20) return '#ff9500';
  return '#ff3b30';
}

interface MapComponentProps {
  vehicles: Vehicle[];
  origin: [number, number];
  destination: [number, number] | null;
  corridorWidth: number;
  tileLayer: 'dark' | 'light' | 'osm';
  userLocation: [number, number] | null;
}

export default function MapComponent({
  vehicles,
  origin,
  destination,
  corridorWidth,
  tileLayer,
  userLocation,
}: MapComponentProps) {
  // Pre-create all provider icons (stable across renders)
  const iconMap = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const provider of Object.keys(PROVIDERS)) {
      icons[provider] = createScooterIcon(provider);
    }
    return icons;
  }, []);

  const corridorPoly = useMemo(() => {
    if (!destination) return null;
    return getCorridorPolygon(origin, destination, corridorWidth);
  }, [origin, destination, corridorWidth]);

  const originIcon = useMemo(() => createPinIcon('Origin', '#1c1c1e'), []);
  const destIcon = useMemo(() => createPinIcon('Destination', '#0a84ff'), []);
  const userLocationIcon = useMemo(() => createUserLocationIcon(), []);

  return (
    <MapContainer
      center={origin}
      zoom={15}
      className="w-full h-full"
      zoomControl={false}
      attributionControl={false}
    >
      <AttributionControl position="topright" prefix={false} />
      <TileLayer
        key={tileLayer}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url={TILE_URLS[tileLayer]}
        subdomains="abc"
      />

      <Marker position={origin} icon={originIcon} zIndexOffset={1000} />

      {userLocation && (
        <Marker
          position={userLocation}
          icon={userLocationIcon}
          zIndexOffset={2000}
          title="Your live location"
        />
      )}

      {destination && (
        <Marker position={destination} icon={destIcon} zIndexOffset={1000} />
      )}

      {corridorPoly && (
        <Polygon
          positions={corridorPoly}
          pathOptions={{ color: '#0a84ff', fillColor: '#0a84ff', fillOpacity: 0.12, weight: 2 }}
        />
      )}

      {vehicles.map((v, i) => {
        const cfg = PROVIDERS[v.provider];
        return (
          <Marker key={`${v.provider}-${v.vehicle_id}-${i}`} position={[v.lat, v.lng]} icon={iconMap[v.provider]}>
            <Popup className="scooter-popup" closeButton={false}>
              <div>
                <div className="popup-head">
                  <span className="popup-dot" style={{ background: cfg?.color ?? '#999' }} aria-hidden="true" />
                  <span className="popup-name">{cfg?.name ?? v.provider}</span>
                  <span className="popup-dist">{formatDistance(v.distance_m)}</span>
                </div>
                {v.battery !== null && (
                  <div className="popup-batt">
                    <div className="popup-batt-bar">
                      <div style={{ width: `${v.battery}%`, background: batteryColor(v.battery) }} />
                    </div>
                    <span>
                      {v.battery}%{v.range_m !== null ? ` · ${(v.range_m / 1000).toFixed(1)} km` : ''}
                    </span>
                  </div>
                )}
                {v.deep_link && (
                  <a
                    href={v.deep_link}
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
      })}

      <FitBounds vehicles={vehicles} origin={origin} destination={destination} />
    </MapContainer>
  );
}
