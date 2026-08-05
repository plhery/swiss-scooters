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
