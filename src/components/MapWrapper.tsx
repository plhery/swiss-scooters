'use client';

import dynamic from 'next/dynamic';
import type { MapBounds, ScooterCluster, Vehicle } from '@/lib/types';
import type { AddressResult } from '@/components/AddressSearch';

const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false });

interface MapWrapperProps {
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
  zoomInVersion: number;
  zoomOutVersion: number;
  onVehicleSelect: (vehicle: Vehicle) => void;
}

export default function MapWrapper(props: MapWrapperProps) {
  return <MapComponent {...props} />;
}
