# Privacy

Last updated: 5 August 2026

Swiss Scooters has no accounts, advertising, analytics SDK, or application
database. It does not intentionally retain precise user locations or address
searches.

- With permission, the app sends location coordinates and visible map bounds to
  its API to find nearby vehicles and calculate distance.
- Address text is proxied to the Swiss federal geo.admin.ch service.
- OpenStreetMap or CARTO receive normal tile requests from the user's device.
- Language, filters, map style, and the last origin are stored locally.
- Cloudflare hosts and protects the service. Persisted Worker invocation logs
  are disabled so full coordinate-bearing request URLs are not retained in the
  application's log stream.
- Structured application error logs contain event names and error messages, not
  precise locations or search text.

Cloudflare and upstream providers may process limited network or security
metadata under their own privacy policies. The full user-facing notice is
published at <https://swiss-scooters.plhery.com/privacy>.

Questions: `swiss-scooters@plhery.com`.
