import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../data/french-scooter-feeds.json', import.meta.url), 'utf8'));
const results = [];
const headers = { Accept: 'application/json', 'User-Agent': 'swiss-scooters/2.0 (swiss-scooters.plhery.com)' };

async function json(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${new URL(url).pathname}`);
  return response.json();
}

function feedUrl(entries, names, discoveryUrl) {
  const base = new URL('.', discoveryUrl);
  const entry = names.map(name => entries.find(entry => entry.name === name)).find(Boolean);
  if (!entry) throw new Error(`Missing ${names.join('/')} feed`);
  const url = new URL(entry.url);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`Feed URL outside reviewed city base: ${url.origin}${url.pathname}`);
  }
  return url;
}

async function inspect(system) {
  const result = { system: system.id, city: system.city, provider: system.provider, discoveryUrl: system.discoveryUrl };
  try {
    const discovery = await json(system.discoveryUrl);
    const data = discovery.data;
    const entries = data?.feeds ?? Object.values(data ?? {}).find(value => Array.isArray(value?.feeds))?.feeds;
    if (!Array.isArray(entries)) throw new Error('Invalid GBFS discovery');
    const [types, status] = await Promise.all([
      json(feedUrl(entries, ['vehicle_types'], system.discoveryUrl)),
      json(feedUrl(entries, ['vehicle_status', 'free_bike_status'], system.discoveryUrl)),
    ]);
    const scooters = new Set(types.data.vehicle_types.filter(type => (
      ['scooter', 'scooter_standing'].includes(type.form_factor) && type.propulsion_type === 'electric'
    )).map(type => type.vehicle_type_id));
    const vehicles = status.data?.vehicles ?? status.data?.bikes;
    if (!Array.isArray(vehicles)) throw new Error('Missing vehicle array');
    const updatedAt = typeof status.last_updated === 'number' ? status.last_updated * 1000 : Date.parse(status.last_updated);
    const ageSeconds = Math.round((Date.now() - updatedAt) / 1000);
    if (!Number.isFinite(updatedAt) || ageSeconds > 900 || ageSeconds < -300) throw new Error('Status timestamp missing or out of date');
    const available = vehicles.filter(vehicle => (
      scooters.has(vehicle.vehicle_type_id) && !vehicle.is_reserved && !vehicle.is_disabled &&
      Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lon) &&
      vehicle.lat >= system.bounds.south && vehicle.lat <= system.bounds.north &&
      vehicle.lon >= system.bounds.west && vehicle.lon <= system.bounds.east
    ));
    return {
      ...result, version: discovery.version, availableScooters: available.length,
      withBattery: available.filter(vehicle => Number.isFinite(vehicle.current_fuel_percent)).length,
      withRange: available.filter(vehicle => Number.isFinite(vehicle.current_range_meters)).length,
      withRentalLink: available.filter(vehicle => vehicle.rental_uris?.ios || vehicle.rental_uris?.android || vehicle.rental_uris?.web).length,
      updatedAt: new Date(updatedAt).toISOString(), ageSeconds,
    };
  } catch (error) {
    return { ...result, error: error.message };
  }
}

let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < catalog.systems.length) results.push(await inspect(catalog.systems[next++]));
}));
results.sort((a, b) => a.system.localeCompare(b.system));
const report = {
  checkedAt: new Date().toISOString(),
  systems: results,
  totalAvailableScooters: results.reduce((total, result) => total + (result.availableScooters ?? 0), 0),
  failures: results.filter(result => result.error).length,
};
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.table(results.map(({ system, city, version, availableScooters, withBattery, withRange, ageSeconds, error }) => (
    { system, city, version, availableScooters, withBattery, withRange, ageSeconds, error }
  )));
  console.log(`${report.totalAvailableScooters} available scooters; ${report.failures} failed feeds. Checked ${report.checkedAt}.`);
}
if (report.failures > 0) process.exitCode = 1;
