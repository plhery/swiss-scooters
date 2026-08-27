import CoreLocation
import Foundation
import XCTest
@testable import SwissScooters

@MainActor
final class ScooterMapModelTests: XCTestCase {
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

    func testPartialRefreshKeepsLastCompleteScooterSet() async throws {
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
            model.errorMessage != nil && !model.isLoading
        }
        XCTAssertTrue(partialRefreshFinished)
        XCTAssertEqual(Set(model.mapScooters.map(\.id)), Set(completeScooters.map(\.id)))
        XCTAssertFalse(model.errorMessage?.isEmpty ?? true)
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

    private func makeModel(api: any ScooterAPIClient) -> ScooterMapModel {
        ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: isolatedDefaults()
        )
    }

    private func scooter(id: String, provider: String) -> Scooter {
        Scooter(
            provider: provider,
            latitude: 47.3769,
            longitude: 8.5417,
            battery: 80,
            rangeMeters: nil,
            vehicleID: id,
            deepLink: nil,
            rentalURIs: nil,
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
