# Scooters — Map-first iOS app

The canonical SwiftUI and MapKit app for Scooters, designed for iOS 26 or
newer. It uses the production bundle identifier `com.plhery.zurichscooters` and
appears as **Scooters** when installed.

## Run it on your iPhone

1. Install Xcode 26 or newer and open `SwissScooters.xcodeproj`.
2. Select the **SwissScooters** target, open **Signing & Capabilities**, and
   choose your Personal Team. Change the bundle identifier if Xcode asks for a
   unique one.
3. Connect the iPhone, enable Developer Mode if prompted, select it as the run
   destination, and press **Run**.
4. Allow location access on first launch.

## Refresh the free installation

Run the repository-level `scripts/refresh-ios-app.sh` to rebuild and reinstall
the app while refreshing its free provisioning profile.

No API keys or third-party packages are required. The app reads live scooter
data from the production API at
`https://scooters.plhery.com/api/scooters`.

The shared API supports Switzerland and selected cities in France, Germany and Italy.
Search accepts Swiss addresses and supported city names in those countries. Providers outside Switzerland
include Dott, Bird, Lime, Voi and Pony, with EUR pricing where the feed supplies it.
The backend loads feeds for the visible map area; viewing a French city does not
load Swiss feeds just because the phone is in Switzerland.

## Map-first concept

- Full-screen Apple Maps with a compact, always-available origin/search control
- Thumb-friendly provider filters that surface currently available operators first
  and remember each rider's own combination between launches
- Map-first browsing with no automatic “closest” recommendation; scooter details
  appear only after a marker is selected
- Focused scooter details with walking time, battery, range, live duration-based price estimates,
  directions, and rental action
- Local per-provider pass settings for free unlocks, included minutes, and optional expiry dates
- Focused, scroll-safe filter and settings sheets instead of one oversized utility drawer
- Quieter provider-aware markers and clusters with purposeful Liquid Glass chrome
- Automatic freshness, accessible motion and haptics, scroll-safe Dynamic Type,
  VoiceOver-aware map markers and search results, and Reduce Motion support
- Complete English, German, French, and Italian localization

The production API endpoint is centralized in `Services/ScooterAPI.swift` if a
local or preview backend is needed later.

## Usage analytics

Native screen views and action events go to the same self-hosted Umami dashboard
as the public website, with the `ios` tag. Settings → Analytics lets riders disable
collection. No address text, precise locations, vehicle IDs or advertising IDs are
sent. Simulators, previews and tests are excluded by default. See
[the analytics event catalog](../docs/analytics.md). Rebuild/install the native app
to receive analytics changes; a web deployment does not update an installed iOS binary.
