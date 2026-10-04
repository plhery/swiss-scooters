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
4. The app opens on the map. Tap **Near me** and allow location access to see
   the scooters around you, or search for a city or an address instead.

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

- Full-screen Apple Maps under a compact search bar that says what the map is
  based on: nothing yet, your location, or a place you searched (with a button to
  clear it)
- Search that opens on the field: your location, the places chosen during this
  session (kept in memory only, never stored) and the nearest cities with
  scooters, then results with a second line and a “No data” tag where no
  operator shares data
- Thumb-friendly provider chips in the dock, largest first, that remember each
  rider's own combination between launches
- Map-first browsing with no automatic “closest” recommendation; scooter details
  appear only after a marker is selected
- Focused scooter details with walking time, battery, range, live duration-based price estimates,
  directions, and rental action
- Local per-provider pass settings for free unlocks, included minutes, and optional expiry dates,
  listed for the providers that operate where the map is or that already have a pass
- A filter sheet with one battery choice (Any, 30%+, 60%+, 80%+), one provider list
  with the count in view and a note when a provider is not sharing data, Reset, and a
  button that says how many scooters the map will show
- A settings sheet with the map appearance, the passes, and About: map and data
  credits, the privacy choice and the source code
- Quieter provider-aware markers and clusters with purposeful Liquid Glass chrome
- Automatic freshness, accessible motion and haptics, scroll-safe Dynamic Type,
  VoiceOver-aware map markers and search results, and Reduce Motion support
- Complete English, German, French, and Italian localization

The production API endpoint is centralized in `Services/ScooterAPI.swift` if a
local or preview backend is needed later.

## Usage analytics

Native screen views and action events go to the same self-hosted Umami dashboard
as the public website, with the `ios` tag. Settings › About › Privacy lets riders
disable collection. No address text, precise locations, vehicle IDs or advertising IDs
are sent. Simulators, previews and tests are excluded by default. See
[the analytics event catalog](../docs/analytics.md). Rebuild/install the native app
to receive analytics changes; a web deployment does not update an installed iOS binary.
