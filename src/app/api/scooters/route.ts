import { NextRequest, NextResponse } from 'next/server';
import { fetchScooters } from '@/lib/scooterFeeds';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = Number.parseFloat(searchParams.get('lat') ?? '47.376');
  const lng = Number.parseFloat(searchParams.get('lng') ?? '8.528');
  const south = Number.parseFloat(searchParams.get('south') ?? '47.33');
  const west = Number.parseFloat(searchParams.get('west') ?? '8.45');
  const north = Number.parseFloat(searchParams.get('north') ?? '47.43');
  const east = Number.parseFloat(searchParams.get('east') ?? '8.62');
  const minBattery = Number.parseInt(searchParams.get('minBattery') ?? '0', 10);
  const providerFilter = searchParams.get('provider')?.split(',').map(p => p.trim().toLowerCase());

  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(south) || south < -90 || south > 90 ||
    !Number.isFinite(west) || west < -180 || west > 180 ||
    !Number.isFinite(north) || north < -90 || north > 90 ||
    !Number.isFinite(east) || east < -180 || east > 180 ||
    south >= north || west >= east ||
    !Number.isFinite(minBattery) || minBattery < 0 || minBattery > 100
  ) {
    return NextResponse.json({ error: 'Invalid scooter search parameters' }, { status: 400 });
  }

  const vehicles = await fetchScooters({
    lat,
    lng,
    bounds: { south, west, north, east },
    minBattery,
    providers: providerFilter ? new Set(providerFilter) : undefined,
  });

  const providers: Record<string, number> = {};
  for (const v of vehicles) {
    providers[v.provider] = (providers[v.provider] ?? 0) + 1;
  }

  return NextResponse.json(
    { vehicles, providers },
    {
      headers: {
        'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
        'X-Mobility-Data-Source': 'Swiss Federal Office of Energy sharedmobility.ch; Hopp',
      },
    }
  );
}
