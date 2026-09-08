# Privacy

Last updated: 8 September 2026

Scooters has no accounts or advertising. It does not intentionally retain precise user locations or address
searches.

- With permission, the app uses location coordinates on the device to focus the
  map and calculate distance. Its API receives the visible map bounds needed to
  find vehicles, not a separate user-location coordinate.
- Address text is proxied in a non-cacheable request body to the Swiss federal
  geo.admin.ch service.
- OpenStreetMap receives normal tile requests from the user's device, with the website origin as the referrer (no page path or query string).
- Language, filters, and map style are stored locally. Precise map origins are
  not persisted.
- Cloudflare hosts and protects the service. Persisted Worker invocation logs
  are disabled so full coordinate-bearing request URLs are not retained in the
  application's log stream.
- Structured application error logs contain event names and error messages, not
  precise locations or search text.

Cloudflare and upstream providers may process limited network or security
metadata under their own privacy policies. The full user-facing notice is
published at <https://scooters.plhery.com/privacy>.

Questions: `swiss-scooters@plhery.com`.

## Usage analytics

The public web/PWA and native iOS app send page/screen views and named actions
(search result counts, filters, selections, directions/rental taps, preferences,
and generic failures) to our self-hosted Umami at `u.plhery.com`. Platform tags
separate web, PWA and iOS. We do not collect search text, precise coordinates,
vehicle IDs, URL queries/fragments, advertising IDs, or session recordings.
Umami processes IP/user-agent information to derive approximate geography,
device information and short-lived sessions; it does not store raw IPs. No
analytics cookies or persistent user IDs are used. Session cache stays in memory.
Disable analytics on the web privacy page or in native Settings. Web collection
also respects Do Not Track and Global Privacy Control. Development/preview web
hosts and iOS simulators/tests are excluded by default.
