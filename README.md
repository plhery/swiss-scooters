# 🛴 Scooters Nearby — Zurich

A mobile-friendly PWA showing nearby e-scooters from 6 providers on an interactive map.

**Live:** [zurich-scooter.plhery.com](https://zurich-scooter.plhery.com)
— deployed on Cloudflare Workers via OpenNext

## Providers

| Provider | Color | Feed |
|----------|-------|------|
| Bolt | 🟢 Green | GBFS v3 via mobidata-bw |
| Bird | ⚫ Black | GBFS v2 via bird.co |
| Dott | 🟠 Orange | GBFS v2 via ridedott.com |
| Lime | 🟢 Lime | GBFS v2 via mobidata-bw |
| Voi | 🩷 Pink | GBFS v2 via mobidata-bw |
| Hopp | 🩵 Cyan | GBFS v2 via hopp.bike |

## Features

- **Interactive map** with Leaflet + OpenStreetMap / CARTO tiles (light, dark, OSM)
- **Geocoding** via Nominatim (address search for origin & destination)
- **Server-side GBFS fetching** — no CORS issues, API responses cached
- **Provider chips**, battery filter, search radius slider
- **Corridor mode** — set a destination to find scooters along your route
- **Auto-fit** map bounds to visible results
- **PWA** — installable with offline-capable home screen launch, persists last search
- **Location refresh on every load** — geolocates on launch, not just on demand
- **iPhone-first UI** — draggable glass bottom sheet, floating map buttons, safe-area support

## Tech Stack

- Next.js 16 (App Router)
- TypeScript (strict)
- Tailwind CSS v4
- react-leaflet + Leaflet
- Cloudflare Workers + OpenNext
- All GBFS feeds are free — no API keys needed

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment

The app deploys to Cloudflare Workers, with static assets served at the edge and
the two Next.js route handlers running in the Workers runtime.

Cloudflare Workers Builds is connected to this GitHub repository. Every push to
`main` builds and deploys production automatically; other branches produce
preview versions.

```bash
npm ci
npm run preview
npm run deploy
```

No environment variables or secrets are required. See [DEPLOY.md](DEPLOY.md) for
the deployment and verification checklist.

## API

### `GET /api/scooters`

Returns scooters near a point, sorted by distance.

Query params:
- `lat`, `lng` — origin coordinates (default: Zurich center)
- `radius` — search radius in meters (default: 500)
- `minBattery` — minimum battery % (default: 0)
- `provider` — comma-separated filter (e.g., `bolt,lime`)

Response: `{ vehicles: Vehicle[], providers: Record<string, number> }`

### `GET /api/geocode`

Geocodes an address via Nominatim, restricted to Switzerland.

Query params:
- `q` — address to search

Response: `Array<{ lat, lng, display_name }>`

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── geocode/route.ts   # Nominatim proxy
│   │   └── scooters/route.ts  # GBFS aggregator
│   ├── globals.css            # Tailwind + custom controls CSS
│   ├── layout.tsx             # Root layout, PWA meta
│   └── page.tsx               # Main page, state management
├── components/
│   ├── BottomSheet.tsx        # Draggable bottom sheet with search & filters
│   ├── MapControls.tsx        # Floating locate / refresh buttons
│   ├── MapComponent.tsx       # Leaflet map (client-only)
│   └── MapWrapper.tsx         # Dynamic import wrapper (no SSR)
└── lib/
    ├── geo.ts                 # Haversine distance, point-to-segment
    └── types.ts               # Vehicle types, provider config
```
