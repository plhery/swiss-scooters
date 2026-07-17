# Scooters for iPhone

A native SwiftUI and MapKit version of Scooters Switzerland, designed for an
iPhone 17 Pro running iOS 26 or newer.

## Run it on your iPhone

1. Install Xcode 26 or newer and open `ZurichScooters.xcodeproj`.
2. Select the **ZurichScooters** target, open **Signing & Capabilities**, and
   choose your Personal Team. Change the bundle identifier if Xcode asks for a
   unique one.
3. Connect the iPhone, enable Developer Mode if prompted, select it as the run
   destination, and press **Run**.
4. Allow location access on first launch.

No API keys or third-party packages are required. The app reads live scooter
data from the existing production API at
`https://zurich-scooter.plhery.com/api/scooters`.

## Native features

- Apple Maps with live user location and automatic light/dark rendering
- Provider-colored scooter markers and provider-aware native map clustering
- Viewport-based loading with buffered requests and local instant filters
- iOS 26 Liquid Glass dock, buttons, provider chips, slider, and map picker
- Battery, range, and walking-distance details
- One-tap walking directions in Apple Maps and provider rental deep links
- Saved battery and map-style preferences

The production API endpoint is centralized in `Services/ScooterAPI.swift` if a
local or preview backend is needed later.
