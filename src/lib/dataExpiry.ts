import type { ScooterResponseMeta } from './types';
import { PARKING_MAX_AGE_MS, VEHICLE_MAX_AGE_MS } from './dataFreshness';

/**
 * How far the clock of this device is ahead of the server's (negative when it
 * is behind), from the Date header of a response and the moment it arrived. 0
 * when the header is missing. The header counts whole seconds and the response
 * took a moment to arrive, so a right clock gives a second or two, not 0.
 */
export function clockOffset(dateHeader: string | null, receivedAt: number): number {
  const sent = dateHeader ? Date.parse(dateHeader) : NaN;
  return Number.isFinite(sent) ? receivedAt - sent : 0;
}

/** A time the server wrote, on the clock of this device. NaN when it cannot be read. */
export function deviceTime(value: string | undefined, clockOffsetMs: number): number {
  return (value ? Date.parse(value) : NaN) + clockOffsetMs;
}

/**
 * When the response expires, on the clock of this device. The server's times
 * are moved by clockOffsetMs first: a clock that is minutes fast would
 * otherwise find every response expired on arrival.
 */
export function responseExpiry(meta: ScooterResponseMeta, receivedAt: number, clockOffsetMs = 0) {
  const generated = deviceTime(meta.generatedAt, clockOffsetMs);
  const observedAt = Number.isFinite(generated) ? Math.min(receivedAt, generated) : receivedAt;
  const deadline = (value: string | undefined, fallback: number) => {
    const parsed = deviceTime(value, clockOffsetMs);
    return Number.isFinite(parsed) ? Math.min(parsed, fallback) : fallback;
  };
  return {
    vehicles: deadline(meta.expiresAt, observedAt + (meta.overview ? 3 * 3600_000 : VEHICLE_MAX_AGE_MS)),
    parking: deadline(meta.parkingExpiresAt, receivedAt + PARKING_MAX_AGE_MS),
  };
}

export function isExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && now >= expiresAt;
}

export type FailedRequestOutcome = 'no-data' | 'keep' | 'out-of-date';

/**
 * What a failed request does to the scooters on screen. Expiry alone never
 * removes them: a healthy response can arrive seconds before its expiresAt, so
 * they go only once a request made after that moment has failed as well.
 */
export function failedRequestOutcome(
  state: { hasData: boolean; expiresAt: number | null },
  now: number
): FailedRequestOutcome {
  if (!state.hasData) return 'no-data';
  return isExpired(state.expiresAt, now) ? 'out-of-date' : 'keep';
}
