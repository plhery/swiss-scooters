# Cloudflare deployment

Scooters Switzerland is deployed as a full-stack Next.js application on Cloudflare
Workers using the OpenNext adapter. The homepage and browser assets are static;
`/api/geocode` and `/api/scooters` run as Worker route handlers.

**Production:** <https://zurich-scooter.plhery.com>

## Prerequisites

- Node.js and npm
- A Cloudflare account on the Workers Free plan or higher
- Wrangler authenticated with `npx wrangler login`

The application does not require secret API keys, a database, or persistent
storage. It identifies itself to the national GBFS 2.3 service with
`zurich-scooter@plhery.com`. Set the optional, non-secret
`SHAREDMOBILITY_AUTH_EMAIL` environment variable to use a different contact.

## Validate locally

```bash
npm ci
npm audit
npm run lint
npm test
npm run build
npm run preview
```

The preview command builds the OpenNext bundle and serves it through the local
Cloudflare Workers runtime.

## Continuous deployment

Cloudflare Workers Builds is connected to `plhery/zurich-scooter` with `main` as
the production branch. Every push to `main` runs:

```bash
npx opennextjs-cloudflare build
npx wrangler deploy
```

Builds for non-production branches are enabled and upload preview versions with
`npx wrangler versions upload`.

## Manual deployment

```bash
npm run deploy
```

Wrangler uses `wrangler.jsonc` and uploads the static assets plus the generated
`.open-next/worker.js` bundle. The generated `.open-next`, `.wrangler`, and
Cloudflare type files are intentionally ignored by Git.

## Verify

After deployment, confirm:

1. `/` renders the map and scooter controls.
2. `/api/geocode?q=Zurich%20HB` returns a JSON array.
3. `/api/scooters?lat=47.3769&lng=8.5417&south=47.36&west=8.52&north=47.39&east=8.57`
   returns a JSON object with `vehicles`, `providers`, and source-health `meta`.
4. An oversized bounding box returns `400`, and repeated excess API requests
   return `429` with `Retry-After`.
5. The Cloudflare Worker logs contain no runtime errors.
