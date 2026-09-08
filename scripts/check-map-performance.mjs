// Public city coordinates; never use saved user positions in a performance log.
const base = process.env.SWISS_SCOOTERS_BASE_URL ?? 'https://swiss-scooters.plhery.com';
const cases = [
  ['Europe overview', { south: 40, west: -5, north: 56, east: 16, zoom: 5 }],
  ['Lyon clusters', { south: 45.72, west: 4.79, north: 45.8, east: 4.9, zoom: 13 }],
  ['Lyon street', { south: 45.748, west: 4.83, north: 45.764, east: 4.85, zoom: 16 }],
  ['Marseille', { south: 43.2, west: 5.3, north: 43.4, east: 5.5, zoom: 13 }],
  ['Berlin overview', { south: 52.3, north: 52.7, west: 13.0, east: 13.8, zoom: 9 }],
  ['Berlin street', { south: 52.51, north: 52.53, west: 13.39, east: 13.42, zoom: 16 }],
  ['Rome street', { south: 41.89, north: 41.92, west: 12.48, east: 12.51, zoom: 16 }],
  ['Empty German countryside', { south: 51.1, north: 51.11, west: 9.8, east: 9.81, zoom: 15 }],
  ['Empty Italian countryside', { south: 43.5, north: 43.51, west: 12.2, east: 12.21, zoom: 15 }],
  ['Zurich', { south: 47.36, west: 8.52, north: 47.39, east: 8.57, zoom: 16 }],
  ['Empty French countryside', { south: 43, west: 1, north: 43.1, east: 1.1, zoom: 15 }],
  ['Empty Swiss countryside', { south: 46.58, west: 8.65, north: 46.64, east: 8.75, zoom: 14 }],
];
for (const [name, query] of cases) {
  const measurements = [];
  let body;
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    const response = await fetch(new URL(`/api/scooters?${new URLSearchParams(query)}`, base), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    body = await response.json();
    measurements.push(Math.round(performance.now() - started));
  }
  if (name.startsWith('Empty') && body.meta.totalVehicles !== 0) throw new Error(`${name}: expected no scooters`);
  if ((name.startsWith('Lyon') || name === 'Marseille' || name.startsWith('Berlin') || name.startsWith('Rome')) && ['national', 'hopp', 'publibike'].some(key => body.meta.sources[key] !== 'skipped')) {
    throw new Error(`${name}: Swiss source involved in a foreign view`);
  }
  console.log(JSON.stringify({ name, latencyMs: measurements, vehicles: body.meta.totalVehicles,
    markers: body.vehicles.length + body.clusters.length, overview: body.meta.overview ?? false,
    partial: body.meta.partial, stale: body.meta.stale }));
}
