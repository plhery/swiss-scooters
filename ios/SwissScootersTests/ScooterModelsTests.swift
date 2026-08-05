import Foundation
import XCTest
@testable import SwissScooters

final class ScooterModelsTests: XCTestCase {
    func testDecodingAndStableProviderIdentity() throws {
        let data = Data(#"""
        {
          "vehicles": [{
            "provider": "lime",
            "lat": 47.3769,
            "lng": 8.5417,
            "battery": 82,
            "range_m": 12345,
            "vehicle_id": "abc-123",
            "deep_link": "lime://vehicle/abc-123",
            "distance_m": 250.5
          }]
        }
        """#.utf8)

        let scooter = try XCTUnwrap(JSONDecoder().decode(ScooterResponse.self, from: data).vehicles.first)

        XCTAssertEqual(scooter.id, "lime:abc-123")
        XCTAssertEqual(scooter.providerInfo, .lime)
        XCTAssertEqual(scooter.battery, 82)
        XCTAssertEqual(scooter.rangeMeters, 12_345)
        XCTAssertEqual(scooter.deepLink, "lime://vehicle/abc-123")
    }

    func testCoordinateIdentityIsUsedWhenVehicleIDIsMissing() throws {
        let scooter = try makeScooter(provider: "bird", latitude: 47.1, longitude: 8.2, vehicleID: nil)
        XCTAssertEqual(scooter.id, "bird:47.1:8.2")
    }

    func testDistanceUsesCoordinatesRatherThanServerDistance() throws {
        let scooter = try makeScooter(
            provider: "bolt",
            latitude: 47.3779,
            longitude: 8.5417,
            vehicleID: "nearby",
            serverDistance: 50_000
        )

        let distance = scooter.distance(from: GeoPoint(latitude: 47.3769, longitude: 8.5417))

        XCTAssertEqual(distance, 111.2, accuracy: 1.5)
        XCTAssertFalse(scooter.formattedDistance(
            from: GeoPoint(latitude: 47.3769, longitude: 8.5417)
        ).isEmpty)
    }

    func testRangeFormattingOnlyExistsWhenRangeIsProvided() throws {
        XCTAssertNotNil(try makeScooter(rangeMeters: 1_500).formattedRange)
        XCTAssertNil(try makeScooter(rangeMeters: nil).formattedRange)
    }

    private func makeScooter(
        provider: String = "lime",
        latitude: Double = 47.3769,
        longitude: Double = 8.5417,
        rangeMeters: Int? = 1_000,
        vehicleID: String? = "vehicle",
        serverDistance: Double = 100
    ) throws -> Scooter {
        var object: [String: Any] = [
            "provider": provider,
            "lat": latitude,
            "lng": longitude,
            "battery": 75,
            "distance_m": serverDistance
        ]
        object["range_m"] = rangeMeters ?? NSNull()
        object["vehicle_id"] = vehicleID ?? NSNull()

        return try JSONDecoder().decode(
            Scooter.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }
}
