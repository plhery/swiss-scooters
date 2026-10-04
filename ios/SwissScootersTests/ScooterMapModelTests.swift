import CoreLocation
import Foundation
import MapKit
import SwiftUI
import XCTest
@testable import SwissScooters

@MainActor
final class ScooterMapModelTests: XCTestCase {
    func testParkingFollowsZoomAndProviderFiltersWithoutChangingScooterCounts() async {
        let location = ScooterParking(id: "dott:bay", provider: "dott", name: "Place test",
            latitude: 45.75, longitude: 4.85, mandatory: true)
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [], parking: [location])))
        let region = MKCoordinateRegion(center: location.coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))
        model.updateViewport(region, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        XCTAssertEqual(model.mapParking, [location])
        XCTAssertEqual(model.visibleCount, 0)
        model.setMinimumBattery(100)
        XCTAssertEqual(model.mapParking, [location])
        model.toggle(provider: .dott)
        XCTAssertTrue(model.mapParking.isEmpty)
        model.toggle(provider: .dott)
        model.updateViewport(region, zoom: 15)
        XCTAssertTrue(model.mapParking.isEmpty)
    }

    func testGermanAndItalianProviderCoveragePreservesSelection() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let selected = model.enabledProviders
        model.viewport = GeoBounds(south: 52.49, west: 13.37, north: 52.55, east: 13.44)
        XCTAssertEqual(model.availableProviders, [.dott])
        model.viewport = GeoBounds(south: 41.88, west: 12.46, north: 41.93, east: 12.53)
        XCTAssertEqual(model.availableProviders, [.bird])
        XCTAssertEqual(model.enabledProviders, selected)
        model.viewport = GeoBounds(south: 48.19, west: 9.16, north: 48.21, east: 9.19)
        XCTAssertFalse(model.availableProviders.contains(.lime))
    }

    func testFrenchViewportHidesSwissProvidersWithoutChangingSavedSelection() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let selected = model.enabledProviders
        model.viewport = GeoBounds(south: 45.72, west: 4.79, north: 45.80, east: 4.90)
        XCTAssertEqual(model.availableProviders, [.dott])
        XCTAssertFalse(model.dockChips.contains { $0.provider == .publibike })
        XCTAssertEqual(model.enabledProviders, selected)
        model.viewport = GeoBounds(south: 47.3, west: 8.4, north: 47.5, east: 8.7)
        XCTAssertTrue(model.availableProviders.contains(.publibike))
    }

    func testProviderCountsRemainAvailableWhenAProviderIsHidden() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [], clusters: [ScooterCluster(id: "city:ch:zurich", latitude: 47.38,
                longitude: 8.54, count: 100, providers: ["lime": 80, "bird": 20], city: "Zürich")],
            meta: ScooterResponseMetadata(partial: false, failedSources: [], mode: "clusters", zoom: 8, overview: true)
        ))
        let model = makeModel(api: api)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.toggle(provider: .bird)
        XCTAssertEqual(model.count(for: .bird), 20)
        XCTAssertEqual(model.visibleCount, 80)
        XCTAssertEqual(model.allProviderCount, 100)
        XCTAssertTrue(ScooterClusteringPolicy.representationsMatch(6, 10))
        XCTAssertFalse(ScooterClusteringPolicy.representationsMatch(10, 11))
    }

    func testSupersededFetchIsCancelled() async throws {
        let api = StubScooterAPI(response: ScooterResponse(vehicles: []), delaysFirstRequest: true)
        let model = makeModel(api: api)

        model.refresh()
        let firstRequestStarted = await waitUntil {
            await api.snapshot().calls == 1
        }
        XCTAssertTrue(firstRequestStarted)

        model.refresh()

        let replacementFinished = await waitUntil {
            let snapshot = await api.snapshot()
            return snapshot.calls == 2 && snapshot.cancellations == 1
        }
        XCTAssertTrue(replacementFinished)
        let loadingFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loadingFinished)
    }

    func testPartialRefreshAcceptsHealthyResultsAndShowsHealthNotice() async throws {
        let completeScooters = [
            scooter(id: "lime", provider: "lime"),
            scooter(id: "voi", provider: "voi")
        ]
        let api = StubScooterAPI(response: ScooterResponse(vehicles: completeScooters))
        let model = makeModel(api: api)

        model.refresh()
        let initialLoadFinished = await waitUntil {
            model.lastUpdated != nil && !model.isLoading
        }
        XCTAssertTrue(initialLoadFinished)

        await api.setResponse(ScooterResponse(
            vehicles: [scooter(id: "voi-new", provider: "voi")],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["national"])
        ))
        model.refresh()

        let partialRefreshFinished = await waitUntil {
            !model.dockNotices.isEmpty && !model.isLoading
        }
        XCTAssertTrue(partialRefreshFinished)
        XCTAssertEqual(model.mapScooters.map(\.vehicleID), ["voi-new"])
        XCTAssertNil(model.loadIssue)
        XCTAssertEqual(model.dockNotices, [.someProvidersDown])
    }

    func testAcceptedDegradedResponseExposesADataHealthMessage() async throws {
        let response = ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime")],
            meta: ScooterResponseMetadata(
                partial: true,
                stale: true,
                failedSources: ["national"],
                truncated: true,
                totalVehicles: 5_100
            )
        )
        let model = makeModel(api: StubScooterAPI(response: response))

        model.refresh()

        let loadingFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loadingFinished)
        XCTAssertEqual(model.dockNotices, [.someProvidersDown, .truncated(shown: 1, total: 5_100)])
        let message = try XCTUnwrap(model.dockNotices.last?.text)
        XCTAssertTrue(message.contains(1.formatted()))
        XCTAssertTrue(message.contains(5_100.formatted()))
    }

    func testCountryScaleResponseRepresentsThousandsWithOneServerClusterAnnotation() async {
        let cluster = ScooterCluster(
            id: "8:134:89",
            latitude: ScooterMapModel.switzerlandCenter.latitude,
            longitude: ScooterMapModel.switzerlandCenter.longitude,
            count: 9_000,
            providers: ["lime": 6_000, "bird": 3_000]
        )
        let response = ScooterResponse(
            vehicles: [],
            clusters: [cluster],
            providers: ["lime": 6_000, "bird": 3_000],
            meta: ScooterResponseMetadata(
                partial: false,
                failedSources: [],
                totalVehicles: 9_000,
                mode: "clusters",
                zoom: 8
            )
        )
        let api = StubScooterAPI(response: response)
        let model = makeModel(api: api)

        model.refresh()
        let loadingFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loadingFinished)
        XCTAssertTrue(model.mapScooters.isEmpty)
        XCTAssertEqual(model.mapClusters.count, 1)
        XCTAssertEqual(model.mapScooters.count + model.mapClusters.count, 1)
        XCTAssertEqual(model.visibleCount, 9_000)
        let snapshot = await api.snapshot()
        XCTAssertEqual(snapshot.lastZoom, 8)
        XCTAssertEqual(snapshot.lastMinimumBattery, 0)

        model.toggle(provider: .bird)
        XCTAssertEqual(model.mapClusters.first?.count, 6_000)
        XCTAssertEqual(model.visibleCount, 6_000)
    }

    func testClusteredBatteryFilterIsAppliedByTheServer() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            clusters: [ScooterCluster(
                id: "8:134:89",
                latitude: ScooterMapModel.switzerlandCenter.latitude,
                longitude: ScooterMapModel.switzerlandCenter.longitude,
                count: 100,
                providers: ["lime": 100]
            )],
            meta: ScooterResponseMetadata(
                partial: false,
                failedSources: [],
                mode: "clusters",
                zoom: 8
            )
        ))
        let model = makeModel(api: api)

        model.refresh()
        let initialLoadFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(initialLoadFinished)

        model.setMinimumBattery(60)
        let filteredLoadFinished = await waitUntil {
            let snapshot = await api.snapshot()
            return snapshot.calls == 2 && !model.isLoading
        }

        XCTAssertTrue(filteredLoadFinished)
        let snapshot = await api.snapshot()
        XCTAssertEqual(snapshot.lastZoom, 8)
        XCTAssertEqual(snapshot.lastMinimumBattery, 60)
    }

    func testBatteryFilterSnapsDownToAPresetPersistsItAndClearsHiddenSelection() async throws {
        let scooter = Scooter(
            provider: "lime",
            latitude: 47.3769,
            longitude: 8.5417,
            battery: 40,
            rangeMeters: nil,
            vehicleID: "selected",
            deepLink: nil,
            rentalURIs: nil,
            distanceMeters: 0
        )
        let api = StubScooterAPI(response: ScooterResponse(vehicles: [scooter]))
        let defaults = isolatedDefaults()
        let model = ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: defaults
        )
        model.refresh()
        let loadingFinished = await waitUntil { model.lastUpdated != nil }
        XCTAssertTrue(loadingFinished)

        model.selectScooter(scooter.id)
        model.setMinimumBattery(29)

        XCTAssertEqual(model.minimumBattery, 0)
        XCTAssertEqual(model.selectedScooterID, scooter.id)

        model.setMinimumBattery(75)

        XCTAssertEqual(model.minimumBattery, 60)
        XCTAssertEqual(defaults.integer(forKey: "minimum-battery"), 60)
        XCTAssertNil(model.selectedScooterID)
        XCTAssertTrue(model.mapScooters.isEmpty)
    }

    func testProviderTogglesComposeAndResetTogether() async {
        let scooters = [
            scooter(id: "lime", provider: "lime"),
            scooter(id: "bird", provider: "bird"),
            scooter(id: "voi", provider: "voi")
        ]
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: scooters)))
        model.refresh()
        let loadingFinished = await waitUntil { model.lastUpdated != nil }
        XCTAssertTrue(loadingFinished)

        model.toggle(provider: .voi)
        model.toggle(provider: .bird)

        XCTAssertEqual(model.mapScooters.map(\.provider), ["lime"])
        XCTAssertTrue(model.hasActiveFilters)

        model.resetFilters()

        XCTAssertEqual(Set(model.mapScooters.map(\.provider)), Set(["lime", "bird", "voi"]))
        XCTAssertFalse(model.hasActiveFilters)
    }

    func testQuickProviderTogglesBuildAnyCombinationAndReturnToAll() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))

        model.toggleQuickProvider(.bird)
        XCTAssertEqual(model.enabledProviders, [.bird])

        model.toggleQuickProvider(.dott)
        XCTAssertEqual(model.enabledProviders, [.bird, .dott])

        model.toggleQuickProvider(.bird)
        XCTAssertEqual(model.enabledProviders, [.dott])

        model.toggleQuickProvider(.dott)
        XCTAssertTrue(model.allProvidersSelected)
    }

    func testSelectionUsesLatestVehicleIndexAndMapRevisionOnlyChangesWithData() async throws {
        let first = scooter(id: "first", provider: "lime")
        let second = scooter(id: "second", provider: "voi")
        let api = StubScooterAPI(response: ScooterResponse(vehicles: [first, second]))
        let model = makeModel(api: api)

        model.refresh()
        let loadingFinished = await waitUntil { model.lastUpdated != nil }
        XCTAssertTrue(loadingFinished)
        let loadedRevision = model.mapScootersRevision

        model.selectScooter(second.id)

        XCTAssertEqual(model.selectedScooter, second)
        XCTAssertEqual(model.mapScootersRevision, loadedRevision)

        await api.setResponse(ScooterResponse(vehicles: [first]))
        model.refresh()
        let refreshed = await waitUntil {
            model.mapScootersRevision > loadedRevision && !model.isLoading
        }
        XCTAssertTrue(refreshed)
        XCTAssertNil(model.selectedScooter)
    }

    func testLocationPolicyRejectsStaleAndInaccurateSamplesAndChoosesBestFallback() {
        let now = Date()
        let preferred = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            altitude: 0,
            horizontalAccuracy: 50,
            verticalAccuracy: 10,
            timestamp: now
        )
        let fallback = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.37, longitude: 8.54),
            altitude: 0,
            horizontalAccuracy: 500,
            verticalAccuracy: 10,
            timestamp: now
        )
        let stale = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.37, longitude: 8.54),
            altitude: 0,
            horizontalAccuracy: 10,
            verticalAccuracy: 10,
            timestamp: now.addingTimeInterval(-31)
        )

        XCTAssertTrue(ScooterLocationPolicy.isAcceptable(
            preferred,
            maximumAccuracy: ScooterLocationPolicy.preferredAccuracy
        ))
        XCTAssertFalse(ScooterLocationPolicy.isAcceptable(
            fallback,
            maximumAccuracy: ScooterLocationPolicy.preferredAccuracy
        ))
        XCTAssertFalse(ScooterLocationPolicy.isAcceptable(
            stale,
            maximumAccuracy: ScooterLocationPolicy.fallbackAccuracy
        ))
        XCTAssertTrue(ScooterLocationPolicy.bestCandidate(in: [fallback, stale, preferred]) === preferred)
    }

    func testUserLocationFocusShowsAboutThreeHundredFiftyMetres() throws {
        let locationManager = CLLocationManager()
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: locationManager,
            defaults: isolatedDefaults()
        )
        let location = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            altitude: 0,
            horizontalAccuracy: 25,
            verticalAccuracy: 10,
            timestamp: Date()
        )
        let expectedFocusMeters: CLLocationDistance = 350

        model.locationManager(locationManager, didUpdateLocations: [location])

        let openingFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(openingFocus.latitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(openingFocus.longitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(model.viewportZoom, 17)

        model.focusOnUser()

        let buttonFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertNotEqual(buttonFocus.token, openingFocus.token)
        XCTAssertEqual(buttonFocus.latitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(buttonFocus.longitudinalMeters, expectedFocusMeters, accuracy: 0.001)
    }

    func testOnlyDeniedLocationAccessOffersASettingsShortcut() {
        XCTAssertTrue(ScooterLocationIssue.denied.canOpenSettings)
        XCTAssertFalse(ScooterLocationIssue.restricted.canOpenSettings)
        XCTAssertFalse(ScooterLocationIssue.denied.message.isEmpty)
        XCTAssertFalse(ScooterLocationIssue.restricted.message.isEmpty)
        XCTAssertNotEqual(
            ScooterLocationIssue.denied.message,
            ScooterLocationIssue.restricted.message
        )
    }

    func testAddressSelectionCreatesDestinationAndNewFocusRequests() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let firstDestination = MapDestination(
            title: "Zürich HB",
            point: GeoPoint(latitude: 47.3782, longitude: 8.5402)
        )
        let secondDestination = MapDestination(
            title: "Bellevue",
            point: GeoPoint(latitude: 47.3665, longitude: 8.5451)
        )

        model.selectScooter("lime:selected")
        model.focusOnAddress(firstDestination)

        XCTAssertNil(model.selectedScooterID)
        XCTAssertEqual(model.searchedDestination, firstDestination)
        XCTAssertEqual(model.focusRequest?.point, firstDestination.point)
        let firstToken = model.focusRequest?.token

        model.focusOnAddress(secondDestination)

        XCTAssertEqual(model.searchedDestination, secondDestination)
        XCTAssertEqual(model.focusRequest?.point, secondDestination.point)
        XCTAssertNotEqual(model.focusRequest?.token, firstToken)

        model.clearAddressSearch()
        XCTAssertNil(model.searchedDestination)
    }

    func testActiveOriginPrefersSearchedDestinationAndDistanceUsesIt() throws {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let userLocation = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let destination = MapDestination(
            title: "Zürich HB",
            point: GeoPoint(latitude: 47.3782, longitude: 8.5402)
        )
        let candidate = scooter(
            id: "candidate",
            provider: "lime",
            latitude: 47.3790,
            longitude: 8.5402
        )
        model.userLocation = userLocation

        XCTAssertEqual(model.activeOrigin, .userLocation(userLocation))

        model.focusOnAddress(destination)

        XCTAssertEqual(model.activeOrigin, .searchedDestination(destination))
        XCTAssertEqual(
            model.formattedDistance(for: candidate),
            candidate.formattedDistance(from: destination.point)
        )
        XCTAssertEqual(
            try XCTUnwrap(model.straightLineDistance(to: candidate)),
            candidate.distance(from: destination.point),
            accuracy: 0.001
        )

        model.clearAddressSearch()

        XCTAssertEqual(model.activeOrigin, .userLocation(userLocation))
        XCTAssertEqual(
            model.formattedDistance(for: candidate),
            candidate.formattedDistance(from: userLocation)
        )
    }

    func testApproximateWalkingMinutesUseStraightLineDistanceAtEightyMetersPerMinute() throws {
        let origin = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        model.userLocation = origin
        let samePlace = scooter(
            id: "same-place",
            provider: "lime",
            latitude: origin.latitude,
            longitude: origin.longitude
        )
        let aboutOneHundredElevenMetersAway = scooter(
            id: "two-minutes",
            provider: "lime",
            latitude: origin.latitude + 0.001,
            longitude: origin.longitude
        )

        XCTAssertEqual(model.approximateWalkingMinutes(to: samePlace), 1)
        XCTAssertEqual(model.approximateWalkingMinutes(to: aboutOneHundredElevenMetersAway), 2)
        XCTAssertGreaterThan(
            try XCTUnwrap(model.straightLineDistance(to: aboutOneHundredElevenMetersAway)),
            80
        )

        model.userLocation = nil

        XCTAssertNil(model.straightLineDistance(to: samePlace))
        XCTAssertNil(model.approximateWalkingMinutes(to: samePlace))
        XCTAssertNil(model.formattedDistance(for: samePlace))
    }

    func testQuickProviderChoicesKeepReliableCountsForHiddenProviders() async {
        let origin = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let model = await loadedModel(
            vehicles: [
                scooter(id: "bird", provider: "bird"),
                scooter(id: "dott", provider: "dott"),
                scooter(id: "lime", provider: "lime")
            ],
            origin: origin
        )

        model.showProviders([.bird, .dott])

        XCTAssertEqual(Set(model.mapScooters.compactMap(\.providerInfo)), [.bird, .dott])
        XCTAssertEqual(model.visibleCount, 2)
        XCTAssertEqual(model.count(for: .bird), 1)
        XCTAssertEqual(model.count(for: .dott), 1)
        XCTAssertEqual(model.count(for: .lime), 1)
        XCTAssertEqual(model.allProviderCount, 3)

        model.showProviders([.bird])

        XCTAssertEqual(model.mapScooters.compactMap(\.providerInfo), [.bird])
        XCTAssertEqual(model.visibleCount, 1)
        XCTAssertEqual(model.count(for: .dott), 1)
    }

    func testQuickProviderOrderFollowsCountsAndKeepsCatalogueOrderForTies() async {
        let origin = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let model = await loadedModel(
            vehicles: [
                scooter(id: "bird-one", provider: "bird"),
                scooter(id: "bird-two", provider: "bird"),
                scooter(id: "bolt-one", provider: "bolt"),
                scooter(id: "bolt-two", provider: "bolt"),
                scooter(id: "dott", provider: "dott"),
                scooter(id: "lime", provider: "lime")
            ],
            origin: origin
        )

        XCTAssertEqual(model.dockChips.prefix(4).map(\.provider), [.bolt, .bird, .dott, .lime])
        XCTAssertEqual(model.dockChips.dropFirst(4).prefix(2).map(\.provider), [.hopp, .voi])

        // Choosing providers highlights their chips without moving them.
        model.showProviders([.lime, .voi])

        XCTAssertEqual(model.dockChips.prefix(4).map(\.provider), [.bolt, .bird, .dott, .lime])
        XCTAssertEqual(model.dockChips.filter(\.isSelected).map(\.provider), [.lime, .voi])
        XCTAssertEqual(model.dockChips.first?.count, 2)
    }

    func testProviderChoicePersistsAcrossModelInstances() {
        let defaults = isolatedDefaults()
        let firstModel = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )

        firstModel.showProviders([.hopp, .publibike])

        let restoredModel = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )

        XCTAssertEqual(restoredModel.enabledProviders, [.hopp, .publibike])
    }

    func testRideDurationAndProviderPassesPersistIndependently() {
        let defaults = isolatedDefaults()
        let firstModel = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )
        let expiryDate = Date(timeIntervalSince1970: 1_800_000_000)
        let boltPass = ProviderRidePass(
            enabled: true,
            freeUnlock: true,
            freeMinutes: 15,
            expiryDate: expiryDate
        )
        let voiPass = ProviderRidePass(enabled: true, freeMinutes: 5)

        firstModel.setRideEstimateMinutes(20)
        firstModel.setRidePass(boltPass, for: .bolt)
        firstModel.setRidePass(voiPass, for: .voi)

        let restoredModel = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )

        XCTAssertEqual(restoredModel.rideEstimateMinutes, 20)
        XCTAssertEqual(restoredModel.ridePass(for: .bolt), boltPass)
        XCTAssertEqual(restoredModel.ridePass(for: .voi), voiPass)
        XCTAssertEqual(restoredModel.ridePass(for: .lime), ProviderRidePass())
    }

    func testInvalidStoredRideDurationFallsBackToTenMinutes() {
        let defaults = isolatedDefaults()
        defaults.set(17, forKey: "ride-estimate-minutes-v1")

        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )

        XCTAssertEqual(model.rideEstimateMinutes, RideEstimateDuration.defaultMinutes)
    }

    func testRidePriceQuoteUsesTheSelectedScootersProviderPass() throws {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        model.setRideEstimateMinutes(10)
        model.setRidePass(
            ProviderRidePass(enabled: true, freeUnlock: true, freeMinutes: 5),
            for: .bolt
        )
        model.setRidePass(
            ProviderRidePass(enabled: true, freeUnlock: true, freeMinutes: 10),
            for: .voi
        )
        let bolt = Scooter(
            provider: "bolt",
            latitude: 47.3769,
            longitude: 8.5417,
            battery: 90,
            rangeMeters: nil,
            vehicleID: "priced",
            deepLink: nil,
            rentalURIs: nil,
            distanceMeters: 0,
            pricing: ScooterRidePricing(
                currency: "CHF",
                unlockFeeMinorUnits: 100,
                minuteFeeMinorUnits: 42
            )
        )

        let quote = try XCTUnwrap(model.ridePriceQuote(for: bolt))

        XCTAssertEqual(quote.grossMinorUnits, 520)
        XCTAssertEqual(quote.totalMinorUnits, 210)
        XCTAssertEqual(quote.chargedUnlockFeeMinorUnits, 0)
        XCTAssertEqual(quote.billedMinutes, 5)
        XCTAssertEqual(quote.freeMinutesApplied, 5)
        XCTAssertTrue(quote.passApplied)
    }

    func testFocusingOnUserClearsSearchedDestinationAndRestoresUserOrigin() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let userLocation = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let destination = MapDestination(
            title: "Bellevue",
            point: GeoPoint(latitude: 47.3665, longitude: 8.5451)
        )
        model.userLocation = userLocation
        model.focusOnAddress(destination)

        model.focusOnUser()

        XCTAssertNil(model.searchedDestination)
        XCTAssertEqual(model.activeOrigin, .userLocation(userLocation))
        XCTAssertEqual(model.focusRequest?.point, userLocation)
    }

    private func makeModel(api: any ScooterAPIClient) -> ScooterMapModel {
        ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: isolatedDefaults()
        )
    }

    private func loadedModel(
        vehicles: [Scooter],
        origin: GeoPoint
    ) async -> ScooterMapModel {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: vehicles)))
        model.userLocation = origin
        model.refresh()
        let loadingFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loadingFinished)
        return model
    }

    private func scooter(
        id: String,
        provider: String,
        latitude: Double = 47.3769,
        longitude: Double = 8.5417,
        battery: Int? = 80,
        rangeMeters: Int? = nil,
        rentalURIs: ScooterRentalURIs? = nil
    ) -> Scooter {
        Scooter(
            provider: provider,
            latitude: latitude,
            longitude: longitude,
            battery: battery,
            rangeMeters: rangeMeters,
            vehicleID: id,
            deepLink: nil,
            rentalURIs: rentalURIs,
            distanceMeters: 0
        )
    }

    private func isolatedDefaults() -> UserDefaults {
        let suiteName = "SwissScootersTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    private func waitUntil(
        attempts: Int = 200,
        condition: @escaping () async -> Bool
    ) async -> Bool {
        for _ in 0 ..< attempts {
            if await condition() {
                return true
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return false
    }
}

private actor StubScooterAPI: ScooterAPIClient {
    private var response: ScooterResponse
    private var failure: ScooterAPIError?
    private let delaysFirstRequest: Bool
    private var calls = 0
    private var cancellations = 0
    private var lastZoom: Int?
    private var lastMinimumBattery: Int?

    init(response: ScooterResponse, delaysFirstRequest: Bool = false) {
        self.response = response
        self.delaysFirstRequest = delaysFirstRequest
    }

    func scooters(bounds: GeoBounds, zoom: Int, minimumBattery: Int) async throws -> ScooterResponse {
        _ = bounds
        calls += 1
        lastZoom = zoom
        lastMinimumBattery = minimumBattery
        if delaysFirstRequest, calls == 1 {
            do {
                try await Task.sleep(for: .seconds(30))
            } catch {
                cancellations += 1
                throw error
            }
        }
        if let failure { throw failure }
        return response
    }

    func setResponse(_ response: ScooterResponse) {
        self.response = response
    }

    func setFailure(_ failure: ScooterAPIError?) {
        self.failure = failure
    }

    func snapshot() -> (
        calls: Int,
        cancellations: Int,
        lastZoom: Int?,
        lastMinimumBattery: Int?
    ) {
        (calls, cancellations, lastZoom, lastMinimumBattery)
    }
}

extension ScooterMapModelTests {
    func testReturningToLoadedAreaDiscardsPendingOtherArea() async throws {
        let api = DelayedSecondAPI()
        let model = makeModel(api: api)
        let a = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 47.377, longitude: 8.542), span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))
        let b = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 45.75, longitude: 4.85), span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))
        model.updateViewport(a, zoom: 16)
        let aLoaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(aLoaded)
        XCTAssertEqual(model.visibleCount, 1)
        model.updateViewport(b, zoom: 16)
        let bRequested = await waitUntil { await api.callCount() == 2 }
        XCTAssertTrue(bRequested)
        model.updateViewport(a, zoom: 16)
        try await Task.sleep(for: .milliseconds(650))
        XCTAssertEqual(model.viewport, GeoBounds(region: a))
        XCTAssertEqual(model.visibleCount, 1, "Returning to cached A must not let pending B erase A's scooter")
        XCTAssertEqual(model.mapScooters.first?.latitude, 47.377)
    }

    func testUnsolicitedNetworkCancellationClearsLoading() async throws {
        let model = makeModel(api: CancelledAPI())
        model.refresh()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(model.isLoading, "A cancelled URLSession request should clear loading and pending state")
        model.autoRefreshIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(model.isLoading)
    }
}

