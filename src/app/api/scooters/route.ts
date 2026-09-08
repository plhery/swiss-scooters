import { NextRequest, NextResponse } from 'next/server';
import {
  fetchScooters,
  ScooterFeedsUnavailableError,
} from '@/lib/scooterFeeds';
import { rateLimitAllows } from '@/lib/rateLimit';
import { parseScooterQuery } from '@/lib/scooterQuery';
import { MOBILITY_SOURCE, scooterResponse, scooterResponseHeaders } from '@/lib/scooterResponse';

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
    const body = scooterResponse(result, parsed.zoom);
    return NextResponse.json(body, { headers: scooterResponseHeaders(body) });
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
