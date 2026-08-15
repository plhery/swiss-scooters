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

## Address data

Search uses the federal `geo.admin.ch` SearchServer operated by swisstopo. Its
services are available without registration under FSDI fair-use and attribution
conditions. The app limits and caches requests and displays `© swisstopo`.

## Map tiles

- OpenStreetMap standard raster tiles are used only for interactive views, with
  visible contributor attribution, browser caching, and a valid referrer.
- CARTO basemaps use OpenStreetMap data and display both OSM and CARTO attribution.
- The service worker does not bulk-download or create offline tile archives.
