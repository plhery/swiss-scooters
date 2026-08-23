# Privacy

Last updated: 23 August 2026

Swiss Scooters has no accounts, advertising, analytics SDK, or application
database. It does not intentionally retain precise user locations or address
searches.

- With permission, the app uses location coordinates on the device to focus the
  map and calculate distance. Its API receives the visible map bounds needed to
  find vehicles, not a separate user-location coordinate.
- Address text is proxied in a non-cacheable request body to the Swiss federal
  geo.admin.ch service.
- OpenStreetMap or CARTO receive normal tile requests from the user's device.
- Language, filters, and map style are stored locally. Precise map origins are
  not persisted.
- Cloudflare hosts and protects the service. Persisted Worker invocation logs
  are disabled so full coordinate-bearing request URLs are not retained in the
  application's log stream.
- Structured application error logs contain event names and error messages, not
  precise locations or search text.

Cloudflare and upstream providers may process limited network or security
metadata under their own privacy policies. The full user-facing notice is
published at <https://swiss-scooters.plhery.com/privacy>.

Questions: `swiss-scooters@plhery.com`.
