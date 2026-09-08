# Cloudflare deployment

Scooters serves its Next.js website and geocoder on Cloudflare Workers
through OpenNext. The scooter API reads persistent snapshots from a small Node
service on Netcup, managed by Coolify; user map requests never fetch GBFS feeds.

- Canonical production host: <https://scooters.plhery.com>
- Legacy compatibility hosts: <https://swiss-scooters.plhery.com> and
  <https://zurich-scooter.plhery.com>

Both legacy hosts redirect browser pages to the canonical host while continuing
to serve `/api/*` for older native-app installations. Their `/sw.js` remains
available on the original origin: it replaces cached web apps with a migration
worker that clears old app caches and opens the new address.

## Requirements

- Node.js 26+
- npm
- A Cloudflare account
- Wrangler authenticated with `npx wrangler login`

The cache service uses a persistent `/data` volume. Production requires a shared
`SCOOTER_SNAPSHOT_API_TOKEN` (at least 32 characters) on the cache and Worker.
The cache refuses to start in production without it; the Worker fails closed if
its secret is absent. Store it as a Coolify environment secret and a Wrangler
encrypted secret, never in `wrangler.jsonc` or source control. No database is required. The optional
`SHAREDMOBILITY_AUTH_EMAIL` setting is a public contact identifier, not a
credential. Do not put actual credentials in Wrangler `vars`; use encrypted
Worker secrets if future features require them.

## Validate locally

```bash
npm ci
npm audit --audit-level=moderate
npm run check:providers
npm run check:api-contract
npm run lint
npm test
npm run cf-typegen
npm run build
npm run test:e2e
npm run preview
```

## Deploy

For the first release requiring authenticated origin access, use this order:

1. Generate a random service token (for example `openssl rand -hex 32`). Save the
   same value in the cache's Coolify environment as `SCOOTER_SNAPSHOT_API_TOKEN`
   and in the Worker using `npx wrangler secret put SCOOTER_SNAPSHOT_API_TOKEN`.
   Do not print or commit the token. Update the Coolify setting before redeploying
   the cache, but leave the existing container running until step 3.
2. Deploy the Worker with `npm run deploy`. It sends the token to the existing
   origin; this remains compatible with the previous cache release.
3. Deploy the cache. Its scooter API now requires the Worker credential. Normal
   requests to the public origin without it must return 401, while requests through
   `https://scooters.plhery.com/api/scooters` must succeed.
4. Check `/health` for collector liveness and `/ready` for usable live feeds.
   Alert on `/ready` failures and on `snapshot_health.expiredFeeds` or rising
   observation ages. Keep the container's restart health check on `/health` so
   operator outages do not cause a restart loop.

The origin also limits authenticated clients to 60 requests/minute and bounds
open API responses. The Worker overwrites the forwarded client IP using
Cloudflare's trusted header. Origin responses are private/no-store; only the
Worker publishes the public response cache policy.

After this one-time migration, keep both sides on the same secret during normal
releases. Update the secret on both sides before any planned rotation cutover.

OpenNext builds `.open-next/worker.js`; `worker.ts` applies the legacy-host
redirect, proxies `/api/scooters` to `SCOOTER_SNAPSHOT_API_URL`, and delegates
other requests to that generated Worker. Wrangler
uploads the bundle and static assets, creates the `scooters.plhery.com`
custom domain, and keeps both legacy hostnames attached to the same Worker.

The outer Worker applies the document CSP at the Cloudflare boundary. It creates
a fresh nonce for every HTML response and uses `HTMLRewriter` to attach it to
framework scripts and inline styles. This keeps the policy strict without a
Next.js Proxy, which OpenNext Cloudflare does not yet support. The service worker
normalizes nonce values when comparing app shells so nonce rotation does not
cause reload loops.

Production rate limiting is configured in `wrangler.jsonc`. The app fails closed
when a binding is missing or unavailable in production. Persisted invocation
logs are disabled because scooter and geocode URLs can contain precise
coordinates or address text; structured application error logs remain enabled.

## Cloudflare Workers Builds

The GitHub repository can remain connected to Cloudflare Workers Builds.
Use `main` as the production branch with:

```bash
npx opennextjs-cloudflare build
npx wrangler deploy
```

Use `npx wrangler versions upload` for non-production branch previews. After a
GitHub repository or Worker rename, verify the build connection in Cloudflare;
the repository is identified by GitHub internally, but the target Worker name
must remain `swiss-scooters`. This is the internal Worker identity; the public
app name and canonical domain are Scooters and `scooters.plhery.com`.

## Netcup scooter cache

- Coolify project: `wj03x2nl1vvq9pqdnj9a5177` (Swiss Scooters).
- Application: `mouc13tsnvylg0v9ee9wp5v5` (Scooter feed cache).
- Repository: `plhery/swiss-scooters`, branch `main`, Dockerfile `/server/Dockerfile`.
- Origin: `https://scooter-data.plhery.com`, container port 3001.
- Persistent named volume: `mouc13tsnvylg0v9ee9wp5v5-scooter-snapshots`, mounted at `/data`.
- Resource limits: 1 CPU, 1536 MiB. No host port is exposed.
- Coolify HTTP health check: `http://127.0.0.1:3001/health`, 15-second start
  period. Use the IPv4 address because the server binds to `0.0.0.0`.
