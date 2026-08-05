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

    private func makeModel(api: any ScooterAPIClient) -> ScooterMapModel {
        ScooterMapModel(
            api: api,
            locationManager: CLLocationManager(),
            defaults: isolatedDefaults()
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
    private let response: ScooterResponse
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

    func snapshot() -> (calls: Int, cancellations: Int) {
        (calls, cancellations)
    }
}
