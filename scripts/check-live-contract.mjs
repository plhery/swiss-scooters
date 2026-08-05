const baseUrl = process.env.SWISS_SCOOTERS_BASE_URL ?? 'https://swiss-scooters.plhery.com';
const query = new URLSearchParams({
  south: '47.36',
  west: '8.52',
  north: '47.39',
  east: '8.57',
});
const url = new URL(`/api/scooters?${query}`, baseUrl);
const response = await fetch(url, {
  headers: { Accept: 'application/json' },
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(`Live scooter API returned HTTP ${response.status}`);
}

const body = await response.json();
if (
  !body ||
  !Array.isArray(body.vehicles) ||
  !Array.isArray(body.clusters) ||
  !body.providers ||
  typeof body.providers !== 'object' ||
  !body.meta ||
  typeof body.meta !== 'object'
) {
  throw new Error('Live scooter API response does not match the expected envelope');
}
if (typeof body.meta.partial !== 'boolean' || typeof body.meta.stale !== 'boolean') {
  throw new Error('Live scooter API health metadata is missing');
}
if (!Array.isArray(body.meta.failedSources)) {
  throw new Error('Live scooter API failedSources must be an array');
}
if (!['vehicles', 'clusters'].includes(body.meta.mode)) {
  throw new Error('Live scooter API mode is invalid');
}
if (body.meta.zoom !== null && !Number.isInteger(body.meta.zoom)) {
  throw new Error('Live scooter API zoom is invalid');
}

for (const [index, vehicle] of body.vehicles.entries()) {
  if (
    !vehicle ||
    typeof vehicle.provider !== 'string' ||
    typeof vehicle.lat !== 'number' ||
    typeof vehicle.lng !== 'number' ||
    vehicle.lat < -90 || vehicle.lat > 90 ||
    vehicle.lng < -180 || vehicle.lng > 180 ||
    !('battery' in vehicle) ||
    !('range_m' in vehicle)
  ) {
    throw new Error(`Live scooter API vehicle ${index} is invalid`);
  }
  if (vehicle.distance_m !== null && typeof vehicle.distance_m !== 'number') {
    throw new Error(`Live scooter API vehicle ${index} has an invalid distance_m`);
  }
}

for (const [index, cluster] of body.clusters.entries()) {
  if (
    !cluster ||
    typeof cluster.id !== 'string' ||
    typeof cluster.lat !== 'number' ||
    typeof cluster.lng !== 'number' ||
    !Number.isInteger(cluster.count) ||
    cluster.count < 2 ||
    !cluster.providers ||
    typeof cluster.providers !== 'object'
  ) {
    throw new Error(`Live scooter API cluster ${index} is invalid`);
  }
}

console.log(`Live contract valid: ${body.vehicles.length} vehicles, ${body.clusters.length} clusters, partial=${body.meta.partial}, stale=${body.meta.stale}`);
