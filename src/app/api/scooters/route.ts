import { NextRequest, NextResponse } from 'next/server';
import { fetchScooters } from '@/lib/scooterFeeds';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = Number.parseFloat(searchParams.get('lat') ?? '47.376');
  const lng = Number.parseFloat(searchParams.get('lng') ?? '8.528');
  const radius = Number.parseFloat(searchParams.get('radius') ?? '500');
  const minBattery = Number.parseInt(searchParams.get('minBattery') ?? '0', 10);
  const providerFilter = searchParams.get('provider')?.split(',').map(p => p.trim().toLowerCase());

  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    !Number.isFinite(radius) || radius <= 0 || radius > 20_000 ||
    !Number.isFinite(minBattery) || minBattery < 0 || minBattery > 100
  ) {
    return NextResponse.json({ error: 'Invalid scooter search parameters' }, { status: 400 });
  }

  const vehicles = await fetchScooters({
    lat,
    lng,
    radius,
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