private actor DelayedSecondAPI: ScooterAPIClient {
    private var calls = 0
    func callCount() -> Int { calls }
    func scooters(bounds: GeoBounds, zoom: Int, minimumBattery: Int) async throws -> ScooterResponse {
        calls += 1
        let second = calls == 2
        if second { try await Task.sleep(for: .milliseconds(500)) }
        return ScooterResponse(vehicles: [Scooter(provider: "lime", latitude: second ? 45.75 : 47.377, longitude: second ? 4.85 : 8.542, battery: 80, rangeMeters: nil, vehicleID: second ? "B" : "A", deepLink: nil, rentalURIs: nil, distanceMeters: nil)])
    }
}

private actor CancelledAPI: ScooterAPIClient {
    func scooters(bounds: GeoBounds, zoom: Int, minimumBattery: Int) async throws -> ScooterResponse { throw CancellationError() }
}


/// Holds a request until the test releases it, optionally with a failure.
private actor HeldScooterAPI: ScooterAPIClient {
    private let response: ScooterResponse
    private var calls = 0
    private var holdsNextRequest = false
    private var held: CheckedContinuation<Void, Never>?
    private var heldFailure: ScooterAPIError?

    init(response: ScooterResponse) {
        self.response = response
    }

    var isHolding: Bool { held != nil }

    func callCount() -> Int { calls }

    func holdNextRequest() {
        holdsNextRequest = true
    }

    func release(failing failure: ScooterAPIError? = nil) {
        heldFailure = failure
        held?.resume()
        held = nil
    }

    func scooters(bounds: GeoBounds, zoom: Int, minimumBattery: Int) async throws -> ScooterResponse {
        calls += 1
        if holdsNextRequest {
            holdsNextRequest = false
            await withCheckedContinuation { held = $0 }
            if let heldFailure {
                self.heldFailure = nil
                throw heldFailure
            }
        }
        return response
    }
}

