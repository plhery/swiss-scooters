import CoreLocation
import Foundation
import XCTest
@testable import ZurichScooters

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
            scooter(id: "hopp", provider: "hopp")
        ]
        let api = StubScooterAPI(response: ScooterResponse(vehicles: completeScooters))
        let model = makeModel(api: api)

        model.refresh()
        let initialLoadFinished = await waitUntil {
            model.lastUpdated != nil && !model.isLoading
        }
        XCTAssertTrue(initialLoadFinished)

        await api.setResponse(ScooterResponse(
            vehicles: [scooter(id: "hopp-new", provider: "hopp")],
            meta: ScooterResponseMetadata(partial: true, failedSources: ["national"])
        ))
        model.refresh()

        let partialRefreshFinished = await waitUntil {
            model.errorMessage != nil && !model.isLoading
        }
        XCTAssertTrue(partialRefreshFinished)
        XCTAssertEqual(Set(model.mapScooters.map(\.id)), Set(completeScooters.map(\.id)))
        XCTAssertTrue(model.errorMessage?.contains("last complete map") == true)
    }

    func testAcceptedDegradedResponseExposesADataHealthMessage() async throws {
        let response = ScooterResponse(
            vehicles: [scooter(id: "lime", provider: "lime")],
            meta: ScooterResponseMetadata(
                partial: true,
                stale: true,
                failedSources: ["hopp"],
                truncated: true,
                totalVehicles: 5_100
            )
        )
        let model = makeModel(api: StubScooterAPI(response: response))

        model.refresh()

        let loadingFinished = await waitUntil { model.lastUpdated != nil && !model.isLoading }
        XCTAssertTrue(loadingFinished)
        XCTAssertEqual(
            model.dataHealthMessage,
            "Showing cached data · Some providers are unavailable · Showing \(1.formatted()) of \(5_100.formatted()) results"
        )
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

    func testOnlyDeniedLocationAccessOffersASettingsShortcut() {
        XCTAssertTrue(LocationAuthorizationIssue.denied.canOpenSettings)
        XCTAssertFalse(LocationAuthorizationIssue.restricted.canOpenSettings)
        XCTAssertTrue(LocationAuthorizationIssue.denied.message.contains("Settings"))
        XCTAssertTrue(LocationAuthorizationIssue.restricted.message.contains("browse the map"))
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
            distanceMeters: 0
        )
    }

    private func isolatedDefaults() -> UserDefaults {
        let suiteName = "ZurichScootersTests.\(UUID().uuidString)"
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

    init(response: ScooterResponse, delaysFirstRequest: Bool = false) {
        self.response = response
        self.delaysFirstRequest = delaysFirstRequest
    }

    func scooters(origin: GeoPoint, bounds: GeoBounds) async throws -> ScooterResponse {
        calls += 1
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

    func snapshot() -> (calls: Int, cancellations: Int) {
        (calls, cancellations)
    }
}
