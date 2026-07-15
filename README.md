# 🛴 Scooters Nearby — Switzerland

A mobile-friendly PWA showing nearby shared e-scooters across Switzerland on an interactive map.

**Live:** [zurich-scooter.plhery.com](https://zurich-scooter.plhery.com)
— deployed on Cloudflare Workers via OpenNext

## Providers

| Provider | Color | Feed |
|----------|-------|------|
| Bolt | 🟢 Green | Swiss national GBFS 2.3 |
| Bird | ⚫ Black | Swiss national GBFS 2.3 |
| Dott | 🟠 Orange | Swiss national GBFS 2.3 |
| Lime | 🟢 Lime | Swiss national GBFS 2.3 |
| Voi | 🩷 Pink | Swiss national GBFS 2.3 |
| PubliBike / Velospot | 🟣 Purple | Swiss national GBFS 2.3 |
| Hopp | 🩵 Cyan | Direct GBFS v2 fallback |

## Features

- **Interactive map** with Leaflet + OpenStreetMap / CARTO tiles (light, dark, OSM)
- **Geocoding** via Nominatim (destination search across Switzerland)
- **Switzerland-wide discovery** — nearby systems come from the national sharedmobility.ch snapshot
- **Rich GBFS 2.3 data** — nearby provider feeds preserve battery, range and rental links
- **Strict vehicle filtering** — excludes bikes, reserved vehicles and disabled vehicles
- **Server-side GBFS fetching** — no CORS issues, API responses and upstream feeds are cached
- **Provider chips**, battery filter, search radius slider
- **Corridor mode** — set a destination to find scooters along your route
- **Auto-fit** map bounds to visible results
- **PWA** — cached app shell for fast/offline launches, automatic refresh after deployments
- **Live location tracking** — moves the user marker continuously and refreshes scooters after meaningful movement
- **iPhone-first UI** — draggable glass bottom sheet, floating map buttons, safe-area support

## Tech Stack

- Next.js 16 (App Router)
- TypeScript (strict)
- Tailwind CSS v4
- react-leaflet + Leaflet
- Cloudflare Workers + OpenNext
- All GBFS feeds are free — no secret API keys needed

## Mobility data

The backend uses the Swiss Federal Office of Energy's
[Shared Mobility dataset](https://data.opentransportdata.swiss/dataset/sharedmobility)
for national discovery and provider-specific GBFS 2.3 feeds. Hopp remains a
direct feed because it is not currently included in the national dataset.

GBFS 2.3 requests identify this application with an email address, as required
by sharedmobility.ch. The default is `zurich-scooter@plhery.com`; override it
with the non-secret `SHAREDMOBILITY_AUTH_EMAIL` environment variable if needed.

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

No environment variables or secrets are required; the contact email used for
GBFS identification can be overridden. See [DEPLOY.md](DEPLOY.md) for the
deployment and verification checklist.

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
│   │   └── scooters/route.ts  # Scooter API
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
    ├── scooterFeeds.ts        # National discovery + rich GBFS aggregation
    └── types.ts               # Vehicle types, provider config
```
