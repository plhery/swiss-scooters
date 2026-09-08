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
