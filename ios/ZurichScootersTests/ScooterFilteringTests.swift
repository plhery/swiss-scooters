import MapKit
import XCTest
@testable import ZurichScooters

final class ScooterFilteringTests: XCTestCase {
    private let viewport = GeoBounds(region: MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
        span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
    ))

    func testBatteryAndProviderFilteringForMapAnnotations() {
        let scooters = [
            scooter(id: "lime-high", provider: "lime", battery: 80),
            scooter(id: "lime-low", provider: "lime", battery: 20),
            scooter(id: "bird-high", provider: "bird", battery: 90),
            scooter(id: "unknown", provider: "future-provider", battery: 95)
        ]

        let filtered = ScooterFiltering.mapScooters(
            from: scooters,
            minimumBattery: 50,
            selectedProvider: .lime
        )

        XCTAssertEqual(filtered.map(\.id), ["lime:lime-high"])
    }

    func testVisibleSummaryCountsOnlyViewportButKeepsProviderBreakdown() {
        let scooters = [
            scooter(id: "lime-inside", provider: "lime", battery: 80),
            scooter(id: "bird-inside", provider: "bird", battery: 90),
            scooter(id: "bird-outside", provider: "bird", battery: 90, latitude: 47.5),
            scooter(id: "lime-low", provider: "lime", battery: 10)
        ]

        let summary = ScooterFiltering.visibleSummary(
            for: scooters,
            viewport: viewport,
            minimumBattery: 50,
            selectedProvider: .lime
        )

        XCTAssertEqual(summary.count, 1)
        XCTAssertEqual(summary.providerCounts[.lime], 1)
        XCTAssertEqual(summary.providerCounts[.bird], 1)
    }

    func testUnknownProvidersRemainVisibleWhenNoProviderIsSelected() {
        let summary = ScooterFiltering.visibleSummary(
            for: [scooter(id: "unknown", provider: "future-provider", battery: 70)],
            viewport: viewport,
            minimumBattery: 0,
            selectedProvider: nil
        )

        XCTAssertEqual(summary.count, 1)
        XCTAssertTrue(summary.providerCounts.isEmpty)
    }

    func testClusteringRemainsDisabledAtEveryZoom() {
        XCTAssertFalse(ScooterClusteringPolicy.shouldCluster(at: 10))
        XCTAssertFalse(ScooterClusteringPolicy.shouldCluster(at: 20))
    }

    @MainActor
    func testAnnotationPinsCannotBeHiddenByCollisions() {
        let view = ScooterAnnotationView(annotation: nil, reuseIdentifier: nil)

        XCTAssertEqual(view.collisionMode, .none)
        XCTAssertEqual(view.displayPriority, .required)
        XCTAssertNil(view.clusteringIdentifier)
    }

    private func scooter(
        id: String,
        provider: String,
        battery: Int,
        latitude: Double = 47.3769,
        longitude: Double = 8.5417
    ) -> Scooter {
        Scooter(
            provider: provider,
            latitude: latitude,
            longitude: longitude,
            battery: battery,
            rangeMeters: nil,
            vehicleID: id,
            deepLink: nil,
            distanceMeters: 0
        )
    }
}
