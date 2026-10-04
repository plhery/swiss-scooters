import type { AppLocale } from '@/lib/i18n';
import type { RidePricing } from '@/lib/types';

// The web counterpart of RidePriceEstimator in ios/SwissScooters/Models/ScooterModels.swift,
// without ride passes.

export const RIDE_DURATIONS = [5, 10, 15, 20, 30] as const;
export type RideDuration = (typeof RIDE_DURATIONS)[number];
export const DEFAULT_RIDE_DURATION: RideDuration = 10;
export const RIDE_DURATION_STORAGE_KEY = 'scooters-ride-minutes';

export function normalizeRideDuration(minutes: unknown): RideDuration {
  return RIDE_DURATIONS.find(allowed => allowed === minutes) ?? DEFAULT_RIDE_DURATION;
}

export interface RidePriceQuote {
  currency: string;
  durationMinutes: number;
  unlockFeeMinorUnits: number;
  minuteFeeMinorUnits: number;
  totalMinorUnits: number;
}

function wholeAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function ridePriceQuote(pricing: RidePricing, durationMinutes: number): RidePriceQuote {
  const minutes = wholeAmount(durationMinutes);
  const unlockFee = wholeAmount(pricing.unlock_fee_minor_units);
  const minuteFee = wholeAmount(pricing.minute_fee_minor_units);
  return {
    currency: pricing.currency,
    durationMinutes: minutes,
    unlockFeeMinorUnits: unlockFee,
    minuteFeeMinorUnits: minuteFee,
    // Saturates, as the Swift version does on overflow.
    totalMinorUnits: Math.min(unlockFee + minuteFee * minutes, Number.MAX_SAFE_INTEGER),
  };
}

/** "CHF 4.50" in the app's locale; minor units are hundredths, as on iOS. */
export function formatRidePrice(minorUnits: number, currency: string, locale: AppLocale): string {
  const amount = minorUnits / 100;
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(`${locale}-CH`, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Not a currency code Intl accepts.
    return `${code} ${amount.toFixed(2)}`;
  }
}

/** The duration chosen last on this device. */
export function loadRideDuration(): RideDuration {
  try {
    const stored = localStorage.getItem(RIDE_DURATION_STORAGE_KEY);
    return stored === null ? DEFAULT_RIDE_DURATION : normalizeRideDuration(Number(stored));
  } catch {
    return DEFAULT_RIDE_DURATION;
  }
}

export function saveRideDuration(minutes: number): RideDuration {
  const duration = normalizeRideDuration(minutes);
  try { localStorage.setItem(RIDE_DURATION_STORAGE_KEY, String(duration)); } catch {}
  return duration;
}