private final class TestClock {
    var now = Date(timeIntervalSince1970: 1_790_000_000)

    func advance(_ seconds: TimeInterval) {
        now = now.addingTimeInterval(seconds)
    }
}

private final class StubLocationManager: CLLocationManager {
    /// Tests change it to answer the permission prompt.
    var status: CLAuthorizationStatus

    init(status: CLAuthorizationStatus) {
        self.status = status
        super.init()
    }

    override var authorizationStatus: CLAuthorizationStatus { status }
    override var location: CLLocation? { nil }
    override func requestWhenInUseAuthorization() {}
    override func startUpdatingLocation() {}
    override func startUpdatingHeading() {}
    override func stopUpdatingHeading() {}
}

// Freshness, refresh and failures.
extension ScooterMapModelTests {
    func testFirstLoadFailureIsReportedWithItsReasonWhileTheDockWaits() async {
        let api = StubScooterAPI(response: ScooterResponse(vehicles: []))
        await api.setFailure(.httpStatus(503))
        let model = makeModel(api: api)

        XCTAssertEqual(model.dock, .finding(chips: []))

        model.refresh()
        let failed = await waitUntil { model.loadIssue != nil && !model.isLoading }

        XCTAssertTrue(failed)
        XCTAssertEqual(model.loadIssue, .firstLoadFailed(.unavailable))
        XCTAssertEqual(model.dock, .waiting)
        XCTAssertNil(model.lastUpdated)

        await api.setFailure(nil)
        model.retryLoad()
        let recovered = await waitUntil { model.loadIssue == nil && model.lastUpdated != nil }

        XCTAssertTrue(recovered)
        guard case .summary = model.dock else { return XCTFail("Expected the dock summary") }
    }

    func testFailedRefreshKeepsValidDataAndNamesTheTimeStillShown() async throws {
        let clock = TestClock()
        let api = StubScooterAPI(response: timedResponse(generatedAt: clock.now, expiresIn: 300))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        let shownAt = try XCTUnwrap(model.lastUpdated)
        let revision = model.mapScootersRevision

        await api.setFailure(.offline)
        clock.advance(61)
        model.autoRefreshIfNeeded()
        let failed = await waitUntil { model.loadIssue != nil && !model.isLoading }

        XCTAssertTrue(failed)
        XCTAssertEqual(model.loadIssue, .refreshFailed(.offline, showing: shownAt))
        XCTAssertEqual(model.mapScooters.count, 1)
        XCTAssertEqual(model.mapScootersRevision, revision, "Markers stay exactly as they are")
        guard case let .summary(offline) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(offline.status(at: clock.now), .offline(showing: shownAt))
        XCTAssertTrue(offline.status(at: clock.now).isWarning)
        XCTAssertTrue(offline.showsTryAgain)
        XCTAssertEqual(offline.count, 1)

        await api.setFailure(.timedOut)
        model.retryLoad()
        let failedAgain = await waitUntil {
            model.loadIssue == .refreshFailed(.timeout, showing: shownAt) && !model.isLoading
        }

        XCTAssertTrue(failedAgain)
        guard case let .summary(timedOut) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(timedOut.status(at: clock.now), .refreshFailed(showing: shownAt))

        await api.setFailure(nil)
        model.retryLoad()
        let recovered = await waitUntil { model.loadIssue == nil && !model.isLoading }

        XCTAssertTrue(recovered)
        guard case let .summary(healthy) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertFalse(healthy.showsTryAgain)
        XCTAssertFalse(healthy.status(at: clock.now).isWarning)
    }

    func testExpiredDataIsClearedOnlyWhenTheRefreshThatFollowsFails() async throws {
        let clock = TestClock()
        let generatedAt = clock.now
        let api = StubScooterAPI(response: timedResponse(generatedAt: generatedAt, expiresIn: 60))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.selectScooter(try XCTUnwrap(model.mapScooters.first?.id))

        // Passing the expiry clears nothing by itself.
        clock.advance(61)
        XCTAssertEqual(model.mapScooters.count, 1)
        XCTAssertNotNil(model.selectedScooter)
        XCTAssertNil(model.loadIssue)

        await api.setFailure(.timedOut)
        model.autoRefreshIfNeeded()
        let expired = await waitUntil { model.loadIssue != nil && !model.isLoading }

        XCTAssertTrue(expired)
        XCTAssertEqual(model.loadIssue, .outOfDate(.timeout, lastUpdate: generatedAt))
        XCTAssertTrue(model.mapScooters.isEmpty)
        XCTAssertNil(model.selectedScooterID)
        XCTAssertEqual(model.lastUpdated, generatedAt)
        XCTAssertEqual(model.dock, .outOfDate(.timeout, lastUpdate: generatedAt))

        // The reason follows the latest attempt; the last update does not move.
        await api.setFailure(.offline)
        model.retryLoad()
        let stillOutOfDate = await waitUntil {
            model.loadIssue == .outOfDate(.offline, lastUpdate: generatedAt) && !model.isLoading
        }
        XCTAssertTrue(stillOutOfDate)

        await api.setFailure(nil)
        model.retryLoad()
        let recovered = await waitUntil { model.loadIssue == nil && !model.isLoading }

        XCTAssertTrue(recovered)
        XCTAssertEqual(model.mapScooters.count, 1)
        guard case .summary = model.dock else { return XCTFail("Expected the dock summary") }
    }

