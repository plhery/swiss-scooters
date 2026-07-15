import type { MapBounds } from '@/lib/types';

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000.0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function boundsContainPoint(bounds: MapBounds, lat: number, lng: number): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

export function boundsContainBounds(container: MapBounds, contained: MapBounds): boolean {
  return (
    contained.south >= container.south &&
    contained.west >= container.west &&
    contained.north <= container.north &&
    contained.east <= container.east
  );
}

export function expandBounds(bounds: MapBounds, paddingRatio: number): MapBounds {
  const latPadding = (bounds.north - bounds.south) * paddingRatio;
  const lngPadding = (bounds.east - bounds.west) * paddingRatio;

  return {
    south: Math.max(-90, bounds.south - latPadding),
    west: Math.max(-180, bounds.west - lngPadding),
    north: Math.min(90, bounds.north + latPadding),
    east: Math.min(180, bounds.east + lngPadding),
  };
}

export function shouldRefreshLocation(
  origin: [number, number],
  next: [number, number],
  accuracyM: number,
  minimumDistanceM: number
): boolean {
  const refreshDistance = Math.max(minimumDistanceM, accuracyM);
  return haversineM(origin[0], origin[1], next[0], next[1]) >= refreshDistance;
}
