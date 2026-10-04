# Scooters — iOS app

The SwiftUI and MapKit app for Scooters, for iOS 26 or newer. It shows the same
live data as [scooters.plhery.com](https://scooters.plhery.com) and is meant to
behave and read like the website, with iOS controls and Liquid Glass. It uses the
bundle identifier `com.plhery.zurichscooters` and appears as **Scooters** when
installed.

## Run it on your iPhone

1. Install Xcode 26 or newer and open `SwissScooters.xcodeproj`.
2. Select the **SwissScooters** target, open **Signing & Capabilities**, and
   choose your Personal Team. Change the bundle identifier if Xcode asks for a
   unique one.
3. Connect the iPhone, enable Developer Mode if prompted, select it as the run
   destination, and press **Run**.
4. The app opens on a map of Switzerland with city totals. Tap **Near me** and
   allow location access to see the scooters around you, or search for a city or
   an address instead.

No API keys or third-party packages are required.

To rebuild and reinstall the app on a phone while renewing its free provisioning
profile, set `SWISS_SCOOTERS_DEVICE_NAME` to the iPhone's name and run the
repository-level `scripts/refresh-ios-app.sh`.

## What the app shows

One screen: a full-screen Apple map, a search bar at the top, a dock at the
bottom and a locate button above the dock. Filters and Settings open as sheets
from the search bar.

**Map.** Zoomed out, each city shows its total; closer, clusters; closer still,
one marker per scooter with the provider's initials. Parking bays appear as `P`
from street level. Tapping a city or a cluster zooms in.

**Locate button.** Until the phone has been located once it is a blue **Near me**
pill; after that, a round button. Locating zooms the map to about 350 m across.
When location access was granted earlier, the app locates by itself on launch.

**Search bar.** It says what the map is based on: nothing yet, **Near you**, or
the place you searched, with a button to clear it. A place where no operator
shares data does not promise scooters.

**Search.** It opens on the field. Before you type: **Use my location**, the
places chosen in this session and the six nearest cities with scooters. Typing
two characters or more lists places with a second line and a **No data** tag
where no operator shares data; Return chooses the first. Street search works in
Switzerland; elsewhere, search by city. A chosen place becomes the point walking
times are measured from, until it is cleared.

**Dock.** The number of scooters nearby or on this map, how fresh the data is
(**Live**, **Updated 3 min ago**, **City totals · refreshed hourly**), and one
chip per provider, largest first. The chips remember each rider's own
combination between launches. When there is nothing to show, the dock says why:

- no operator shares data here: the three closest cities, with their distance;
- the filters hide everything: how many scooters, and buttons to show them all
  or edit the filters;
- the area is covered but empty: zoom out or move the map.

A provider is named as not sharing data only when one of its feeds failed, it
operates in the area on screen and none of its scooters is in view. City totals
name no one.

**Scooter card.** Selecting a marker replaces the dock with the scooter: provider,
walking time and distance from you or from the searched place, battery, range, a
price estimate for a ride of 5 to 30 minutes, **Directions** and **Open in** the
provider's app. Opening the provider's app does not reserve the scooter. Tapping
the header centres the scooter in the part of the map the card leaves visible.

**Parking bay card.** Selecting a `P` shows the bay, whether parking there is
required in this zone, and **Directions**.

**Location problems.** A card under the search bar: **Location is off** with
**Open Settings** and **Search a place**; restricted on this device; or not
found, with **Try again**. It stays dismissed until the next attempt.

**Filters.** One battery choice (Any, 30%+, 60%+, 80%+) and one provider list
with the count in view, or a note when a provider is not sharing data. **Reset**
is in the header and the button at the bottom says how many scooters the map
will show.

**Settings.** Map appearance (Standard, Quiet, Satellite); passes per provider
(free unlock, free minutes, optional expiry date), listed for the providers that
operate where the map is or that already have a pass; and About: map and data
credits, Privacy with the usage switch and the privacy notice, and the source
code on GitHub.

The app is translated into English, German, French and Italian. It follows
Dynamic Type up to the accessibility sizes, labels map markers and search
results for VoiceOver, and respects Reduce Motion.

## Data and freshness

The app reads `https://scooters.plhery.com/api/scooters` for the area on screen
and `https://scooters.plhery.com/api/geocode` for search, to which it sends the
language it is shown in. The endpoint is set in `Services/ScooterAPI.swift` if a
local or preview backend is needed.

The API covers Switzerland and selected cities in France, Germany and Italy.
Prices are in CHF or EUR where the feed supplies a tariff. The backend loads
feeds for the visible map area only.

Refreshing is automatic while the app is in front: at the interval the server
names (a minute, an hour for city totals) or shortly before the data expires,
and at once when the app returns to the foreground with data that is due. There
is no refresh button. **Try again** appears only when something failed:

- a refresh failed and the data is still valid: the dock says so and keeps the
  markers;
- nothing has loaded yet: a banner under the search bar gives the reason;
- the data expired and the refresh after that failed: the map is cleared and the
  dock says the positions are out of date.

## What stays on the phone

The filters, the map appearance, the passes, the ride length used for price
estimates, the usage choice and whether the phone was ever located are kept in
the app's settings. Your location, the places you searched and the text you
typed are never stored; recent places live in memory until the app closes.

## Usage analytics

Screen views and action events go to the same self-hosted Umami dashboard as the
website, with the `ios` tag. Settings › About › Privacy lets riders turn this
off. No address text, precise locations, vehicle IDs or advertising IDs are
sent. Simulators, previews and tests are excluded by default. See
[the analytics event catalog](../docs/analytics.md). An installed app only
changes when it is rebuilt and reinstalled; a web deployment does not update it.

## Code

- `Models/` — `ScooterModels.swift` holds the data types and the rules the dock,
  cards and status lines are built from; `ScooterFiltering.swift` the filters and
  counts. `ProviderCatalog.generated.swift` (providers, service areas, covered
  cities) and `ScooterAPIContract.generated.swift` (the API's shape) are written
  by `npm run generate:providers` and `npm run generate:api-contract` from the
  repository's shared data; do not edit them by hand.
- `Services/` — the scooter API, the address search and analytics.
- `ViewModels/ScooterMapModel.swift` — the state of the screen: loading and
  refreshing, location, the selection, filters, passes, and what the dock shows.
- `Views/` — `ScooterMapScreen.swift` lays the screen out; `ScooterMapView.swift`
  is the MapKit map and its markers; `ScooterControls.swift` the dock, cards,
  sheets and notices; `SwissAddressSearch.swift` the search bar and panel.
- `en.lproj`, `de.lproj`, `fr.lproj`, `it.lproj` — every string, keyed by its
  English text. A new string needs an entry in all four.

The Xcode project lists its files one by one, so a new Swift file has to be added
to `SwissScooters.xcodeproj` as well.

## Tests

`SwissScootersTests` covers the models, the filters, both API clients, the screen
model and that the main states render. Run them in Xcode with **Product › Test**,
or from the repository root:

```sh
xcodebuild test -project ios/SwissScooters.xcodeproj -scheme SwissScooters \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO
```