    func testResponseIsNeverAnErrorBecauseOfItsOwnTimestamps() async {
        let clock = TestClock()
        // Observed six minutes ago, so it arrives already past its own expiry.
        let api = StubScooterAPI(response: timedResponse(
            generatedAt: clock.now.addingTimeInterval(-360),
            expiresIn: 300
        ))
        let model = makeModel(api: api, clock: clock)

        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        XCTAssertNil(model.loadIssue)
        XCTAssertEqual(model.mapScooters.count, 1)
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.status(at: clock.now), .updatedMinutesAgo(6))

        // The next attempt follows as soon as the gap between attempts allows.
        clock.advance(9)
        model.autoRefreshIfNeeded()
        await settle()
        var calls = await api.snapshot().calls
        XCTAssertEqual(calls, 1)

        clock.advance(1)
        model.autoRefreshIfNeeded()
        let refreshed = await waitUntil { await api.snapshot().calls == 2 && !model.isLoading }

        XCTAssertTrue(refreshed)
        calls = await api.snapshot().calls
        XCTAssertEqual(calls, 2)
        XCTAssertNil(model.loadIssue)
        XCTAssertEqual(model.mapScooters.count, 1)
    }

    func testAutomaticRefreshWaitsForTheIntervalOrTheApproachingExpiry() async {
        let clock = TestClock()
        let api = StubScooterAPI(response: timedResponse(generatedAt: clock.now, expiresIn: 300))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        clock.advance(59)
        model.autoRefreshIfNeeded()
        await settle()
        var calls = await api.snapshot().calls
        XCTAssertEqual(calls, 1)

        clock.advance(1)
        model.autoRefreshIfNeeded()
        let refreshedAfterInterval = await waitUntil { await api.snapshot().calls == 2 && !model.isLoading }
        XCTAssertTrue(refreshedAfterInterval)

        // Data that expires sooner is refreshed five seconds before it does.
        await api.setResponse(timedResponse(generatedAt: clock.now, expiresIn: 40))
        model.refresh()
        let reloaded = await waitUntil { await api.snapshot().calls == 3 && !model.isLoading }
        XCTAssertTrue(reloaded)

        clock.advance(34)
        model.autoRefreshIfNeeded()
        await settle()
        calls = await api.snapshot().calls
        XCTAssertEqual(calls, 3)

        clock.advance(1)
        model.autoRefreshIfNeeded()
        let refreshedBeforeExpiry = await waitUntil { await api.snapshot().calls == 4 && !model.isLoading }
        XCTAssertTrue(refreshedBeforeExpiry)
    }

    func testAutomaticRetriesKeepTenSecondsBetweenAttempts() async {
        let clock = TestClock()
        let api = StubScooterAPI(response: ScooterResponse(vehicles: []))
        await api.setFailure(.httpStatus(429))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let failed = await waitUntil { model.loadIssue == .firstLoadFailed(.busy) && !model.isLoading }
        XCTAssertTrue(failed)

        clock.advance(9)
        model.autoRefreshIfNeeded()
        await settle()
        let calls = await api.snapshot().calls
        XCTAssertEqual(calls, 1)

        clock.advance(1)
        model.autoRefreshIfNeeded()
        let retried = await waitUntil { await api.snapshot().calls == 2 && !model.isLoading }
        XCTAssertTrue(retried)
    }

    func testReturningToTheForegroundRefreshesAtOnceWhenARefreshIsDue() async {
        let clock = TestClock()
        let api = StubScooterAPI(response: timedResponse(generatedAt: clock.now, expiresIn: 300))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        // Nothing refreshes while the app is in the background.
        model.becameInactive()
        clock.advance(61)
        model.autoRefreshIfNeeded()
        await settle()
        let calls = await api.snapshot().calls
        XCTAssertEqual(calls, 1)

        await api.setFailure(.offline)
        model.becameActive()
        let refreshedOnReturn = await waitUntil { await api.snapshot().calls == 2 && !model.isLoading }

        XCTAssertTrue(refreshedOnReturn)
        XCTAssertEqual(model.mapScooters.count, 1, "The old data stays until it has expired")

        // A return to the foreground does not wait for the gap between attempts.
        model.becameInactive()
        clock.advance(2)
        model.becameActive()
        let retriedOnReturn = await waitUntil { await api.snapshot().calls == 3 && !model.isLoading }
        XCTAssertTrue(retriedOnReturn)

        // Nothing is due right after a successful load.
        await api.setFailure(nil)
        model.retryLoad()
        let recovered = await waitUntil { await api.snapshot().calls == 4 && model.loadIssue == nil && !model.isLoading }
        XCTAssertTrue(recovered)
        model.becameInactive()
        clock.advance(30)
        model.becameActive()
        await settle()
        let callsAfterEarlyReturn = await api.snapshot().calls
        XCTAssertEqual(callsAfterEarlyReturn, 4)
    }

    func testExpiryWaitsForTheRequestInFlightBeforeAnythingIsCleared() async {
        let clock = TestClock()
        let generatedAt = clock.now
        let api = HeldScooterAPI(response: timedResponse(generatedAt: generatedAt, expiresIn: 60))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        await api.holdNextRequest()
        clock.advance(56)
        model.autoRefreshIfNeeded()
        let inFlight = await waitUntil { await api.isHolding }
        XCTAssertTrue(inFlight)

        // The data expires while that request is still out: no second request, nothing cleared.
        clock.advance(5)
        model.autoRefreshIfNeeded()
        await settle()
        let calls = await api.callCount()
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(model.mapScooters.count, 1)
        XCTAssertNil(model.loadIssue)

        await api.release(failing: .offline)
        let cleared = await waitUntil { model.loadIssue != nil && !model.isLoading }

        XCTAssertTrue(cleared)
        XCTAssertEqual(model.loadIssue, .outOfDate(.offline, lastUpdate: generatedAt))
        XCTAssertTrue(model.mapScooters.isEmpty)
    }

    func testModelRetriesByItselfWhileActiveAndWaitsWhileInTheBackground() async {
        let api = StubScooterAPI(response: ScooterResponse(vehicles: [scooter(id: "one", provider: "lime")]))
        await api.setFailure(.timedOut)
        let model = ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: isolatedDefaults(),
            refreshPolicy: ScooterRefreshPolicy(minimumAttemptGap: 0.05)
        )

        // Nothing nudges the model: it keeps trying on its own.
        model.refresh()
        let retried = await waitUntil { await api.snapshot().calls >= 3 }
        XCTAssertTrue(retried)
        XCTAssertEqual(model.loadIssue, .firstLoadFailed(.timeout))

        // In the background it stops.
        model.becameInactive()
        await settle()
        let callsInBackground = await api.snapshot().calls
        try? await Task.sleep(for: .milliseconds(200))
        let callsLater = await api.snapshot().calls
        XCTAssertEqual(callsLater, callsInBackground)

        // Back in the foreground it tries at once, and a success ends the retries.
        await api.setFailure(nil)
        model.becameActive()
        let recovered = await waitUntil { model.loadIssue == nil && model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(recovered)
        XCTAssertEqual(model.mapScooters.count, 1)
        let callsAfterRecovery = await api.snapshot().calls
        XCTAssertEqual(callsAfterRecovery, callsLater + 1)
        try? await Task.sleep(for: .milliseconds(200))
        let callsAtRest = await api.snapshot().calls
        XCTAssertEqual(callsAtRest, callsAfterRecovery)
    }

    func testParkingExpiresOnItsOwnScheduleWhileScootersStay() async {
        let clock = TestClock()
        let bay = ScooterParking(id: "bay", provider: "lime", name: "Bay",
            latitude: 47.3769, longitude: 8.5417, mandatory: true)
        let api = StubScooterAPI(response: timedResponse(
            generatedAt: clock.now, expiresIn: 60, parking: [bay], parkingExpiresIn: 120
        ))
        let model = makeModel(api: api, clock: clock)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.selectParking(bay.id)
        XCTAssertEqual(model.selectedParking, bay)

        clock.advance(119)
        model.expireParkingIfNeeded()
        XCTAssertEqual(model.parking, [bay])
        XCTAssertEqual(model.mapScooters.count, 1)

        clock.advance(2)
        model.expireParkingIfNeeded()
        XCTAssertTrue(model.parking.isEmpty)
        XCTAssertNil(model.selectedParkingID)
        XCTAssertEqual(model.mapScooters.count, 1)
        XCTAssertNil(model.loadIssue)
    }
}