- Netcup tunnel: `b1f36e92-77d5-4c92-846c-28848a492643`; exact hostname rule to
  `http://127.0.0.1:80`, routed by Coolify's proxy.

Deploy this application from Coolify after pushing a tested commit to `main`,
then wait for `/health` and `/ready` to return 200. For the initial origin-authentication
migration, follow the Worker-first sequence above.
Automatic deployment is disabled so backend and edge releases can be ordered.
Coolify remains the source of truth for the application, storage, and resource limits.

The collector schedules each feed independently at most once per minute with
six concurrent systems and at most two per host. A slow host cannot monopolize
collection slots. Vehicle results are published immediately, before optional
parking completes; disk writes and city overview rebuilding are batched every five seconds. Discovery/type/pricing metadata lasts an hour. Status feeds must carry a timestamp within five minutes; failed feeds retain
vehicles only until that observation expires. Cached metadata is reported as
degraded independently and does not prevent live vehicle timestamps advancing.
Both clients honor response expiry times, including parking expiry, during outages. Snapshots
are written atomically and restored after restarts. City totals are rebuilt
hourly, marked as an overview in the API, and rejected after three hours without
a replacement. Unknown battery values count only when no minimum is selected.

Zoom 0–10 returns one count per city; 11–15 returns spatial clusters; 16–22
returns individual scooters. Old clients understand the same `clusters` and
`vehicles` representations. Optional `city`, `overview`, `refreshAfterSeconds`,
and `availableProviders` fields enrich current clients.

Run the origin locally:

```bash
npx esbuild server/scooter-cache.ts --bundle --platform=node --format=esm --outfile=/tmp/scooter-cache.mjs
SCOOTER_SNAPSHOT_PATH=/tmp/scooters.json node /tmp/scooter-cache.mjs
curl http://localhost:3001/health
```

The public API has edge rate limiting. The cache server logs feed counts,
observation ages, and feed failures; it does not log map URLs, coordinates, or caller IPs.

## Public launch checklist

1. Confirm the new hostname renders without Cloudflare Access authentication.
2. Confirm the legacy homepage returns a `308` to the canonical hostname.
3. Confirm legacy `/api/scooters` and `/api/geocode` requests still work.
4. Verify valid scooter and address queries, bounds validation, `429` responses,
   and upstream outage behavior.
5. Test a fresh PWA install and an update from each legacy origin. Confirm the
   old app opens the canonical host and clears its `swiss-scooters-*` and
   `zurich-scooter-*` caches.
6. Test the native iOS app against the canonical endpoint.
7. Check only structured, non-location-bearing application errors are persisted.
8. Monitor latency, `429`, `5xx`, upstream failures, and Worker usage.
9. Verify the final security headers at the edge. Cloudflare zone-level HSTS
   settings override the application header; change them only after confirming
   every affected `plhery.com` hostname supports HTTPS.

Cloudflare Access should not protect the canonical hostname. Remove or narrow
any wildcard Access application only after the checks above pass. The GitHub
repository can remain private until the separate open-source publication gate.

## Rollback

Cloudflare retains Worker versions. Roll back the deployment through the
Cloudflare dashboard or Wrangler, then point all three custom domains at the last
known-good version. Do not remove the legacy hostname until installed native
clients have had a reasonable migration window.

For cache rollback, keep origin authentication enforced. Rolling the Worker back
to a version that does not send the token breaks API access; rolling the cache
back to a version that ignores it reopens the public origin. Prefer a tested
fix-forward or an earlier authenticated release. Keep `/data`.
The persisted snapshot format is versioned. Removing `SCOOTER_SNAPSHOT_API_URL`
restores the older direct-feed route, but also restores its broad-view Worker
subrequest limitation; prefer rolling back the cache image.

Parking is an optional field in the existing scooter response and snapshot
format; old clients and persisted snapshots remain readable. Deploy the cache
before the clients, then verify `/health` reports `parkingLocations > 0` and an
empty `failedParkingFeeds` list. A French request at zoom 16 includes `parking`
and `meta.parkingStatus`; zoom 15 and below omit individual parking locations.


The Germany/Italy catalog expands the collector to approximately 146 feeds.
Allocate 1536 MiB to the cache container (local validation peaked around 750 MiB).
The upstream cache holds 2048 documents to retain hourly metadata across minute
refreshes. The country catalogs are bundled into both the cache backend and the
Cloudflare web app; deploy the cache before the web app. City totals rebuild on
startup when the catalog adds/removes cities, even if the old hourly cache is fresh.

Dott requests are spaced by 150 ms during collection (below 400/minute), including
cold starts and hourly metadata refreshes. A full cold collection can take about
two minutes; persisted snapshots keep map requests independent of that work.
City overviews rebuild when previously failed feeds recover, avoiding an hour
of incomplete startup counts.
