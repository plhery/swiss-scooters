export const LIVE_DATA_MAX_AGE_MS = 5 * 60_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid feed object');
  return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid feed array');
  return value.map(object);
}

export function validateRegistry(value: unknown): void {
  for (const entry of records(object(value).systems)) {
    if (typeof entry.id !== 'string' || typeof entry.url !== 'string') throw new Error('Invalid registry entry');
  }
}

export function validateDiscovery(value: unknown): void {
  const data = object(object(value).data);
  const candidates = Array.isArray(data.feeds) ? [data] : Object.values(data);
  const feeds = candidates.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || !('feeds' in candidate)) return [];
    return records(candidate.feeds);
  });
  if (!feeds.length || feeds.some(entry => typeof entry.name !== 'string' || typeof entry.url !== 'string')) {
    throw new Error('Invalid discovery feeds');
  }
}

export function validateTypes(value: unknown): void {
  for (const type of records(object(object(value).data).vehicle_types)) {
    if (typeof type.vehicle_type_id !== 'string') throw new Error('Invalid vehicle type');
  }
}

export function statusObservedAt(value: unknown, now = Date.now()): number {
  const timestamp = object(value).last_updated;
  const updatedAt = typeof timestamp === 'number' ? timestamp * 1000
    : typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
  if (!Number.isFinite(updatedAt) || now - updatedAt > LIVE_DATA_MAX_AGE_MS || updatedAt - now > 300_000) {
    throw new Error('Status timestamp is missing or out of date');
  }
  return Math.min(now, updatedAt);
}

export function validateVehicleStatus(value: unknown): void {
  statusObservedAt(value);
  const data = object(object(value).data);
  records(data.bikes ?? data.vehicles);
}

export function validateStations(value: unknown): void {
  for (const station of records(object(object(value).data).stations)) {
    if (typeof station.station_id !== 'string') throw new Error('Invalid station ID');
  }
}

export function validateStationStatus(value: unknown): void {
  validateStations(value);
  statusObservedAt(value);
}
