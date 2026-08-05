export type TileLayerName = 'dark' | 'light' | 'osm';

export interface ClientParams {
  origin: [number, number] | null;
  minBattery: number | undefined;
  tileLayer: TileLayerName | undefined;
}

const TILE_LAYERS = new Set<TileLayerName>(['dark', 'light', 'osm']);
const BATTERY_STEP = 5;

function parseCoordinate(value: string | null): [number, number] | null {
  if (!value) return null;

  const parts = value.split(',').map(part => part.trim());
  if (parts.length !== 2 || parts.some(part => part === '')) return null;

  const [lat, lng] = parts.map(Number);
  if (
    !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    return null;
  }

  return [lat, lng];
}

function parseMinimumBattery(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  const clamped = Math.min(100, Math.max(0, parsed));
  return Math.round(clamped / BATTERY_STEP) * BATTERY_STEP;
}

function parseTileLayer(value: string | null): TileLayerName | undefined {
  return TILE_LAYERS.has(value as TileLayerName) ? value as TileLayerName : undefined;
}

export function parseClientParams(params: URLSearchParams): ClientParams {
  return {
    origin: parseCoordinate(params.get('origin')),
    minBattery: parseMinimumBattery(params.get('minBattery')),
    tileLayer: parseTileLayer(params.get('tile')),
  };
}

export function parseStoredClientParams(raw: string | null): ClientParams | null {
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as unknown;
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null;

    const record = stored as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const key of ['origin', 'minBattery', 'tile']) {
      if (typeof record[key] === 'string') params.set(key, record[key]);
    }

    const parsed = parseClientParams(params);
    return parsed.origin || parsed.minBattery !== undefined || parsed.tileLayer
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function serializeClientParams({
  origin,
  minBattery,
  tileLayer,
}: {
  origin: [number, number];
  minBattery: number;
  tileLayer: TileLayerName;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('origin', `${origin[0].toFixed(4)},${origin[1].toFixed(4)}`);
  if (minBattery !== 0) params.set('minBattery', String(minBattery));
  if (tileLayer !== 'light') params.set('tile', tileLayer);
  return params;
}
