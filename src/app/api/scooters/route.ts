import { NextRequest, NextResponse } from 'next/server';
import {
  fetchScooters,
  ScooterFeedsUnavailableError,
} from '@/lib/scooterFeeds';
import { rateLimitAllows } from '@/lib/rateLimit';
import { MAX_SCOOTER_RESULTS, parseScooterQuery } from '@/lib/scooterQuery';
import { clusterVehicles, shouldClusterAtZoom } from '@/lib/clustering';
import type { ScooterResponse } from '@/lib/types';

const MOBILITY_SOURCE =
  'Open data platform mobility Switzerland; Hopp GBFS; PubliBike Velospot public app feed';

export async function GET(request: NextRequest) {
  if (!await rateLimitAllows(request, 'SCOOTER_API_RATE_LIMITER')) {
    return NextResponse.json(
      { error: 'Too many scooter requests. Please try again shortly.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'private, no-store',
          'Retry-After': '60',
        },
      }
    );
  }

  const parsed = parseScooterQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    const result = await fetchScooters(parsed.query);
    const totalVehicles = result.vehicles.length;
    const clusterResponse = parsed.zoom !== null && shouldClusterAtZoom(parsed.zoom);
    const representation = clusterResponse
      ? clusterVehicles(result.vehicles, parsed.zoom as number)
      : { vehicles: result.vehicles, clusters: [] };
    const clusters = representation.clusters.slice(0, MAX_SCOOTER_RESULTS);
    const remainingVehicleSlots = Math.max(MAX_SCOOTER_RESULTS - clusters.length, 0);
    const vehicles = representation.vehicles.slice(0, remainingVehicleSlots);
    const truncated = (
      clusters.length < representation.clusters.length ||
      vehicles.length < representation.vehicles.length
    );
    const providers: Record<string, number> = {};
    for (const vehicle of result.vehicles) {
      providers[vehicle.provider] = (providers[vehicle.provider] ?? 0) + 1;
    }

    const degraded = result.meta.partial || result.meta.stale;
    const dataStatus = result.meta.partial
      ? 'partial'
      : result.meta.stale
        ? 'stale'
        : 'fresh';

    const body = {
        vehicles,
        clusters,
        providers,
        meta: {
          ...result.meta,
          generatedAt: new Date().toISOString(),
          truncated,
          totalVehicles,
          mode: clusterResponse ? 'clusters' : 'vehicles',
          zoom: parsed.zoom,
        },
      } satisfies ScooterResponse;

    return NextResponse.json(
      body,
      {
        headers: {
          'Cache-Control': degraded
            ? 'public, max-age=10, s-maxage=10, stale-while-revalidate=30'
            : 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
          'X-Mobility-Data-Source': MOBILITY_SOURCE,
          'X-Mobility-Data-Status': dataStatus,
        },
      }
    );
  } catch (error) {
    if (error instanceof ScooterFeedsUnavailableError) {
      return NextResponse.json(
        {
          error: 'Scooter data is temporarily unavailable. Please try again shortly.',
          meta: { failedSources: error.failedSources },
        },
        {
          status: 503,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '30',
            'X-Mobility-Data-Source': MOBILITY_SOURCE,
            'X-Mobility-Data-Status': 'unavailable',
          },
        }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'scooter_api_failure', message }));
    return NextResponse.json(
      { error: 'The scooter service encountered an unexpected error.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
