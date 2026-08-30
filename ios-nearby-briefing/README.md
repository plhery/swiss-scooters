# Swiss Scooters — Nearby Briefing

An experimental, standalone SwiftUI and MapKit redesign of Swiss Scooters,
designed for iOS 26 or newer. It lives beside the production `ios/` app so the
two experiences can be compared without modifying or replacing the original.

The app uses the separate bundle identifier
`com.plhery.zurichscooters.nearbybriefing` and appears as **Scooters Briefing**
when installed.

## Run it on your iPhone

1. Install Xcode 26 or newer and open `SwissScooters.xcodeproj`.
2. Select the **SwissScooters** target, open **Signing & Capabilities**, and
   choose your Personal Team. Change the bundle identifier if Xcode asks for a
   unique one.
3. Connect the iPhone, enable Developer Mode if prompted, select it as the run
   destination, and press **Run**.
4. Allow location access on first launch.

## Refresh the free installation

The repository-level `scripts/refresh-ios-app.sh` intentionally continues to
target the production app in `ios/`. Refresh this experimental variant from
Xcode so its separate bundle identity is preserved.

No API keys or third-party packages are required. The app reads live scooter
data from the production API at
`https://swiss-scooters.plhery.com/api/scooters`.

## Nearby Briefing concept

- Full-screen Apple Maps with a compact, always-available origin/search control
- Thumb-friendly provider filters that surface currently available operators first
  and remember each rider's own combination between launches
- Map-first browsing with no automatic “closest” recommendation; scooter details
  appear only after a marker is selected
- Focused scooter details with walking time, battery, range, directions, and rental action
- Scroll-safe nearby, filter, and settings sheets instead of one oversized utility drawer
- Quieter provider-aware markers and clusters with purposeful Liquid Glass chrome
- Automatic freshness, accessible motion and haptics, scroll-safe Dynamic Type,
  VoiceOver-aware map markers and search results, and Reduce Motion support
- Complete English, German, French, and Italian localization

The production API endpoint is centralized in `Services/ScooterAPI.swift` if a
local or preview backend is needed later.
