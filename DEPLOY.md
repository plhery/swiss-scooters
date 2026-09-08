# Cloudflare deployment

Swiss Scooters serves its Next.js website and geocoder on Cloudflare Workers
through OpenNext. The scooter API reads persistent snapshots from a small Node
service on Netcup, managed by Coolify; user map requests never fetch GBFS feeds.

- Canonical production host: <https://swiss-scooters.plhery.com>
- Legacy compatibility host: <https://zurich-scooter.plhery.com>

The legacy host redirects browser pages to the canonical host while continuing
to serve `/api/*` for older native-app installations.

## Requirements

- Node.js 26+
- npm
- A Cloudflare account
- Wrangler authenticated with `npx wrangler login`

The cache service uses a persistent `/data` volume. No secret API key or database
is required. The optional
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

```bash
npm run deploy
```

OpenNext builds `.open-next/worker.js`; `worker.ts` applies the legacy-host
redirect, proxies `/api/scooters` to `SCOOTER_SNAPSHOT_API_URL`, and delegates
other requests to that generated Worker. Wrangler
uploads the bundle and static assets, creates the `swiss-scooters.plhery.com`
custom domain, and keeps the legacy hostname attached to the same Worker.

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
must be `swiss-scooters`.

## Netcup scooter cache

- Coolify project: `wj03x2nl1vvq9pqdnj9a5177` (Swiss Scooters).
- Application: `mouc13tsnvylg0v9ee9wp5v5` (Scooter feed cache).
- Repository: `plhery/swiss-scooters`, branch `main`, Dockerfile `/server/Dockerfile`.
- Origin: `https://scooter-data.plhery.com`, container port 3001.
- Persistent named volume: `mouc13tsnvylg0v9ee9wp5v5-scooter-snapshots`, mounted at `/data`.
- Resource limits: 1 CPU, 512 MB. No host port is exposed.
- Coolify HTTP health check: `http://127.0.0.1:3001/health`, 15-second start
  period. Use the IPv4 address because the server binds to `0.0.0.0`.
- Netcup tunnel: `b1f36e92-77d5-4c92-846c-28848a492643`; exact hostname rule to
  `http://127.0.0.1:80`, routed by Coolify's proxy.

Deploy this application from Coolify after pushing a tested commit to `main`,
then wait for `/health` to return 200 before deploying the Cloudflare Worker.
Automatic deployment is disabled so backend and edge releases can be ordered.
Coolify remains the source of truth for the application, storage, and resource limits.

The collector refreshes feeds every minute with six concurrent systems and no
overlapping cycles. Discovery/type/pricing metadata lasts an hour. Feed failures
retain vehicles for at most five minutes and mark responses degraded. Snapshots
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

The public API has edge rate limiting. The cache server logs refresh duration,
counts, and feed failures; it does not log map URLs, coordinates, or caller IPs.

## Public launch checklist

1. Confirm the new hostname renders without Cloudflare Access authentication.
2. Confirm the legacy homepage returns a `308` to the canonical hostname.
3. Confirm legacy `/api/scooters` and `/api/geocode` requests still work.
4. Verify valid scooter and address queries, bounds validation, `429` responses,
   and upstream outage behavior.
5. Test a fresh PWA install and confirm old `zurich-scooter-*` caches disappear.
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
Cloudflare dashboard or Wrangler, then point both custom domains at the last
known-good version. Do not remove the legacy hostname until installed native
clients have had a reasonable migration window.

For cache rollback, redeploy the previous commit in Coolify and keep `/data`.
The persisted snapshot format is versioned. Removing `SCOOTER_SNAPSHOT_API_URL`
restores the older direct-feed route, but also restores its broad-view Worker
subrequest limitation; prefer rolling back the cache image.
