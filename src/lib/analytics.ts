// First-party, cookie-free Umami collection. Never accept arbitrary URLs or data.
export const ANALYTICS_ENDPOINT = 'https://u.plhery.com/api/send';
export const ANALYTICS_WEBSITE = '6e60b4ab-b4ee-4785-9699-a7f32127b358';
export const ANALYTICS_HOST = 'scooters.plhery.com';
export type AnalyticsEvent =
  | 'search_open' | 'search_close' | 'search_results' | 'search_error' | 'search_select' | 'search_clear'
  | 'filters_open' | 'settings_open' | 'panel_close' | 'provider_filter' | 'providers_all' | 'filters_reset'
  | 'battery_filter' | 'map_style' | 'language_change' | 'locate' | 'location_result' | 'browse_map'
  | 'vehicle_select' | 'vehicle_dismiss' | 'cluster_select' | 'parking_select' | 'directions_open' | 'rental_open'
  | 'map_zoom' | 'compass_reset' | 'refresh' | 'refresh_result' | 'data_error' | 'data_expired'
  | 'app_install' | 'app_open';
export interface AnalyticsData {
  provider?: string; enabled?: boolean; source?: 'quick' | 'filters';
  value?: number; count?: number; result?: string; style?: string;
  language?: string; target?: 'vehicle' | 'parking'; direction?: 'in' | 'out';
}
const keys = new Set(['provider', 'enabled', 'source', 'value', 'count', 'result', 'style', 'language', 'target', 'direction']);

export function safeAnalyticsData(data: AnalyticsData): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => keys.has(key) && (
    typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value))
  )));
}

export function analyticsEnabled(): boolean {
  if (typeof window === 'undefined' || window.location.hostname !== ANALYTICS_HOST) return false;
  if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return false;
  try { return !localStorage.getItem('umami.disabled'); } catch { return false; }
}

let cache: string | undefined;
let disabledByServer = false;
let pending = 0;
let chain = Promise.resolve();

export function track(event?: AnalyticsEvent, data: AnalyticsData = {}): void {
  if (!analyticsEnabled() || disabledByServer || pending >= 30) return;
  const platform = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone ? 'pwa' : 'web';
  const payload = {
    website: ANALYTICS_WEBSITE, hostname: ANALYTICS_HOST,
    // Only these two public screens exist. Exclude even unknown paths, all query strings and fragments.
    url: window.location.pathname === '/privacy' ? '/privacy' : '/',
    title: window.location.pathname === '/privacy' ? 'Privacy — Scooters' : 'Scooters',
    referrer: '', language: navigator.language, tag: platform,
    ...(event ? { name: event, data: { ...safeAnalyticsData(data), platform } } : {}),
  };
  pending++;
  chain = chain.then(async () => {
    if (!analyticsEnabled() || disabledByServer) return;
    const response = await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(cache ? { 'x-umami-cache': cache } : {}) },
      body: JSON.stringify({ type: 'event', payload }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (!result || typeof result !== 'object') return;
    if ('cache' in result && typeof result.cache === 'string') cache = result.cache;
    disabledByServer = 'disabled' in result && result.disabled === true;
  }).catch(() => { /* Analytics must never interrupt the map or navigation. */ }).finally(() => { pending--; });
}
