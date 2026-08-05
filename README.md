# Swiss Scooters

A mobile-friendly map of shared e-scooters across Switzerland. Swiss Scooters
combines the national shared-mobility feed with an accessible map, live
location, address search, provider filters, and installable web and iPhone apps.

**Live:** [swiss-scooters.plhery.com](https://swiss-scooters.plhery.com)

## Features

- Interactive Leaflet map with light, dark, and OpenStreetMap layers
- Viewport-aware national scooter discovery
- Battery, range, distance, and provider rental links when supplied upstream
- Coverage-aware fetching and resilient stale-on-error caches
- Provider and minimum-battery filters that run locally
- Swiss address search powered by the federal geo.admin.ch service
- German, French, Italian, and English interfaces
- Installable PWA with automatic post-deployment refreshes
- Native SwiftUI and MapKit app for iOS 26+
- No accounts, advertisements, analytics SDK, application database, or secret API keys

## Providers

Swiss Scooters displays electric scooters published through the national
shared-mobility dataset. Supported provider families currently include Bolt,
Bird, Dott, Lime, Voi, and PubliBike / Velospot. Actual availability depends on
what each operator publishes for the visible area.

## Data and attribution

Mobility data comes from the Swiss Federal Office of Energy dataset published
through the [Open data platform mobility Switzerland](https://data.opentransportdata.swiss/en/dataset/sharedmobility).
Address search uses [geo.admin.ch](https://www.geo.admin.ch/) data and services
operated by swisstopo. Map tiles come from OpenStreetMap or CARTO.

The application cites these sources in the map and follows their update,
attribution, caching, and fair-use requirements. See [DATA_SOURCES.md](DATA_SOURCES.md)
for the source-by-source notes.

## Local development

Requirements:

- Node.js 26+
- npm

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No environment variables
are required. The optional, non-secret `SHAREDMOBILITY_AUTH_EMAIL` value changes
the contact address sent to the national GBFS service; copy `.env.example` if
you need to override it.

## Validation

```bash
npm audit
npm run lint
npm test
npm run build
npm run test:e2e
```

CI also builds the Cloudflare artifact and runs the native iOS unit tests.

## API

### `GET /api/scooters`

Returns electric scooters inside a geographic bounding box, sorted by distance
from the supplied origin.

- `lat`, `lng`: distance origin; defaults to central Zurich
- `south`, `west`, `north`, `east`: visible map bounds
- `minBattery`: minimum battery percentage; defaults to `0`
- `provider`: comma-separated provider keys

Bounds are validated and responses are capped at 5,000 vehicles. The response
includes cache freshness, upstream health, and truncation metadata.

### `GET /api/geocode`

Returns up to five Swiss location suggestions from geo.admin.ch.

- `q`: search text between 2 and 160 characters
- `lang`: `de`, `fr`, `it`, or `en`

Both endpoints are same-origin, cached where appropriate, and protected by
Cloudflare rate-limit bindings in production.

## Architecture

```text
src/
├── app/
│   ├── api/geocode/       # geo.admin.ch proxy
│   ├── api/scooters/      # national GBFS aggregation API
│   ├── privacy/           # user-facing privacy notice
│   └── page.tsx           # web application state
├── components/            # map, controls, address search, bottom sheet
└── lib/                   # feeds, coverage, caching, validation, i18n
ios/
├── SwissScooters/         # SwiftUI application
└── SwissScootersTests/    # native unit tests
worker.ts                   # Cloudflare host migration wrapper
```

The web app is Next.js 16 running on Cloudflare Workers through OpenNext.
Upstream discovery and vehicle feeds are coalesced and cached inside warm Worker
instances; no persistent storage is used.
The small Worker wrapper redirects browser traffic from the legacy hostname
before delegating to the generated OpenNext Worker, while preserving legacy
`/api/*` routes for installed native clients.

## Native iPhone app

Open `ios/SwissScooters.xcodeproj` in Xcode 26 or newer, select a Personal Team,
and run the `SwissScooters` scheme. The existing bundle identifier is retained
so renamed builds install over earlier local versions. See [ios/README.md](ios/README.md).

## Deployment

Cloudflare deployment and hostname migration instructions are in
[DEPLOY.md](DEPLOY.md).

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request. Please report vulnerabilities privately using
[SECURITY.md](SECURITY.md), not a public issue.

The application privacy notice is available at `/privacy` and in
[PRIVACY.md](PRIVACY.md).

## License

Swiss Scooters is available under the [MIT License](LICENSE). Data, map tiles,
provider names, and third-party dependencies remain subject to their respective
terms and licenses.
