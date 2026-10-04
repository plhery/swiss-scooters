import type { ScooterResponseMeta } from './types';

export function responseExpiry(meta: ScooterResponseMeta, receivedAt: number) {
  const generated = Date.parse(meta.generatedAt);
  const observedAt = Number.isFinite(generated) ? Math.min(receivedAt, generated) : receivedAt;
  const deadline = (value: string | undefined, fallback: number) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? Math.min(parsed, fallback) : fallback;
  };
  return {
    vehicles: deadline(meta.expiresAt, observedAt + (meta.overview ? 3 * 3600_000 : 300_000)),
    parking: deadline(meta.parkingExpiresAt, receivedAt + 300_000),
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
