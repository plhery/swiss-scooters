import { clusterVehicles, shouldClusterAtZoom } from '@/lib/clustering';
import { MAX_SCOOTER_RESULTS } from '@/lib/scooterQuery';
import type { ScooterFetchResult } from '@/lib/scooterFeeds';
import type { ScooterResponse, ScooterResponseMeta } from '@/lib/types';

export const MOBILITY_SOURCE =
  'Open data platform mobility Switzerland; Hopp GBFS; PubliBike Velospot public app feed; France: Dott, Bird, Lime, Voi, Pony GBFS (transport.data.gouv.fr); Lille parking: Metropole Europeenne de Lille';

export function scooterResponse(
  result: ScooterFetchResult,
  zoom: number | null,
  metadata: Partial<ScooterResponseMeta> = {},
): ScooterResponse {
  const clustered = zoom !== null && shouldClusterAtZoom(zoom);
  const representation = clustered
    ? clusterVehicles(result.vehicles, zoom)
    : { vehicles: result.vehicles, clusters: [] };
  const clusters = representation.clusters.slice(0, MAX_SCOOTER_RESULTS);
  const vehicles = representation.vehicles.slice(0, Math.max(MAX_SCOOTER_RESULTS - clusters.length, 0));
  const providers: Record<string, number> = {};
  for (const vehicle of result.vehicles) {
    providers[vehicle.provider] = (providers[vehicle.provider] ?? 0) + 1;
  }
  return {
    vehicles, clusters, providers,
    meta: {
      ...result.meta,
      generatedAt: new Date().toISOString(),
      truncated: clusters.length < representation.clusters.length || vehicles.length < representation.vehicles.length,
      totalVehicles: result.vehicles.length,
      mode: clustered ? 'clusters' : 'vehicles',
      zoom,
      ...metadata,
    },
  };
}

export function scooterResponseHeaders(body: ScooterResponse): Record<string, string> {
  const degraded = body.meta.partial || body.meta.stale;
  return {
    'Cache-Control': body.meta.overview
      ? 'public, max-age=300, s-maxage=300, stale-while-revalidate=300'
      : degraded
        ? 'public, max-age=10, s-maxage=10, stale-while-revalidate=30'
        : 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
    'X-Mobility-Data-Source': MOBILITY_SOURCE,
    'X-Mobility-Data-Status': body.meta.partial ? 'partial' : body.meta.stale ? 'stale' : 'fresh',
  };
}
