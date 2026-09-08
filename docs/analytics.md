# Scooters analytics

Dashboard: https://umami.plhery.com/websites/6e60b4ab-b4ee-4785-9699-a7f32127b358

Both clients POST to `https://u.plhery.com/api/send`, using the public website ID
`6e60b4ab-b4ee-4785-9699-a7f32127b358`. No API/admin secret is shipped. The Umami
admin dashboard remains protected independently of its existing public collector.
Filter by **Tag** (`web`, `pwa`, `ios`) to compare platforms. Named events also
carry `platform` in event data. Web page views contain only `/` or `/privacy`;
native screen views use `/`, `/filters`, `/settings`.

## Event catalog

| Flow | Events | Data |
| --- | --- | --- |
| Lifecycle | `app_open`, `app_install` (PWA), `app_foreground` (iOS) | platform |
| Search | `search_open`, `search_close`, `search_results`, `search_error`, `search_select`, `search_clear` | result count only (`count` web, `value` iOS) |
| Filters | `filters_open`, `provider_filter`, `providers_all`, `filters_reset`, `battery_filter` | provider, enabled/result, quick/filter source (web), value |
| Preferences | `settings_open`, `panel_close`, `map_style`, `language_change` (web) | style/result, language |
| Location | `locate`, `location_result`, `browse_map` | success/denied/unavailable |
| Map/details | `vehicle_select`, `vehicle_dismiss`, `cluster_select`, `parking_select`, `map_zoom` (web), `compass_reset` (web) | provider; zoom direction |
| Conversion intent | `directions_open`, `rental_open` | provider, vehicle/parking target |
| Reliability | `refresh`, `refresh_result` (web), `data_error`, `data_expired` (web) | generic outcome only |
| Price tools (iOS) | `ride_duration`, `ride_pass_change` | duration, provider; never pass expiry or financial details |

Useful funnel: `app_open` → `vehicle_select` → `rental_open`. A rental click is
intent, not a confirmed ride. No provider callback exists to verify a booking.
Automatic refreshes do not produce manual refresh events. Continuous map
coordinates, motion/heading readings, typed searches, and vehicle IDs are excluded.

## Delivery and privacy

Events are best effort with a bounded queue of 30, a five-second request timeout,
no retry/offline persistence, and in-memory Umami session-cache reuse. Blocking
analytics never prevents map use or outbound navigation. External referrers,
query strings, fragments and arbitrary page titles are excluded. The collector
receives normal IP/user-agent network metadata; Umami derives coarse geography
and short-lived session/device statistics without storing raw IP addresses.
See PRIVACY.md and the public privacy page for the user-facing notice.

Web collection runs only on `scooters.plhery.com`, honors DNT/GPC and
`localStorage['umami.disabled']`, and has an opt-out on `/privacy`.
iOS has an opt-out in Settings. Simulators, previews and XCTest are disabled;
launch a simulator with `-analytics-smoke-test` only for an intentional production
collection check. Physical-device installations collect after rebuilding/installing
this revision. Existing installed binaries cannot gain tracking through a web deploy.

## Deployment/verification

Run lint, web tests, OpenNext build and iOS tests. Deploy with `npm run deploy`
(the existing Cloudflare auth is required). Check production CSP allows only the
specific collector origin in `connect-src`; script restrictions stay unchanged.
Use Chrome to interact with the deployed map and verify named events in Umami.
Use a simulator smoke launch for native API/transport verification. Smoke visits
remain visible in production analytics; they can be identified by test time/platform.
