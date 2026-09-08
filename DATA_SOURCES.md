# Data sources and terms

Swiss Scooters does not own the mobility, address, or map data it displays.

## Mobility data

The main source is the [Open data platform mobility Switzerland shared
mobility dataset](https://data.opentransportdata.swiss/en/dataset/sharedmobility),
published by the Swiss Federal Office of Energy. Its terms permit processing,
analysis, and publication, require `opentransportdata.swiss` source citation,
and require raw data to be refreshed at its underlying cadence.

The app reads GBFS discovery documents instead of assuming endpoint paths,
requests only systems relevant to the visible area, filters for available
electric standing scooters, and keeps short-lived stale values for upstream
resilience.

Zürich's free-floating PubliBike / Velospot e-scooters are currently absent
from that national GBFS dataset. For Zürich only, the app supplements it with
the unauthenticated [`pbvsng/freeFloating` endpoint](https://velospot.info/customer/public/api/pbvsng/freeFloating)
used by the official PubliBike Velospot app. The endpoint returns an opaque
vehicle ID and location, but no battery level, range, or rental link. PubliBike
does not publish a redistribution license for this endpoint; its [API
documentation](https://api.publibike.ch/v1/static/api.html) directs license
questions to PubliBike. The response advertises a 500-request limit without
documenting the time window, so the app caches it for 30 seconds.

Provider names remain trademarks of their respective owners. Their appearance
does not imply endorsement.

### French cities

The app also reads 27 reviewed public GBFS feeds from Dott, Bird, Lime, Voi and
Pony across 25 French cities or operating areas. The catalog is checked into
[`data/french-scooter-feeds.json`](data/french-scooter-feeds.json), using the
[MobilityData registry](https://github.com/MobilityData/gbfs/blob/master/systems.csv)
and [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets?format=gbfs&subtype=scooter)
as discovery sources. Pony is accessed through the National Access Point's proxy;
the other feeds are served directly by their operators.

Production collects each system independently every minute on Netcup, with at
most six systems in flight. Map requests read only the relevant cached systems,
with no operator requests. The local direct-feed fallback selects by viewport
and allows four concurrent French systems. Individual vehicles expire after a
five-minute stale-on-error window; city totals are aggregated hourly. French feed timestamps older than five minutes
are marked stale; timestamps older than fifteen minutes are rejected.

These endpoints are publicly accessible but do not share one universal license.
In particular, [Dott's API terms](https://ridedott.com/api-licence/) contain
development and commercial/distribution restrictions that need review before
public deployment. See the [investigation and source terms](docs/french-scooter-feeds.md)
for the verified cities, sample counts, excluded feeds, and recheck command.

## Address data

Search uses the federal `geo.admin.ch` SearchServer operated by swisstopo. Its
services are available without registration under FSDI fair-use and attribution
conditions. The app limits and caches requests and displays `© swisstopo`.
Supported French city names are supplied by the local, reviewed scooter-city
catalog. French street-address geocoding is not provided.

## Map tiles

- OpenStreetMap standard raster tiles are used only for interactive views, with
  visible contributor attribution, browser caching, and a valid referrer.
- Light and dark themes style the same OpenStreetMap tiles locally, reusing the
  browser cache. The previous unauthenticated CARTO tiles now require an API key.
- Zooms above 19 scale the last native tile level without requesting unavailable tiles.
- The service worker does not bulk-download or create offline tile archives.