// Provider health and the dock.
extension ScooterMapModelTests {
    func testDownProvidersAreNamedOnlyWhereTheyOperateAndLeadTheChips() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [
                scooter(id: "voi", provider: "voi"),
                scooter(id: "lime-one", provider: "lime"),
                scooter(id: "lime-two", provider: "lime")
            ],
            meta: ScooterResponseMetadata(
                partial: true,
                failedSources: ["bird_zurich", "pony_fr_angers", "city-overview"]
            )
        ))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        XCTAssertEqual(
            model.providerHealth,
            ScooterProviderHealth(downProviders: [.bird], hasUnknownFailures: true)
        )
        XCTAssertEqual(model.dockNotices, [.providersDown([.bird])])

        let chips = model.dockChips
        XCTAssertEqual(chips.prefix(3).map(\.provider), [.bird, .lime, .voi])
        XCTAssertEqual(chips.dropFirst(3).map(\.provider), [.bolt, .dott, .hopp, .publibike])
        XCTAssertEqual(chips.filter(\.isDown).map(\.provider), [.bird])
        XCTAssertEqual(chips[0].count, 0)
        XCTAssertFalse(chips[0].downLabel.isEmpty)
        XCTAssertEqual(chips[1].count, 2)

        // A chip that is down is never drawn as selected.
        model.showProviders([.bird, .lime])
        XCTAssertEqual(model.dockChips.filter(\.isSelected).map(\.provider), [.lime])
        XCTAssertEqual(model.dockChips.filter(\.isEnabled).map(\.provider), [.bird, .lime])

        // The filter sheet lists the same providers in catalogue order.
        XCTAssertEqual(model.filterProviders.map(\.provider), model.availableProviders)
        XCTAssertEqual(model.filterProviders.filter(\.isDown).map(\.provider), [.bird])
        XCTAssertEqual(model.filterProviders.filter(\.isEnabled).map(\.provider), [.bird, .lime])
    }

    /// Where one provider is the only one, the server answers its outage with an
    /// empty list and the failed feed, not with an error of its own.
    func testTheOnlyProviderOfACityBeingDownIsNamedInsteadOfBlamingScooters() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["france:dott_fr_lyon"])
        ))
        let model = makeModel(api: api)
        let lyon = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 45.7578, longitude: 4.832),
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )
        model.updateViewport(lyon, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        XCTAssertEqual(model.availableProviders, [.dott])
        XCTAssertNil(model.loadIssue)
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.count, 0)
        XCTAssertNil(summary.refreshFailure)
        XCTAssertEqual(summary.notices, [.providersDown([.dott])])
        XCTAssertEqual(summary.chips.map(\.provider), [.dott])
        XCTAssertEqual(summary.chips.map(\.isDown), [true])
        XCTAssertEqual(model.filterProviders.map(\.isDown), [true])
    }

    func testProviderWithAFailedFeedAndScootersInViewIsNotReportedAsDown() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime", battery: 40)],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["national:lime_winterthur"])
        ))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        XCTAssertEqual(model.providerHealth, .healthy)
        XCTAssertEqual(model.dockNotices, [])
        XCTAssertTrue(model.dockChips.allSatisfy { !$0.isDown })
        XCTAssertEqual(model.dockChips.first?.provider, .lime)

        // The rider's own filters hide Lime's scooter; they do not make Lime look down.
        model.setMinimumBattery(60)
        model.showProviders([.voi])
        XCTAssertEqual(model.count(for: .lime), 0)
        XCTAssertEqual(model.providerHealth, .healthy)
        XCTAssertEqual(model.dockNotices, [])
        XCTAssertTrue(model.filterProviders.allSatisfy { !$0.isDown })
    }

    func testCityTotalsNameNoProviderAsDown() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            clusters: [ScooterCluster(id: "city:ch:zurich", latitude: 47.38, longitude: 8.54,
                count: 100, providers: ["lime": 100], city: "Zürich")],
            meta: ScooterResponseMetadata(partial: true,
                failedSources: ["national:bird_zurich", "france:dott_fr_lyon", "city-overview"],
                mode: "clusters", zoom: 8, overview: true, refreshAfterSeconds: 3_600)
        ))
        let model = makeModel(api: api)

        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        // Bird operates in view and shows nothing, yet one failed city feed says little about a country.
        XCTAssertTrue(model.availableProviders.contains(.bird))
        XCTAssertEqual(model.count(for: .bird), 0)
        XCTAssertEqual(model.providerHealth, .healthy)
        XCTAssertEqual(model.dockNotices, [])
        XCTAssertTrue(model.dockChips.allSatisfy { !$0.isDown })
        XCTAssertTrue(model.filterProviders.allSatisfy { !$0.isDown })
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.notices, [])
    }

    func testProvidersAreNotReportedAsDownWhereTheDataHasNotLoadedYet() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime")],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["national:bird_zurich"])
        ))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        XCTAssertEqual(model.providerHealth.downProviders, [.bird])

        // Bern is covered too, but what failed around Zürich says nothing about it.
        model.viewport = GeoBounds(south: 46.94, west: 7.43, north: 46.96, east: 7.46)
        XCTAssertTrue(model.availableProviders.contains(.bird))
        XCTAssertEqual(model.providerHealth, .healthy)
        XCTAssertTrue(model.dockChips.allSatisfy { !$0.isDown })
    }

    func testNoProviderIsNamedAsDownWhereTheServerLeftOutLowBatteries() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            clusters: [ScooterCluster(id: "13:4290:2868", latitude: 47.3769, longitude: 8.5417,
                count: 40, providers: ["lime": 40])],
            meta: ScooterResponseMetadata(partial: true,
                failedSources: ["national:bird_zurich", "city-overview"], mode: "clusters", zoom: 13)
        ))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 13)
        var loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        // Clusters count every scooter: Bird has none here, so it is down.
        XCTAssertEqual(
            model.providerHealth,
            ScooterProviderHealth(downProviders: [.bird], hasUnknownFailures: true)
        )

        // With a minimum, the server leaves the scooters under it out of the clusters,
        // which can no longer tell an absent provider from one whose scooters are low.
        model.setMinimumBattery(60)
        loaded = await waitUntil {
            let snapshot = await api.snapshot()
            return snapshot.calls == 2 && !model.isLoading
        }
        XCTAssertTrue(loaded)
        let clustered = await api.snapshot()
        XCTAssertEqual(clustered.lastMinimumBattery, 60)
        XCTAssertEqual(model.providerHealth, .healthy)
        XCTAssertEqual(model.dockNotices, [])
        XCTAssertTrue(model.dockChips.allSatisfy { !$0.isDown })
        XCTAssertTrue(model.filterProviders.allSatisfy { !$0.isDown })

        // At street level the app applies the minimum itself, so it knows again.
        await api.setResponse(ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime", battery: 40)],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["national:bird_zurich"])
        ))
        model.updateViewport(zurichRegion, zoom: 16)
        loaded = await waitUntil {
            let snapshot = await api.snapshot()
            return snapshot.calls == 3 && !model.isLoading
        }
        XCTAssertTrue(loaded)
        let street = await api.snapshot()
        XCTAssertEqual(street.lastMinimumBattery, 0)
        XCTAssertEqual(model.count(for: .lime), 0)
        XCTAssertEqual(model.providerHealth.downProviders, [.bird])
        XCTAssertEqual(model.dockChips.filter(\.isDown).map(\.provider), [.bird])
    }

    func testDockCountsScootersNearbyWhileTheOriginIsOnScreen() async throws {
        let origin = GeoPoint(latitude: 47.3769, longitude: 8.5417)
        let model = await loadedModel(vehicles: [scooter(id: "one", provider: "lime")], origin: origin)
        let lastUpdated = try XCTUnwrap(model.lastUpdated)

        guard case let .summary(nearby) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(nearby.count, 1)
        XCTAssertEqual(nearby.countContext, .nearby)
        XCTAssertEqual(nearby.countLabel, String(localized: "scooter nearby"))
        XCTAssertEqual(nearby.status(at: lastUpdated.addingTimeInterval(30)), .live)
        XCTAssertNil(nearby.hint)
        XCTAssertFalse(nearby.showsTryAgain)

        // A chosen place takes over as the origin, and this one is off screen.
        model.focusOnAddress(MapDestination(
            title: "Berlin",
            point: GeoPoint(latitude: 52.52, longitude: 13.405)
        ))
        guard case let .summary(elsewhere) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(elsewhere.countContext, .onThisMap)
        XCTAssertEqual(elsewhere.countLabel, String(localized: "scooter on this map"))

        model.clearAddressSearch()
        guard case let .summary(nearbyAgain) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(nearbyAgain.countContext, .nearby)

        model.userLocation = nil
        guard case let .summary(withoutOrigin) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(withoutOrigin.countContext, .onThisMap)
    }

    func testCityTotalsShowTheirOwnStatusAndHint() async {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            clusters: [ScooterCluster(id: "city:ch:zurich", latitude: 47.38, longitude: 8.54,
                count: 100, providers: ["lime": 80, "bird": 20], city: "Zürich")],
            meta: ScooterResponseMetadata(partial: false, failedSources: [],
                mode: "clusters", zoom: 8, overview: true, refreshAfterSeconds: 3_600)
        ))
        let model = makeModel(api: api)

        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.count, 100)
        XCTAssertEqual(summary.status(at: .distantFuture), .cityTotals)
        XCTAssertEqual(summary.hint, .tapCity)
        XCTAssertEqual(summary.chips.prefix(2).map(\.provider), [.lime, .bird])
    }

    func testDelayedCityTotalsSayTheyAreDelayed() async throws {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [],
            clusters: [ScooterCluster(id: "city:ch:zurich", latitude: 47.38, longitude: 8.54,
                count: 100, providers: ["lime": 100], city: "Zürich")],
            meta: ScooterResponseMetadata(partial: false, stale: true, failedSources: [],
                mode: "clusters", zoom: 8, overview: true, refreshAfterSeconds: 3_600)
        ))
        let model = makeModel(api: api)

        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        let lastUpdated = try XCTUnwrap(model.lastUpdated)
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.status(at: .distantFuture), .delayed(showing: lastUpdated))
        XCTAssertEqual(summary.hint, .tapCity)
    }

    func testDelayedDataSaysWhichTimeItShows() async throws {
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [scooter(id: "one", provider: "lime")],
            meta: ScooterResponseMetadata(partial: false, stale: true, failedSources: [])
        ))
        let model = makeModel(api: api)

        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        let lastUpdated = try XCTUnwrap(model.lastUpdated)
        guard case let .summary(summary) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(summary.status(at: lastUpdated), .delayed(showing: lastUpdated))
        XCTAssertFalse(summary.showsTryAgain)
    }

    func testOutsideCoverageOffersTheThreeClosestCities() async {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))

        model.updateViewport(lungernRegion, zoom: 14)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }

        XCTAssertTrue(loaded)
        XCTAssertTrue(model.availableProviders.isEmpty)
        guard case let .outsideCoverage(cities) = model.dock else {
            return XCTFail("Expected the outside-coverage card")
        }
        XCTAssertEqual(cities.map(\.city.name), ["Zug", "Bern", "Grenchen"])
        XCTAssertEqual(cities.map { Int(($0.distanceMeters / 1_000).rounded()) }, [52, 57, 73])
        XCTAssertEqual(cities, model.closestCities)

        // A chip flies to the city; it does not become the chosen place.
        model.focusOnCity(cities[1].city)
        XCTAssertEqual(model.focusRequest?.point, cities[1].city.center)
        XCTAssertNil(model.searchedDestination)
        XCTAssertTrue(model.recentPlaces.isEmpty)
    }

    func testFiltersThatHideEverythingReportWhatIsHidden() async {
        let api = StubScooterAPI(response: ScooterResponse(vehicles: [
            scooter(id: "lime-low", provider: "lime", battery: 40),
            scooter(id: "lime-high", provider: "lime", battery: 90),
            scooter(id: "bird", provider: "bird", battery: 70)
        ]))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        XCTAssertEqual(model.showResultsTitle, ScooterFiltering.showResultsTitle(count: 3))

        model.showProviders([.voi])
        XCTAssertEqual(model.dock, .filtersHideEverything(ScooterFilterSummary(
            hiddenCount: 3, providers: [.voi], minimumBattery: nil
        )))

        model.showProviders([.bird])
        model.setMinimumBattery(80)
        guard case let .filtersHideEverything(summary) = model.dock else {
            return XCTFail("Expected the hidden-by-filters card")
        }
        XCTAssertEqual(summary, ScooterFilterSummary(hiddenCount: 3, providers: [.bird], minimumBattery: 80))
        XCTAssertEqual(summary.parts.count, 2)
        XCTAssertEqual(model.showResultsTitle, ScooterFiltering.showResultsTitle(count: 0))

        model.resetFilters()
        guard case let .summary(all) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(all.count, 3)
        XCTAssertNil(all.hint)

        // A list the server cut short cannot say how many scooters are here.
        await api.setResponse(ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime")],
            meta: ScooterResponseMetadata(partial: false, failedSources: [], truncated: true, totalVehicles: 4_000)
        ))
        model.refresh()
        let reloaded = await waitUntil { model.responseMetadata?.truncated == true && !model.isLoading }
        XCTAssertTrue(reloaded)
        model.showProviders([.voi])
        XCTAssertEqual(model.dock, .filtersHideEverything(ScooterFilterSummary(
            hiddenCount: nil, providers: [.voi], minimumBattery: nil
        )))
    }

    func testClusteredBatteryFilterCannotCountWhatItHides() async {
        let cluster = ScooterCluster(id: "12:1:1", latitude: 47.3769, longitude: 8.5417,
            count: 10, providers: ["lime": 10])
        let meta = ScooterResponseMetadata(partial: false, failedSources: [], mode: "clusters", zoom: 12)
        let api = StubScooterAPI(response: ScooterResponse(vehicles: [], clusters: [cluster], meta: meta))
        let model = makeModel(api: api)
        model.updateViewport(zurichRegion, zoom: 12)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        XCTAssertEqual(model.visibleCount, 10)

        // Only the provider filter is active, so every scooter here is known.
        model.showProviders([.voi])
        XCTAssertEqual(model.dock, .filtersHideEverything(ScooterFilterSummary(
            hiddenCount: 10, providers: [.voi], minimumBattery: nil
        )))
        model.showAllProviders()

        await api.setResponse(ScooterResponse(vehicles: [], meta: meta))
        model.setMinimumBattery(80)
        let filtered = await waitUntil { await api.snapshot().calls == 2 && !model.isLoading }

        XCTAssertTrue(filtered)
        let summary = ScooterFilterSummary(hiddenCount: nil, providers: [], minimumBattery: 80)
        XCTAssertEqual(model.dock, .filtersHideEverything(summary))
        XCTAssertEqual(summary.title, String(localized: "No scooters match your filters here"))
        XCTAssertEqual(summary.showAllTitle, String(localized: "Show all"))
    }

    func testEmptyCoveredAreaSaysSoOnlyOnceItsDataHasLoaded() async {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        guard case let .summary(empty) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(empty.count, 0)
        XCTAssertEqual(empty.hint, .emptyArea)
        XCTAssertEqual(empty.countContext, .onThisMap)
        XCTAssertFalse(empty.chips.isEmpty)

        // Filters that would hide nothing here are not blamed for the empty map.
        model.showProviders([.voi])
        guard case let .summary(filtered) = model.dock else { return XCTFail("Expected the dock summary") }
        XCTAssertEqual(filtered.hint, .emptyArea)
        model.showAllProviders()

        // Another covered area whose data has not arrived yet has no count to show.
        model.viewport = GeoBounds(south: 46.94, west: 7.43, north: 46.96, east: 7.46)
        XCTAssertEqual(model.dock, .finding(chips: model.dockChips))
        XCTAssertFalse(model.dockChips.isEmpty)
    }

    func testSelectingAParkingBayAndAScooterAreMutuallyExclusive() async throws {
        let bay = ScooterParking(id: "lime:bay", provider: "lime", name: "Bay",
            latitude: 47.3769, longitude: 8.5417, mandatory: false)
        let parked = scooter(id: "one", provider: "lime")
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [parked], parking: [bay])))
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        model.selectScooter(parked.id)
        XCTAssertEqual(model.dock, .scooter(parked))

        model.selectParking(bay.id)
        XCTAssertNil(model.selectedScooterID)
        XCTAssertEqual(model.selectedParking, bay)
        XCTAssertEqual(model.dock, .parking(bay))

        model.selectScooter(parked.id)
        XCTAssertNil(model.selectedParkingID)
        XCTAssertEqual(model.dock, .scooter(parked))

        model.selectParking(bay.id)
        model.clearSelection()
        XCTAssertNil(model.selectedParkingID)
        XCTAssertNil(model.selectedScooterID)
        guard case .summary = model.dock else { return XCTFail("Expected the dock summary") }

        // Without an origin the card shows the name alone.
        XCTAssertEqual(model.parkingSubtitle(for: bay), bay.name)
        XCTAssertNil(model.approximateWalkingMinutes(to: bay))
        model.userLocation = GeoPoint(latitude: 47.3779, longitude: 8.5417)
        XCTAssertEqual(model.approximateWalkingMinutes(to: bay), 2)
        XCTAssertTrue(model.parkingSubtitle(for: bay).hasPrefix(bay.name))
        XCTAssertNotEqual(model.parkingSubtitle(for: bay), bay.name)

        // A bay that leaves the map is no longer selected.
        model.selectParking(bay.id)
        model.toggle(provider: .lime)
        XCTAssertNil(model.selectedParkingID)
        XCTAssertNil(model.selectedParking)
    }

    func testWalkingTimesNameTheSearchedPlaceTheyStartFrom() async throws {
        let bay = ScooterParking(id: "lime:bay", provider: "lime", name: "Bay",
            latitude: 47.3769, longitude: 8.5417, mandatory: false)
        let parked = scooter(id: "one", provider: "lime")
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [parked], parking: [bay])))
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        XCTAssertNil(model.walkingSummary(for: parked), "No origin, no walking time")

        let origin = GeoPoint(latitude: 47.3779, longitude: 8.5417)
        model.userLocation = origin
        let distance = try XCTUnwrap(model.formattedDistance(for: parked))
        XCTAssertEqual(
            model.walkingSummary(for: parked),
            String(format: String(localized: "≈%1$lld min walk · %2$@"), Int64(2), distance)
        )

        // A searched place wins over the user's location and is named.
        let place = MapDestination(title: "Zürich HB", point: origin)
        model.searchedDestination = place
        XCTAssertEqual(
            model.walkingSummary(for: parked),
            String(format: String(localized: "≈%1$lld min walk from %2$@ · %3$@"), Int64(2), "Zürich HB", distance)
        )
        XCTAssertEqual(
            model.parkingSubtitle(for: bay),
            String(
                format: String(localized: "%1$@ · %2$@"),
                bay.name,
                String(format: String(localized: "≈%1$lld min walk from %2$@"), Int64(2), "Zürich HB")
            )
        )

        model.clearAddressSearch()
        XCTAssertEqual(
            model.walkingSummary(for: parked),
            String(format: String(localized: "≈%1$lld min walk · %2$@"), Int64(2), distance)
        )
    }

    func testTheCardHeaderCentresTheScooterWithoutChangingTheZoom() async throws {
        let parked = scooter(id: "one", provider: "lime")
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [parked])))
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        model.focusOnScooter(parked)

        let request = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(request.point, GeoPoint(parked.coordinate))
        XCTAssertTrue(request.keepsZoom)
        XCTAssertEqual(model.selectedScooterID, parked.id)
        XCTAssertFalse(MapFocusRequest(point: request.point, token: 1).keepsZoom)
        XCTAssertFalse(MapFocusRequest.city(request.point, token: 1).keepsZoom)
    }

    func testACardReportsAFailedRefreshOrDelayedDataAndNothingWhenHealthy() async throws {
        let clock = TestClock()
        let api = StubScooterAPI(response: timedResponse(generatedAt: clock.now, expiresIn: 300))
        let model = makeModel(api: api, clock: clock)
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        let shownAt = try XCTUnwrap(model.lastUpdated)
        model.selectScooter(try XCTUnwrap(model.mapScooters.first?.id))
        XCTAssertNil(model.cardStatus)

        await api.setFailure(.offline)
        model.retryLoad()
        let failed = await waitUntil { model.loadIssue != nil && !model.isLoading }
        XCTAssertTrue(failed)
        XCTAssertNotNil(model.selectedScooter, "The card stays open over data that is still valid")
        XCTAssertEqual(model.cardStatus, .offline(showing: shownAt))

        await api.setFailure(.httpStatus(503))
        model.retryLoad()
        let failedAgain = await waitUntil {
            model.loadIssue == .refreshFailed(.unavailable, showing: shownAt) && !model.isLoading
        }
        XCTAssertTrue(failedAgain)
        XCTAssertEqual(model.cardStatus, .refreshFailed(showing: shownAt))

        await api.setFailure(nil)
        await api.setResponse(ScooterResponse(
            vehicles: [scooter(id: "one", provider: "lime")],
            meta: ScooterResponseMetadata(partial: false, stale: true, failedSources: [])
        ))
        model.retryLoad()
        let delayed = await waitUntil { model.loadIssue == nil && !model.isLoading }
        XCTAssertTrue(delayed)
        let delayedAt = try XCTUnwrap(model.lastUpdated)
        XCTAssertEqual(model.cardStatus, .delayed(showing: delayedAt))
    }

    func testLocatingFromACardKeepsTheMapAndTheCard() async throws {
        let manager = StubLocationManager(status: .authorizedWhenInUse)
        let parked = scooter(id: "one", provider: "lime")
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [parked])),
            locationManager: manager,
            defaults: isolatedDefaults()
        )
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.selectScooter(parked.id)

        model.locateForWalkingTime()
        XCTAssertTrue(model.isLocating)
        model.locationManager(manager, didUpdateLocations: [CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.3779, longitude: 8.5417),
            altitude: 0,
            horizontalAccuracy: 25,
            verticalAccuracy: 10,
            timestamp: Date()
        )])

        XCTAssertFalse(model.isLocating)
        XCTAssertNil(model.focusRequest, "The map stays where it is")
        XCTAssertEqual(model.selectedScooterID, parked.id)
        XCTAssertNotNil(model.walkingSummary(for: parked))
        XCTAssertTrue(model.hasLocatedOnce)

        // Near me still moves the map.
        model.focusOnUser()
        XCTAssertEqual(model.focusRequest?.latitudinalMeters, ScooterMapModel.userFocusMeters)
    }
}

