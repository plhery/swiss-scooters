import { describe, expect, it } from 'vitest';
import { clusterVehicles, shouldClusterAtZoom } from '@/lib/clustering';
import type { Vehicle } from '@/lib/types';

function vehicle(id: string, provider: string, lat: number, lng: number): Vehicle {
  return {
    provider,
    lat,
    lng,
    battery: 80,
    range_m: 10_000,
    vehicle_id: id,
    deep_link: null,
    distance_m: null,
  };
}

describe('web clustering', () => {
  it('clusters through zoom 15 and separates scooters above it', () => {
    expect(shouldClusterAtZoom(14)).toBe(true);
    expect(shouldClusterAtZoom(15)).toBe(true);
    expect(shouldClusterAtZoom(16)).toBe(false);
  });

  it('rejects invalid zoom values', () => {
    expect(shouldClusterAtZoom(Number.NaN)).toBe(false);
    expect(shouldClusterAtZoom(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('groups nearby vehicles into deterministic provider-aware cells', () => {
    const result = clusterVehicles([
      vehicle('lime-1', 'lime', 47.37690, 8.54170),
      vehicle('lime-2', 'lime', 47.37691, 8.54171),
      vehicle('voi-1', 'voi', 47.37692, 8.54172),
      vehicle('far-away', 'bird', 47.39, 8.57),
    ], 15);

    expect(result.vehicles.map(item => item.vehicle_id)).toEqual(['far-away']);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({
      count: 3,
      providers: { lime: 2, voi: 1 },
    });
    expect(result.clusters[0].id).toMatch(/^15:\d+:\d+$/);
    expect(result.clusters[0].lat).toBeCloseTo(47.37691);
    expect(result.clusters[0].lng).toBeCloseTo(8.54171);
  });

  it('returns raw vehicles above the clustering threshold', () => {
    const vehicles = [
      vehicle('lime-1', 'lime', 47.3769, 8.5417),
      vehicle('lime-2', 'lime', 47.37691, 8.54171),
    ];

    expect(clusterVehicles(vehicles, 16)).toEqual({ vehicles, clusters: [] });
  });
});
