import type { TranslationKey } from '@/lib/i18n';
import { PROVIDERS, type Vehicle } from '@/lib/types';
import { walkingMinutes } from '@/lib/walking';

interface TipFormatter {
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatNumber: (value: number) => string;
}

/**
 * What a desktop shows over a scooter under the pointer: "Voi · 64% · 3 min".
 * The battery is left out when the feed does not give it, the walk when there
 * is neither a location nor a searched place to walk from.
 */
export function scooterTip(
  vehicle: Pick<Vehicle, 'provider' | 'battery'>,
  walkDistanceM: number | null,
  { t, formatNumber }: TipFormatter
): string {
  const name = PROVIDERS[vehicle.provider]?.name ?? vehicle.provider;
  const battery = vehicle.battery === null ? null : formatNumber(vehicle.battery);
  const minutes = walkDistanceM === null ? null : formatNumber(walkingMinutes(walkDistanceM));
  if (battery !== null && minutes !== null) return t('tip.scooter', { name, battery, minutes });
  if (battery !== null) return t('tip.scooter.battery', { name, battery });
  if (minutes !== null) return t('tip.scooter.walk', { name, minutes });
  return name;
}
