import CoreLocation
import Foundation
import MapKit
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
        XCTAssertFalse(model.quickProviderOrder.contains(.publibike))
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
            model.dataHealthMessage != nil && !model.isLoading
        }
        XCTAssertTrue(partialRefreshFinished)
        XCTAssertEqual(model.mapScooters.map(\.vehicleID), ["voi-new"])
        XCTAssertNil(model.errorMessage)
        XCTAssertNotNil(model.dataHealthMessage)
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
        let message = try XCTUnwrap(model.dataHealthMessage)
        XCTAssertEqual(message.components(separatedBy: " · ").count, 3)
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
        XCTAssertTrue(model.isShowingClusterSummary)
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

        model.setMinimumBattery(53)
        let filteredLoadFinished = await waitUntil {
            let snapshot = await api.snapshot()
            return snapshot.calls == 2 && !model.isLoading
        }

        XCTAssertTrue(filteredLoadFinished)
        let snapshot = await api.snapshot()
        XCTAssertEqual(snapshot.lastZoom, 8)
        XCTAssertEqual(snapshot.lastMinimumBattery, 55)
    }

    func testBatteryFilterNormalizesValuePersistsItAndClearsHiddenSelection() async throws {
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
        model.setMinimumBattery(53)

        XCTAssertEqual(model.minimumBattery, 55)
        XCTAssertEqual(defaults.integer(forKey: "minimum-battery"), 55)
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

    func testUserLocationFocusUsesThreeAdditionalZoomLevels() throws {
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
        let expectedFocusMeters: CLLocationDistance = 850 / pow(2, 3)

        model.locationManager(locationManager, didUpdateLocations: [location])

        let openingFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertEqual(openingFocus.latitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(openingFocus.longitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(model.viewportZoom, 19)

        model.focusOnUser()

        let buttonFocus = try XCTUnwrap(model.focusRequest)
        XCTAssertNotEqual(buttonFocus.token, openingFocus.token)
        XCTAssertEqual(buttonFocus.latitudinalMeters, expectedFocusMeters, accuracy: 0.001)
        XCTAssertEqual(buttonFocus.longitudinalMeters, expectedFocusMeters, accuracy: 0.001)
    }

    func testOnlyDeniedLocationAccessOffersASettingsShortcut() {
        XCTAssertTrue(LocationAuthorizationIssue.denied.canOpenSettings)
        XCTAssertFalse(LocationAuthorizationIssue.restricted.canOpenSettings)
        XCTAssertFalse(LocationAuthorizationIssue.denied.message.isEmpty)
        XCTAssertFalse(LocationAuthorizationIssue.restricted.message.isEmpty)
        XCTAssertNotEqual(
            LocationAuthorizationIssue.denied.message,
            LocationAuthorizationIssue.restricted.message
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
        XCTAssertEqual(model.activeOriginTitle, String(localized: "Current location"))

        model.focusOnAddress(destination)

        XCTAssertEqual(model.activeOrigin, .searchedDestination(destination))
        XCTAssertEqual(model.activeOriginTitle, destination.title)
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

    func testQuickProviderOrderSurfacesSelectionsThenAvailableProviders() async {
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

        XCTAssertEqual(Array(model.quickProviderOrder.prefix(4)), [.bird, .bolt, .dott, .lime])

        model.showProviders([.lime, .voi])

        XCTAssertEqual(
            Array(model.quickProviderOrder.prefix(5)),
            [.lime, .voi, .bird, .bolt, .dott]
        )
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
        return response
    }

    func setResponse(_ response: ScooterResponse) {
        self.response = response
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


extension ScooterMapModelTests {
    func testExpiresVehiclesAndParkingWithoutWaitingForAnotherSuccessfulResponse() async {
        let now = Date()
        let formatter = ISO8601DateFormatter()
        let scooter = scooter(id: "one", provider: "lime")
        let location = ScooterParking(id: "bay", provider: "lime", name: "Bay", latitude: 47.377, longitude: 8.542, mandatory: true)
        let response = ScooterResponse(vehicles: [scooter], meta: ScooterResponseMetadata(
            partial: false, failedSources: [], generatedAt: formatter.string(from: now),
            expiresAt: formatter.string(from: now.addingTimeInterval(60)),
            parkingExpiresAt: formatter.string(from: now.addingTimeInterval(120))), parking: [location])
        let model = makeModel(api: StubScooterAPI(response: response))
        model.refresh()
        let loaded = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loaded)
        model.selectScooter(scooter.id)
        model.expireDataIfNeeded(now: now.addingTimeInterval(61))
        XCTAssertTrue(model.mapScooters.isEmpty)
        XCTAssertNil(model.selectedScooter)
        XCTAssertEqual(model.parking, [location])
        XCTAssertNotNil(model.errorMessage)
        model.expireDataIfNeeded(now: now.addingTimeInterval(121))
        XCTAssertTrue(model.parking.isEmpty)
    }
}
