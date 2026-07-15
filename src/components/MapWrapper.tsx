'use client';

import dynamic from 'next/dynamic';
import type { MapBounds, Vehicle } from '@/lib/types';

const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false });

interface MapWrapperProps {
  vehicles: Vehicle[];
  origin: [number, number];
  tileLayer: 'dark' | 'light' | 'osm';
  userLocation: [number, number] | null;
  focusLocation: [number, number] | null;
  focusVersion: number;
  onViewportChange: (bounds: MapBounds) => void;
}

export default function MapWrapper(props: MapWrapperProps) {
  return <MapComponent {...props} />;
}
