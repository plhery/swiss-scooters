import { snapBatteryPreset, type BatteryPreset } from '@/lib/battery';

export type ThemeName = 'auto' | 'light' | 'dark';
export type MapStyleName = 'calm' | 'detailed';

export interface ClientParams {
  origin: [number, number] | null;
  minBattery: BatteryPreset | undefined;
  /** Undefined when nothing was chosen, which means automatic. */
  theme: ThemeName | undefined;
  /** Undefined when nothing was chosen, which means calm. */
  map: MapStyleName | undefined;
}

const THEMES = new Set<ThemeName>(['auto', 'light', 'dark']);
const MAP_STYLES = new Set<MapStyleName>(['calm', 'detailed']);

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

function parseMinimumBattery(value: string | null): BatteryPreset | undefined {
  if (value === null || value.trim() === '') return undefined;

  const parsed = Number(value);
  // Links and settings from the slider era hold any multiple of five.
  return Number.isFinite(parsed) ? snapBatteryPreset(parsed) : undefined;
}

// "tile" held the single map style setting before appearance and map detail were separate.
function parseTheme(value: string | null, legacyTile: string | null): ThemeName | undefined {
  if (THEMES.has(value as ThemeName)) return value as ThemeName;
  return legacyTile === 'dark' ? 'dark' : undefined;
}

function parseMapStyle(value: string | null, legacyTile: string | null): MapStyleName | undefined {
  if (MAP_STYLES.has(value as MapStyleName)) return value as MapStyleName;
  return legacyTile === 'osm' ? 'detailed' : undefined;
}

export function parseClientParams(params: URLSearchParams): ClientParams {
  const legacyTile = params.get('tile');
  return {
    origin: parseCoordinate(params.get('origin')),
    minBattery: parseMinimumBattery(params.get('minBattery')),
    theme: parseTheme(params.get('theme'), legacyTile),
    map: parseMapStyle(params.get('map'), legacyTile),
  };
}

export function parseStoredClientParams(raw: string | null): ClientParams | null {
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as unknown;
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null;

    const record = stored as Record<string, unknown>;
    const params = new URLSearchParams();
    // Origins from older releases are intentionally ignored. Preferences may
    // persist locally, but precise map/location coordinates should not.
    for (const key of ['minBattery', 'theme', 'map', 'tile']) {
      if (typeof record[key] === 'string') params.set(key, record[key]);
    }

    const parsed = parseClientParams(params);
    return parsed.minBattery !== undefined || parsed.theme || parsed.map
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function serializeClientParams({
  minBattery,
  theme,
  map,
}: {
  minBattery: number;
  theme: ThemeName;
  map: MapStyleName;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (minBattery !== 0) params.set('minBattery', String(minBattery));
  if (theme !== 'auto') params.set('theme', theme);
  if (map !== 'calm') params.set('map', map);
  return params;
}
