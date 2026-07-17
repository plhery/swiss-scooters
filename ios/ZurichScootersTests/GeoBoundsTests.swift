import MapKit
import XCTest
@testable import ZurichScooters

final class GeoBoundsTests: XCTestCase {
    func testRegionConversionAndContainment() {
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.04)
        )
        let bounds = GeoBounds(region: region)

        XCTAssertEqual(bounds.south, 47.3669, accuracy: 0.000_001)
        XCTAssertEqual(bounds.north, 47.3869, accuracy: 0.000_001)
        XCTAssertEqual(bounds.west, 8.5217, accuracy: 0.000_001)
        XCTAssertEqual(bounds.east, 8.5617, accuracy: 0.000_001)
        XCTAssertTrue(bounds.contains(latitude: 47.3769, longitude: 8.5417))
        XCTAssertFalse(bounds.contains(latitude: 47.4, longitude: 8.5417))
    }

    func testExpandedBoundsContainOriginalBounds() {
        let original = GeoBounds(region: MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
            span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
        ))

        XCTAssertTrue(original.expanded(by: 0.25).contains(original))
    }

    func testExpansionClampsWorldCoordinates() {
        let world = GeoBounds(region: MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
            span: MKCoordinateSpan(latitudeDelta: 180, longitudeDelta: 360)
        )).expanded(by: 1)

        XCTAssertEqual(world.south, -90)
        XCTAssertEqual(world.north, 90)
        XCTAssertEqual(world.west, -180)
        XCTAssertEqual(world.east, 180)
    }
}
