import type { ScooterResponse } from '@/lib/types';

interface DataHealthMessages {
  cached: string;
  overview?: string;
  parkingUnavailable?: string;
  parkingStale?: string;
  partial: string;
  truncated: (shown: number, total: number) => string;
}

const DEFAULT_MESSAGES: DataHealthMessages = {
  cached: 'Showing cached data',
  overview: 'City totals · refreshed hourly',
  parkingUnavailable: 'Parking data is temporarily unavailable',
  parkingStale: 'Parking data may be out of date',
  partial: 'Some providers unavailable',
  truncated: (shown, total) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} results`,
};

export function scooterDataHealthNotice(
  meta: ScooterResponse['meta'] | null | undefined,
  returnedVehicleCount: number,
  messages: DataHealthMessages = DEFAULT_MESSAGES
): string | null {
  if (!meta) return null;

  const notices: string[] = [];
  if (meta.overview) notices.push(messages.overview ?? DEFAULT_MESSAGES.overview!);
  if (meta.stale) notices.push(messages.cached);
  if (meta.partial) notices.push(messages.partial);
  if (meta.parkingStatus === 'failed' || meta.parkingStatus === 'partial') notices.push(messages.parkingUnavailable ?? DEFAULT_MESSAGES.parkingUnavailable!);
  else if (meta.parkingStatus === 'stale') notices.push(messages.parkingStale ?? DEFAULT_MESSAGES.parkingStale!);
  if (meta.truncated) {
    notices.push(messages.truncated(returnedVehicleCount, meta.totalVehicles));
  }

  return notices.length > 0 ? notices.join(' · ') : null;
}