// Location, search, filters and settings.
extension ScooterMapModelTests {
    func testAnsweringTheLocationPromptSlowlyStillKeepsTheMapAndTheCard() async throws {
        let manager = StubLocationManager(status: .notDetermined)
        let parked = scooter(id: "one", provider: "lime")
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [parked])),
            locationManager: manager,
            defaults: isolatedDefaults(),
            locationTimeout: .milliseconds(50)
        )
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.selectScooter(parked.id)

        // The prompt stays open three times longer than a fix may take.
        model.locateForWalkingTime()
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(model.isLocating)
        XCTAssertNil(model.locationIssue)

        manager.status = .authorizedWhenInUse
        model.locationManagerDidChangeAuthorization(manager)
        XCTAssertTrue(model.isLocating)
        model.locationManager(manager, didUpdateLocations: [zurichFix])

        XCTAssertFalse(model.isLocating)
        XCTAssertNil(model.focusRequest, "The map stays where it is")
        XCTAssertEqual(model.selectedScooterID, parked.id)
        XCTAssertNotNil(model.walkingSummary(for: parked))

        // Once allowed, a fix that does not come in time is still reported.
        let slowManager = StubLocationManager(status: .notDetermined)
        let slow = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: slowManager,
            defaults: isolatedDefaults(),
            locationTimeout: .milliseconds(50)
        )
        slow.focusOnUser()
        slowManager.status = .authorizedWhenInUse
        slow.locationManagerDidChangeAuthorization(slowManager)
        let timedOut = await waitUntil { slow.locationIssue == .notFound }
        XCTAssertTrue(timedOut)
        XCTAssertFalse(slow.isLocating)
    }

    func testLocatingWithoutAFixInTimeReportsNotFoundUntilDismissedOrRetried() async {
        let manager = StubLocationManager(status: .authorizedWhenInUse)
        let defaults = isolatedDefaults()
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: manager,
            defaults: defaults,
            locationTimeout: .milliseconds(50)
        )
        XCTAssertEqual(model.searchBarState, .empty)
        XCTAssertFalse(model.hasLocatedOnce)

        model.focusOnUser()
        XCTAssertTrue(model.isLocating)
        XCTAssertEqual(model.searchBarState, .locating)
        XCTAssertNil(model.locationIssue)

        let timedOut = await waitUntil { model.locationIssue == .notFound }
        XCTAssertTrue(timedOut)
        XCTAssertFalse(model.isLocating)
        XCTAssertFalse(model.hasLocatedOnce)

        model.dismissLocationIssue()
        XCTAssertNil(model.locationIssue)

        // The next attempt starts clean and brings the card back if it fails again.
        model.focusOnUser()
        XCTAssertNil(model.locationIssue)
        let timedOutAgain = await waitUntil { model.locationIssue == .notFound }
        XCTAssertTrue(timedOutAgain)

        model.locationManager(manager, didUpdateLocations: [CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            altitude: 0,
            horizontalAccuracy: 25,
            verticalAccuracy: 10,
            timestamp: Date()
        )])

        XCTAssertNil(model.locationIssue)
        XCTAssertTrue(model.hasLocatedOnce)
        XCTAssertTrue(defaults.bool(forKey: "has-located-once"))
        XCTAssertEqual(model.focusRequest?.latitudinalMeters, 350)
        XCTAssertEqual(model.focusRequest?.longitudinalMeters, 350)
        XCTAssertEqual(model.searchBarState, .nearYou)

        let restored = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: StubLocationManager(status: .denied),
            defaults: defaults
        )
        XCTAssertTrue(restored.hasLocatedOnce)
    }

    func testAPlaceChosenWhileTheFixWasOnItsWayKeepsTheMap() throws {
        let manager = StubLocationManager(status: .authorizedWhenInUse)
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: manager,
            defaults: isolatedDefaults()
        )
        let place = MapDestination(title: "Bern", point: GeoPoint(latitude: 46.948, longitude: 7.4474))
        let viewport = model.viewport

        model.focusOnUser()
        XCTAssertTrue(model.isLocating)
        model.focusOnAddress(place)
        let placeFocus = try XCTUnwrap(model.focusRequest)
        model.locationManager(manager, didUpdateLocations: [zurichFix])

        // The position is known from now on, and nothing moved.
        XCTAssertEqual(model.focusRequest, placeFocus)
        XCTAssertEqual(model.viewport, viewport)
        XCTAssertEqual(model.searchBarState, .place(place))
        XCTAssertEqual(model.activeOrigin, .searchedDestination(place))
        XCTAssertFalse(model.isLocating)
        XCTAssertTrue(model.hasLocatedOnce)
        XCTAssertEqual(model.userLocation, GeoPoint(zurichFix.coordinate))

        model.clearAddressSearch()
        XCTAssertEqual(model.searchBarState, .nearYou)

        // Near me is a new wish and moves the map again.
        model.focusOnUser()
        XCTAssertEqual(model.focusRequest?.point, GeoPoint(zurichFix.coordinate))
    }

    func testAFixThatArrivesAfterNotFoundLeavesAPlaceOrCityChosenMeanwhile() async throws {
        for choosesCity in [false, true] {
            let manager = StubLocationManager(status: .authorizedWhenInUse)
            let model = ScooterMapModel(
                api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
                locationManager: manager,
                defaults: isolatedDefaults(),
                locationTimeout: .milliseconds(50)
            )
            let bern = try XCTUnwrap(ScooterCityCatalog.cities.first { $0.id == "ch:bern" })
            let place = MapDestination(title: "Bundesplatz", point: GeoPoint(latitude: 46.9471, longitude: 7.4441))

            model.focusOnUser()
            let timedOut = await waitUntil { model.locationIssue == .notFound }
            XCTAssertTrue(timedOut)

            // A searched place, or a chip under "Closest cities".
            if choosesCity {
                model.focusOnCity(bern)
            } else {
                model.focusOnAddress(place)
            }
            let chosenFocus = try XCTUnwrap(model.focusRequest)
            let viewport = model.viewport
            model.locationManager(manager, didUpdateLocations: [zurichFix])

            XCTAssertEqual(model.focusRequest, chosenFocus, "city: \(choosesCity)")
            XCTAssertEqual(model.viewport, viewport)
            XCTAssertEqual(model.searchBarState, choosesCity ? .nearYou : .place(place))
            XCTAssertNil(model.locationIssue)
            XCTAssertTrue(model.hasLocatedOnce)

            model.clearAddressSearch()
            XCTAssertEqual(model.searchBarState, .nearYou)
        }
    }

    func testRefusedLocationShowsADismissibleCardUntilTheNextAttempt() {
        let manager = StubLocationManager(status: .denied)
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: manager,
            defaults: isolatedDefaults()
        )

        // Opening the app is not a locate attempt, so nothing is shown.
        model.start()
        model.locationManagerDidChangeAuthorization(manager)
        XCTAssertNil(model.locationIssue)

        model.focusOnUser()
        XCTAssertEqual(model.locationIssue, .denied)
        XCTAssertFalse(model.isLocating)
        XCTAssertEqual(model.searchBarState, .empty)

        model.dismissLocationIssue()
        XCTAssertNil(model.locationIssue)
        model.locationManagerDidChangeAuthorization(manager)
        XCTAssertNil(model.locationIssue, "An unchanged status is not a new attempt")

        model.focusOnUser()
        XCTAssertEqual(model.locationIssue, .denied)

        let restricted = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: StubLocationManager(status: .restricted),
            defaults: isolatedDefaults()
        )
        restricted.focusOnUser()
        XCTAssertEqual(restricted.locationIssue, .restricted)
    }

    func testRecentPlacesKeepTheLastThreeForThisSessionOnly() throws {
        let suiteName = "SwissScootersTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        let model = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )
        let places = ["Zürich HB", "Bellevue", "Paradeplatz", "Stauffacher"].enumerated().map { index, title in
            MapDestination(
                title: title,
                subtitle: "Zürich",
                point: GeoPoint(latitude: 47.37 + Double(index) / 1_000, longitude: 8.54)
            )
        }
        XCTAssertTrue(model.recentPlaces.isEmpty)

        for place in places {
            model.focusOnAddress(place)
        }
        XCTAssertEqual(model.recentPlaces, [places[3], places[2], places[1]])
        XCTAssertEqual(model.searchBarState, .place(places[3]))

        // Choosing a recent place again moves it to the front without repeating it.
        model.focusOnAddress(places[2])
        XCTAssertEqual(model.recentPlaces, [places[2], places[3], places[1]])

        // Clearing the place keeps the list for the rest of the session.
        model.clearAddressSearch()
        XCTAssertEqual(model.searchBarState, .empty)
        XCTAssertEqual(model.recentPlaces.count, 3)

        let stored = defaults.persistentDomain(forName: suiteName) ?? [:]
        XCTAssertFalse(String(describing: stored).contains("Paradeplatz"))
        XCTAssertFalse(String(describing: stored).contains("47.37"))
        let nextSession = ScooterMapModel(
            api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
            locationManager: CLLocationManager(),
            defaults: defaults
        )
        XCTAssertTrue(nextSession.recentPlaces.isEmpty)
        defaults.removePersistentDomain(forName: suiteName)
    }

    func testCitiesWithScootersAreTheSixNearestToTheMapCentre() throws {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))

        let cities = model.nearbyCities
        XCTAssertEqual(
            cities.map(\.city.name),
            ["Zug", "Bern", "Zürich", "Uster", "Wetzikon", "Opfikon"]
        )
        XCTAssertEqual(cities.map(\.distanceMeters), cities.map(\.distanceMeters).sorted())

        // A chip behaves like choosing that city as a place, and shows the whole city.
        let bern = cities[1].city
        model.chooseCity(bern)

        let place = try XCTUnwrap(model.searchedDestination)
        XCTAssertEqual(place, bern.destination)
        XCTAssertEqual(place.title, "Bern")
        XCTAssertEqual(place.kind, .city)
        XCTAssertEqual(model.activeOrigin, .searchedDestination(place))
        XCTAssertEqual(model.recentPlaces, [place])
        let focus = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(focus, .city(bern.center, token: focus.token))
        XCTAssertGreaterThan(focus.latitudinalMeters, 8_000)

        // The list follows the map.
        model.viewport = GeoBounds(south: 47.37, west: 8.53, north: 47.38, east: 8.55)
        XCTAssertEqual(model.nearbyCities.first?.city.name, "Zürich")
        XCTAssertEqual(model.nearbyCities.count, 6)
    }

    func testATypedCoveredCityShowsTheWholeCityLikeItsChip() throws {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        let bulle = try XCTUnwrap(ScooterCityCatalog.cities.first { $0.id == "ch:bulle" })

        // What the address search answers for "Bulle": the catalogue's centre.
        let answer = Data("""
        [{"lat": \(bulle.center.latitude), "lng": \(bulle.center.longitude),
          "display_name": "Bulle, Switzerland", "title": "Bulle", "subtitle": "Suisse", "covered": true}]
        """.utf8)
        let typed = try XCTUnwrap(JSONDecoder().decode([AddressSearchResult].self, from: answer).first)
        XCTAssertEqual(typed.destination.kind, .city)
        XCTAssertEqual(typed.destination.subtitle, "Suisse")

        model.focusOnAddress(typed.destination)
        let typedFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(model.searchedDestination?.title, "Bulle")

        // The same span as the "Cities with scooters" chip.
        model.chooseCity(bulle)
        let chipFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(typedFocus, .city(bulle.center, token: typedFocus.token))
        XCTAssertEqual(typedFocus.latitudinalMeters, chipFocus.latitudinalMeters)
        XCTAssertEqual(typedFocus.longitudinalMeters, chipFocus.longitudinalMeters)

        // An address, a station or a place in the city keeps the street-level view.
        let station = AddressSearchResult(
            latitude: bulle.center.latitude + 0.002, longitude: bulle.center.longitude,
            displayName: "Bulle, gare", title: "Bulle, gare", subtitle: "Train", isCovered: true
        )
        XCTAssertEqual(station.destination.kind, .address)
        model.focusOnAddress(station.destination)
        XCTAssertEqual(model.focusRequest?.latitudinalMeters, 850)
        XCTAssertNil(ScooterCityCatalog.city(centredAt: GeoPoint(latitude: 46.7741, longitude: 8.1558)))
    }

    func testStoredBatteryValuesSnapDownToAPreset() {
        for (stored, expected) in [(45, 30.0), (95, 80.0), (60, 60.0), (10, 0.0), (-5, 0.0)] {
            let defaults = isolatedDefaults()
            defaults.set(stored, forKey: "minimum-battery")

            let model = ScooterMapModel(
                api: StubScooterAPI(response: ScooterResponse(vehicles: [])),
                locationManager: CLLocationManager(),
                defaults: defaults
            )

            XCTAssertEqual(model.minimumBattery, expected, "Stored \(stored)")
        }
    }

    func testPassesListProvidersHereOrWithAPassAndEveryProviderOtherwise() {
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        model.viewport = GeoBounds(region: zurichRegion)
        XCTAssertEqual(model.passProviders, ScooterProvider.allCases.filter { $0 != .pony })

        model.setRidePass(ProviderRidePass(enabled: true, freeMinutes: 10), for: .pony)
        XCTAssertEqual(model.passProviders, ScooterProvider.allCases)

        // Nobody operates here and no pass is set: every provider is offered.
        model.setRidePass(ProviderRidePass(), for: .pony)
        model.viewport = GeoBounds(region: lungernRegion)
        XCTAssertEqual(model.passProviders, ScooterProvider.allCases)

        model.setRidePass(ProviderRidePass(enabled: true, freeUnlock: true), for: .voi)
        XCTAssertEqual(model.passProviders, [.voi])
    }
}

