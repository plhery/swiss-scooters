import type { ScooterResponse } from '@/lib/types';

export function scooterDataHealthNotice(
  meta: ScooterResponse['meta'] | null | undefined,
  returnedVehicleCount: number
): string | null {
  if (!meta) return null;

  const notices: string[] = [];
  if (meta.stale) notices.push('Showing cached data');
  if (meta.partial) notices.push('Some providers unavailable');
  if (meta.truncated) {
    notices.push(
      `Showing ${returnedVehicleCount.toLocaleString()} of ${meta.totalVehicles.toLocaleString()} results`
    );
  }

  return notices.length > 0 ? notices.join(' · ') : null;
}
