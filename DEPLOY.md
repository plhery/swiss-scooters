# Cloudflare deployment

Swiss Scooters is a full-stack Next.js application deployed to Cloudflare
Workers through OpenNext.

- Canonical production host: <https://swiss-scooters.plhery.com>
- Legacy compatibility host: <https://zurich-scooter.plhery.com>

The legacy host redirects browser pages to the canonical host while continuing
to serve `/api/*` for older native-app installations.

## Requirements

- Node.js 26+
- npm
- A Cloudflare account
- Wrangler authenticated with `npx wrangler login`

No secret API key, database, or persistent storage is required. The optional
`SHAREDMOBILITY_AUTH_EMAIL` setting is a public contact identifier, not a
credential. Do not put actual credentials in Wrangler `vars`; use encrypted
Worker secrets if future features require them.

## Validate locally

```bash
npm ci
npm audit --audit-level=moderate
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
redirect and delegates all other requests to that generated Worker. Wrangler
uploads the bundle and static assets, creates the `swiss-scooters.plhery.com`
custom domain, and keeps the legacy hostname attached to the same Worker.

Production rate limiting is configured in `wrangler.jsonc`. The app fails closed
when a binding is missing or unavailable in production. Persisted invocation
logs are disabled because scooter and geocode URLs can contain precise
coordinates or address text; structured application error logs remain enabled.

## Cloudflare Workers Builds

The private GitHub repository can remain connected to Cloudflare Workers Builds.
Use `main` as the production branch with:

```bash
npx opennextjs-cloudflare build
npx wrangler deploy
```

Use `npx wrangler versions upload` for non-production branch previews. After a
GitHub repository or Worker rename, verify the build connection in Cloudflare;
the repository is identified by GitHub internally, but the target Worker name
must be `swiss-scooters`.

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
