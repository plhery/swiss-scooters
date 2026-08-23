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
            "deep_link": "https://lime.bike/vehicle/abc-123",
            "rental_uris": {
              "ios": "limebike://vehicle/abc-123",
              "android": "https://lime.bike/vehicle/abc-123?platform=android",
              "web": "https://lime.bike/vehicle/abc-123"
            },
            "distance_m": 250.5
          }],
          "clusters": [],
          "providers": {"lime": 1},
          "meta": {
            "partial": false,
            "stale": false,
            "failedSources": [],
            "sources": {"national": "fresh", "hopp": "fresh"},
            "generatedAt": "2026-08-05T12:00:00.000Z",
            "truncated": false,
            "totalVehicles": 1,
            "mode": "vehicles",
            "zoom": null
          }
        }
        """#.utf8)

        let response = try JSONDecoder().decode(ScooterAPIResponsePayload.self, from: data).model
        let scooter = try XCTUnwrap(response.vehicles.first)

        XCTAssertEqual(scooter.id, "lime:abc-123")
        XCTAssertEqual(scooter.providerInfo, .lime)
        XCTAssertEqual(scooter.battery, 82)
        XCTAssertEqual(scooter.rangeMeters, 12_345)
        XCTAssertEqual(scooter.deepLink, "https://lime.bike/vehicle/abc-123")
        XCTAssertEqual(scooter.rentalURL?.absoluteString, "limebike://vehicle/abc-123")
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

    func testMapZoomRoundsDownSoServerClustersCoverTheWholeZoomLevel() {
        XCTAssertEqual(ScooterClusteringPolicy.apiZoom(for: 15), 15)
        XCTAssertEqual(ScooterClusteringPolicy.apiZoom(for: 15.99), 15)
        XCTAssertEqual(ScooterClusteringPolicy.apiZoom(for: 16), 16)
        XCTAssertTrue(ScooterClusteringPolicy.representationsMatch(16, 18))
        XCTAssertFalse(ScooterClusteringPolicy.representationsMatch(14, 15))
    }

    func testRentalLinkPolicyUsesTheIOSLinkAndNeverTheAndroidLink() {
        let rentalURIs = ScooterRentalURIs(
            ios: "https://go.ridedott.com/vehicles/1?platform=ios",
            android: "https://go.ridedott.com/vehicles/1?platform=android",
            web: nil
        )

        let url = ScooterRentalLinkPolicy.rentalURL(
            provider: "dott",
            rentalURIs: rentalURIs,
            legacyLink: nil
        )

        XCTAssertEqual(
            url?.absoluteString,
            "https://go.ridedott.com/vehicles/1?platform=ios"
        )
        XCTAssertFalse(url?.absoluteString.contains("platform=android") == true)
    }

    func testRentalLinkPolicyRejectsUnsafeAndCrossProviderURLs() {
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "lime",
            value: "javascript:alert(1)"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "lime",
            value: "bolt://action/rent"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "hopp",
            value: "https://app.hopp.bike.example.com/launch/1"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "hopp",
            value: "https://user@app.hopp.bike/launch/1"
        ))
    }

    private func makeScooter(
        provider: String = "lime",
        latitude: Double = 47.3769,
        longitude: Double = 8.5417,
        rangeMeters: Int? = 1_000,
        vehicleID: String? = "vehicle",
        serverDistance: Double = 100
    ) throws -> Scooter {
        Scooter(
            provider: provider,
            latitude: latitude,
            longitude: longitude,
            battery: 75,
            rangeMeters: rangeMeters,
            vehicleID: vehicleID,
            deepLink: nil,
            rentalURIs: nil,
            distanceMeters: serverDistance
        )
    }
}