extension ScooterMapModelTests {
    private var zurichRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        )
    }

    /// A good first fix in Zürich.
    private var zurichFix: CLLocation {
        CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            altitude: 0,
            horizontalAccuracy: 25,
            verticalAccuracy: 10,
            timestamp: Date()
        )
    }

    /// Lungern has no scooter operator; Zug, Bern and Grenchen are the closest covered cities.
    private var lungernRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 46.7741, longitude: 8.1558),
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        )
    }

    private func makeModel(api: any ScooterAPIClient, clock: TestClock) -> ScooterMapModel {
        ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: isolatedDefaults(),
            now: { clock.now }
        )
    }

    private func timedResponse(
        generatedAt: Date,
        expiresIn: TimeInterval,
        parking: [ScooterParking] = [],
        parkingExpiresIn: TimeInterval? = nil
    ) -> ScooterResponse {
        let formatter = ISO8601DateFormatter()
        return ScooterResponse(
            vehicles: [scooter(id: "one", provider: "lime")],
            meta: ScooterResponseMetadata(
                partial: false,
                failedSources: [],
                generatedAt: formatter.string(from: generatedAt),
                refreshAfterSeconds: 60,
                expiresAt: formatter.string(from: generatedAt.addingTimeInterval(expiresIn)),
                parkingExpiresAt: parkingExpiresIn.map {
                    formatter.string(from: generatedAt.addingTimeInterval($0))
                }
            ),
            parking: parking
        )
    }

    /// Long enough for a refresh that was going to start to have reached the API.
    private func settle() async {
        try? await Task.sleep(for: .milliseconds(60))
    }
}

