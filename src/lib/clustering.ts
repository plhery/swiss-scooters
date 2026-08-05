import type { ScooterCluster, Vehicle } from '@/lib/types';

export const MAX_CLUSTER_ZOOM = 15;
const TILE_SIZE = 256;
const MAX_MERCATOR_LATITUDE = 85.05112878;

export function shouldClusterAtZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom <= MAX_CLUSTER_ZOOM;
}

export interface ClusteredVehicles {
  vehicles: Vehicle[];
  clusters: ScooterCluster[];
}

function clusterCellSize(zoom: number, vehicleCount: number): number {
  const base = zoom >= 15 ? 48 : zoom >= 13 ? 56 : 64;
  const densityScale = vehicleCount > 1200
    ? 1.35
    : vehicleCount > 700
      ? 1.2
      : vehicleCount > 400
        ? 1.1
        : 1;
  return Math.round(base * densityScale);
}

function worldPixel(vehicle: Vehicle, zoom: number): [number, number] {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const latitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, vehicle.lat)
  );
  const sinLatitude = Math.sin(latitude * Math.PI / 180);
  return [
    (vehicle.lng + 180) / 360 * worldSize,
    (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize,
  ];
}

export function clusterVehicles(vehicles: Vehicle[], zoom: number): ClusteredVehicles {
  if (!shouldClusterAtZoom(zoom)) return { vehicles, clusters: [] };

  const cellSize = clusterCellSize(zoom, vehicles.length);
  const cells = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles) {
    const [x, y] = worldPixel(vehicle, zoom);
    const cellX = Math.floor(x / cellSize);
    const cellY = Math.floor(y / cellSize);
    const key = `${zoom}:${cellX}:${cellY}`;
    const cell = cells.get(key);
    if (cell) cell.push(vehicle);
    else cells.set(key, [vehicle]);
  }

  const singletons: Vehicle[] = [];
  const clusters: ScooterCluster[] = [];
  for (const [id, cell] of cells) {
    if (cell.length === 1) {
      singletons.push(cell[0]);
      continue;
    }

    const providers: Record<string, number> = {};
    let latitude = 0;
    let longitude = 0;
    for (const vehicle of cell) {
      latitude += vehicle.lat;
      longitude += vehicle.lng;
      providers[vehicle.provider] = (providers[vehicle.provider] ?? 0) + 1;
    }
    clusters.push({
      id,
      lat: latitude / cell.length,
      lng: longitude / cell.length,
      count: cell.length,
      providers,
    });
  }

  clusters.sort((a, b) => a.id.localeCompare(b.id));
  return { vehicles: singletons, clusters };
}
