# Cloudflare deployment

Zurich Scooter is deployed as a full-stack Next.js application on Cloudflare
Workers using the OpenNext adapter. The homepage and browser assets are static;
`/api/geocode` and `/api/scooters` run as Worker route handlers.

## Prerequisites

- Node.js and npm
- A Cloudflare account on the Workers Free plan or higher
- Wrangler authenticated with `npx wrangler login`

The application does not require environment variables, API keys, a database,
or persistent storage.

## Validate locally

```bash
npm ci
npm audit
npm run lint
npm run build
npm run preview
```

The preview command builds the OpenNext bundle and serves it through the local
Cloudflare Workers runtime.

## Deploy

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
3. `/api/scooters?lat=47.3769&lng=8.5417&radius=500&minBattery=0` returns a JSON
   object with `vehicles` and `providers`.
4. The Cloudflare Worker logs contain no runtime errors.