// The views of the main states. Nothing is compared: each state is built and
// drawn once, so a view that traps on some state fails here.
extension ScooterMapModelTests {
    func testMainStatesOfTheDockRenderWithoutCrashing() async throws {
        let origin = GeoPoint(latitude: 47.3779, longitude: 8.5417)
        let bay = ScooterParking(id: "dott:bay", provider: "dott", name: "Rue Faidherbe",
            latitude: 47.3769, longitude: 8.5417, mandatory: true)
        let priced = Scooter(
            provider: "lime", latitude: 47.3769, longitude: 8.5417, battery: 82, rangeMeters: 24_000,
            vehicleID: "priced", deepLink: nil,
            rentalURIs: ScooterRentalURIs(ios: "https://li.me/ride", android: nil, web: nil),
            distanceMeters: 0,
            pricing: ScooterRidePricing(currency: "CHF", unlockFeeMinorUnits: 100, minuteFeeMinorUnits: 35)
        )
        let clock = TestClock()
        let formatter = ISO8601DateFormatter()
        let api = StubScooterAPI(response: ScooterResponse(
            vehicles: [priced, scooter(id: "bare", provider: "bird", battery: nil)],
            meta: ScooterResponseMetadata(
                partial: true,
                failedSources: ["national:voi_zurich"],
                generatedAt: formatter.string(from: clock.now),
                truncated: true,
                totalVehicles: 5_412,
                parkingStatus: "stale",
                expiresAt: formatter.string(from: clock.now.addingTimeInterval(300))
            ),
            parking: [bay]
        ))
        let model = makeModel(api: api, clock: clock)

        guard case .finding = model.dock else { return XCTFail("Expected the first load") }
        assertRenders(ScooterControlDock(model: model), "finding")

        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        guard case .summary = model.dock else { return XCTFail("Expected the summary") }
        assertRenders(ScooterControlDock(model: model), "summary with notices")

        // The scooter card: without an origin and without a price, then with everything.
        model.selectScooter("bird:bare")
        guard case .scooter = model.dock else { return XCTFail("Expected the scooter card") }
        assertRenders(ScooterControlDock(model: model), "scooter without origin, price or link")
        model.userLocation = origin
        model.setRidePass(ProviderRidePass(enabled: true, freeUnlock: true, freeMinutes: 5), for: .lime)
        model.selectScooter("lime:priced")
        assertRenders(ScooterControlDock(model: model), "scooter with a pass")
        model.searchedDestination = MapDestination(title: "Zürich HB", point: origin)
        assertRenders(ScooterControlDock(model: model), "scooter from a place")
        model.searchedDestination = nil

        model.selectParking(bay.id)
        guard case .parking = model.dock else { return XCTFail("Expected the bay card") }
        assertRenders(ScooterControlDock(model: model), "parking bay")

        // Filters that hide everything.
        model.clearSelection()
        model.showProviders([.pony])
        guard case .filtersHideEverything = model.dock else { return XCTFail("Expected the filters card") }
        assertRenders(ScooterControlDock(model: model), "filters hide everything")
        model.resetFilters()
        model.selectParking(bay.id)

        // A failed refresh: in the dock, and at the top of a card.
        await api.setFailure(.offline)
        model.retryLoad()
        let refreshFailed = await waitUntil { model.loadIssue != nil && !model.isLoading }
        XCTAssertTrue(refreshFailed)
        assertRenders(ScooterControlDock(model: model), "parking bay while offline")
        model.clearSelection()
        assertRenders(ScooterControlDock(model: model), "refresh failed")

        // Out of date: the data expired and the refresh after that failed.
        clock.advance(400)
        model.retryLoad()
        let expired = await waitUntil {
            if case .outOfDate = model.loadIssue { return !model.isLoading }
            return false
        }
        XCTAssertTrue(expired)
        guard case .outOfDate = model.dock else { return XCTFail("Expected the out-of-date card") }
        assertRenders(ScooterControlDock(model: model), "out of date")

        // Outside coverage.
        let outside = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        outside.updateViewport(lungernRegion, zoom: 14)
        let outsideLoaded = await waitUntil { outside.lastUpdated != nil && !outside.isLoading }
        XCTAssertTrue(outsideLoaded)
        guard case .outsideCoverage = outside.dock else { return XCTFail("Expected the coverage card") }
        assertRenders(ScooterControlDock(model: outside), "outside coverage")

        // A first load that failed.
        let failing = StubScooterAPI(response: ScooterResponse(vehicles: []))
        await failing.setFailure(.httpStatus(503))
        let waiting = makeModel(api: failing)
        waiting.refresh()
        let failed = await waitUntil { waiting.loadIssue != nil && !waiting.isLoading }
        XCTAssertTrue(failed)
        guard case .waiting = waiting.dock else { return XCTFail("Expected the waiting dock") }
        assertRenders(ScooterControlDock(model: waiting), "waiting")
    }

    /// With very large text a card can be taller than the room above the dock
    /// and scrolls. Opening one in a dock already on screen froze the app.
    func testATallCardOpensOnTheMapScreenWithVeryLargeText() async throws {
        let tall = Scooter(
            provider: "publibike", latitude: 47.3769, longitude: 8.5417, battery: 82, rangeMeters: 24_000,
            vehicleID: "tall", deepLink: nil,
            rentalURIs: ScooterRentalURIs(ios: "https://publibike.ch/ride", android: nil, web: nil),
            distanceMeters: 0,
            pricing: ScooterRidePricing(currency: "CHF", unlockFeeMinorUnits: 100, minuteFeeMinorUnits: 35)
        )
        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [tall])))
        model.userLocation = GeoPoint(latitude: 47.3779, longitude: 8.5417)
        model.updateViewport(zurichRegion, zoom: 16)
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)

        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = UIHostingController(
            rootView: ScooterMapScreen(model: model).environment(\.dynamicTypeSize, .accessibility3)
        )
        window.isHidden = false
        defer { window.isHidden = true }
        window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(600))
        guard case .summary = model.dock else { return XCTFail("Expected the summary") }

        // A freeze never gives the main thread back, so the test could not fail by
        // itself: this ends the run instead of leaving it to hang.
        let watchdog = DispatchWorkItem {
            fatalError("The map screen froze while a tall card opened with very large text")
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: watchdog)
        model.selectScooter("publibike:tall")
        try await Task.sleep(for: .milliseconds(600))
        watchdog.cancel()

        guard case .scooter = model.dock else { return XCTFail("Expected the scooter card") }
    }

    func testTopOfTheMapRendersWithoutCrashing() {
        let covered = MapDestination(title: "Zürich HB", point: GeoPoint(latitude: 47.3782, longitude: 8.5402))
        let uncovered = MapDestination(
            title: "Paradeplatz",
            subtitle: "Lungern OW",
            point: GeoPoint(latitude: 46.7741, longitude: 8.1558)
        )
        for state in [ScooterSearchBarState.empty, .nearYou, .place(covered), .place(uncovered), .locating] {
            assertRenders(
                ScooterSearchIsland(
                    state: state,
                    isSearching: .constant(false),
                    hasActiveFilters: state == .nearYou,
                    onSelect: { _ in },
                    onClear: {},
                    onUseCurrentLocation: {},
                    onShowFilters: {},
                    onShowSettings: {}
                ),
                "search bar: \(state.title)"
            )
        }

        for failure in ScooterLoadFailure.allCases {
            assertRenders(
                MapStatusBanner(message: failure.message, actionTitle: String(localized: "Try again"), action: {}),
                "banner: \(failure.rawValue)"
            )
        }

        for issue in [ScooterLocationIssue.denied, .restricted, .notFound] {
            assertRenders(
                LocationIssueCard(issue: issue, onOpenSettings: {}, onSearchPlace: {}, onRetry: {}, onDismiss: {}),
                "location card: \(issue)"
            )
        }

        let model = makeModel(api: StubScooterAPI(response: ScooterResponse(vehicles: [])))
        assertRenders(FloatingMapControls(model: model), "Near me")
    }

    /// Draws the view off screen in light appearance at the standard text
    /// size, and in dark appearance with very large text.
    private func assertRenders(
        _ view: some View,
        _ name: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for (scheme, size) in [(ColorScheme.light, DynamicTypeSize.large), (.dark, .accessibility3)] {
            let renderer = ImageRenderer(
                content: view
                    .frame(width: 390)
                    .environment(\.colorScheme, scheme)
                    .environment(\.dynamicTypeSize, size)
            )
            let image = renderer.uiImage
            XCTAssertGreaterThan(image?.size.height ?? 0, 0, "\(name), \(scheme), \(size)", file: file, line: line)
        }
    }
}
