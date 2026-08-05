# 🛴 Scooters on the Map — Switzerland

A mobile-friendly PWA showing shared e-scooters across Switzerland in the current map viewport.

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
- **Viewport-wide discovery** — pan or zoom anywhere and see every scooter in that map area
- **Rich GBFS 2.3 data** — nearby provider feeds preserve battery, range and rental links
- **Coverage-aware fetching** — only systems whose declared city or region intersects the viewport are loaded
- **Strict vehicle filtering** — excludes bikes, reserved vehicles and disabled vehicles
- **Resilient feed aggregation** — stale-on-error caching, source-health metadata, and explicit outage responses
- **Protected APIs** — bounded map queries, validation, response caps, and edge rate limits
- **Accurate provider chips** — counts always reflect the scooters currently visible on the map
- **Instant local filters** — provider and battery changes do not trigger network requests
- **PWA** — cached app shell for fast/offline launches, automatic refresh after deployments
- **Live location tracking** — moves the user marker continuously and recenters on request
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

The backend reads each system's GBFS discovery document instead of assuming
endpoint paths, rejects systems without individual electric-scooter data, and
uses provider regions plus conservative city envelopes before downloading live
vehicle status. Systems without trustworthy geographic metadata are checked
through sharedmobility.ch's spatial `identify` API. This avoids downloading all
Swiss provider feeds for a small map viewport while retaining battery, range,
and rental-link data from GBFS.

GBFS 2.3 requests identify this application with an email address, as required
by sharedmobility.ch. The default is `zurich-scooter@plhery.com`; override it
with the non-secret `SHAREDMOBILITY_AUTH_EMAIL` environment variable if needed.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Native iPhone app

The repository also contains a native iOS 26 app built with SwiftUI, MapKit,
Core Location, and system Liquid Glass controls. It reuses this deployment's
live scooter API and has no third-party dependencies or API keys.

Open [`ios/ZurichScooters.xcodeproj`](ios/ZurichScooters.xcodeproj) in Xcode 26
or newer, select a Personal Team under Signing & Capabilities, then run it on
your iPhone. See [`ios/README.md`](ios/README.md) for the short device setup and
native feature list.

## Deployment

The app deploys to Cloudflare Workers, with static assets served at the edge and
the Next.js route handlers running in the Workers runtime.

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

Returns scooters inside a geographic bounding box, sorted by distance from the supplied origin.

Query params:
- `lat`, `lng` — origin coordinates (default: Zurich center)
- `south`, `west`, `north`, `east` — map bounds
- `minBattery` — minimum battery % (default: 0)
- `provider` — comma-separated filter (e.g., `bolt,lime`)

Oversized bounds are rejected, and responses are capped at 5,000 vehicles.
The response includes source freshness and partial-outage metadata:

```text
{
  vehicles: Vehicle[],
  providers: Record<string, number>,
  meta: { partial, stale, failedSources, sources, generatedAt, truncated, totalVehicles }
}
```

If every relevant upstream feed is unavailable and no stale value remains, the
endpoint returns `503` instead of an empty success response.

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
│   ├── BottomSheet.tsx        # Draggable bottom sheet with counts & filters
│   ├── MapControls.tsx        # Floating locate / refresh buttons
│   ├── MapComponent.tsx       # Leaflet map (client-only)
│   └── MapWrapper.tsx         # Dynamic import wrapper (no SSR)
└── lib/
    ├── geo.ts                 # Haversine distance and viewport bounds helpers
    ├── feedCoverage.ts        # Provider-region and city coverage routing
    ├── scooterFeeds.ts        # Resilient national + direct GBFS aggregation
    ├── scooterQuery.ts        # API validation and request bounds
    ├── upstreamJsonCache.ts   # Fresh/stale feed cache and request coalescing
    └── types.ts               # Vehicle types, provider config
```
