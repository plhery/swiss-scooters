import MapKit
import XCTest
@testable import SwissScooters

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
            enabledProviders: [.lime]
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
            enabledProviders: [.lime]
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
            enabledProviders: Set(ScooterProvider.allCases)
        )

        XCTAssertEqual(summary.count, 1)
        XCTAssertTrue(summary.providerCounts.isEmpty)
    }

    func testMultipleProvidersCanBeEnabledTogether() {
        let scooters = [
            scooter(id: "lime", provider: "lime", battery: 80),
            scooter(id: "bird", provider: "bird", battery: 80),
            scooter(id: "voi", provider: "voi", battery: 80)
        ]

        let filtered = ScooterFiltering.mapScooters(
            from: scooters,
            minimumBattery: 0,
            enabledProviders: [.lime, .bird]
        )

        XCTAssertEqual(Set(filtered.map(\.provider)), Set(["lime", "bird"]))
    }

    func testClusteringStopsAfterZoomFifteen() {
        XCTAssertTrue(ScooterClusteringPolicy.shouldCluster(at: 10))
        XCTAssertTrue(ScooterClusteringPolicy.shouldCluster(at: 15))
        XCTAssertFalse(ScooterClusteringPolicy.shouldCluster(at: 15.01))
        XCTAssertFalse(ScooterClusteringPolicy.shouldCluster(at: 20))
    }

    func testSelectedScooterDockReservesPriceAndActionSpace() {
        XCTAssertGreaterThanOrEqual(ScooterDetailLayout.minimumHeight, 206)
    }

    @MainActor
    func testMapOpensWithASubtleThreeDimensionalPitch() {
        let mapView = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        mapView.setRegion(ScooterMapModel.initialRegion, animated: false)

        ScooterMapCameraPolicy.applyOpeningPitch(to: mapView)

        XCTAssertGreaterThan(mapView.camera.pitch, 20)
        XCTAssertLessThan(mapView.camera.pitch, 40)

        ScooterMapCameraPolicy.setRegionPreservingPerspective(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417),
                latitudinalMeters: 850,
                longitudinalMeters: 850
            ),
            on: mapView,
            animated: false
        )

        XCTAssertGreaterThan(mapView.camera.pitch, 20)
    }

    @MainActor
    func testAnnotationPinsCannotBeHiddenByCollisions() {
        let view = ScooterAnnotationView(annotation: nil, reuseIdentifier: nil)

        XCTAssertEqual(view.bounds.size, ScooterAnnotationView.markerSize)
        XCTAssertLessThan(view.bounds.width, 46)
        XCTAssertEqual(view.centerOffset, .zero)
        XCTAssertFalse(view.layer.sublayers?.contains(where: { $0 is CAGradientLayer }) == true)
        XCTAssertEqual(view.collisionMode, .none)
        XCTAssertEqual(view.displayPriority, .required)
        XCTAssertEqual(view.zPriority, .defaultUnselected)
        XCTAssertEqual(view.selectedZPriority, ScooterAnnotationView.selectedMarkerZPriority)
        XCTAssertNil(view.clusteringIdentifier)

        view.setClusteringEnabled(true)

        XCTAssertEqual(view.collisionMode, .circle)
        XCTAssertEqual(view.displayPriority, .defaultHigh)
        XCTAssertEqual(view.clusteringIdentifier, ScooterAnnotationView.clusteringIdentifier)
    }

    @MainActor
    func testSelectedScooterBubbleGrowsAndReturnsToItsCompactSize() {
        let view = ScooterAnnotationView(annotation: nil, reuseIdentifier: nil)

        view.setSelected(true, animated: false)
        XCTAssertEqual(view.transform.a, 1.15, accuracy: 0.001)
        XCTAssertEqual(view.transform.d, 1.15, accuracy: 0.001)

        view.setSelected(false, animated: false)
        XCTAssertEqual(view.transform, .identity)
    }

    @MainActor
    func testProviderLettersUpdateWhenScooterAnnotationsAreReused() throws {
        let view = ScooterAnnotationView(
            annotation: ScooterMapAnnotation(scooter: scooter(id: "bolt", provider: "bolt", battery: 82)),
            reuseIdentifier: nil
        )
        let label = try XCTUnwrap(view.subviews.compactMap { $0 as? UILabel }.first)
        XCTAssertEqual(label.text, "B")

        for (provider, letters) in [("bird", "Bi"), ("publibike", "PB"), ("lime", "L"), ("unknown", "?")] {
            view.prepareForReuse()
            XCTAssertNil(label.text)
            view.annotation = ScooterMapAnnotation(scooter: scooter(id: provider, provider: provider, battery: 82))
            view.layoutIfNeeded()

            XCTAssertEqual(label.text, letters)
            XCTAssertFalse(label.isHidden)
            XCTAssertFalse(label.isAccessibilityElement)
            XCTAssertTrue(view.bounds.contains(label.frame))
        }
    }

    @MainActor
    func testProviderPinsPreferWhiteLetters() {
        for provider in ScooterProvider.allCases {
            XCTAssertEqual(
                ScooterAnnotationView.glyphColor(on: provider.uiColor),
                .white,
                "Expected white letters for \(provider.name)"
            )
        }
    }

    @MainActor
    func testUserLocationAlwaysRendersAboveScooterMarkers() {
        let userLocationView = MKAnnotationView(annotation: nil, reuseIdentifier: nil)

        ScooterMapView.Coordinator.prioritizeUserLocationView(userLocationView)

        XCTAssertEqual(userLocationView.displayPriority, .required)
        XCTAssertEqual(userLocationView.zPriority, .max)
        XCTAssertEqual(userLocationView.selectedZPriority, .max)
        XCTAssertGreaterThan(
            userLocationView.zPriority.rawValue,
            ScooterAnnotationView.selectedMarkerZPriority.rawValue
        )
    }

    func testCompassUsesTrueNorthAndFallsBackToMagneticNorth() throws {
        let north = try XCTUnwrap(ScooterUserHeading(trueHeading: 0, magneticHeading: 8, accuracy: 5))
        let fallback = try XCTUnwrap(ScooterUserHeading(trueHeading: -1, magneticHeading: 358, accuracy: 12))
        XCTAssertEqual(north.direction, 0)
        XCTAssertEqual(fallback.direction, 358)
        XCTAssertNil(ScooterUserHeading(trueHeading: 20, magneticHeading: 25, accuracy: -1))
        XCTAssertNil(ScooterUserHeading(trueHeading: 20, magneticHeading: 25, accuracy: 90))
        XCTAssertNil(ScooterUserHeading(trueHeading: -1, magneticHeading: -1, accuracy: 5))
        XCTAssertNil(ScooterUserHeading(trueHeading: .nan, magneticHeading: .nan, accuracy: 5))
    }

    func testCompassBeamWidensWithUncertainty() throws {
        let precise = try XCTUnwrap(ScooterUserHeading(trueHeading: 45, magneticHeading: 45, accuracy: 5))
        let uncertain = try XCTUnwrap(ScooterUserHeading(trueHeading: 45, magneticHeading: 45, accuracy: 50))
        let veryUncertain = try XCTUnwrap(ScooterUserHeading(trueHeading: 45, magneticHeading: 45, accuracy: 85))
        XCTAssertEqual(precise.halfAngle, 22 * .pi / 180, accuracy: 0.001)
        XCTAssertGreaterThan(uncertain.halfAngle, precise.halfAngle)
        XCTAssertEqual(veryUncertain.halfAngle, 60 * .pi / 180, accuracy: 0.001)
    }

    @MainActor
    func testCompassProjectionFollowsMapRotationAndPitch() throws {
        let coordinate = CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417)
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let camera = MKMapCamera(lookingAtCenter: coordinate, fromDistance: 500, pitch: 0, heading: 0)
        map.setCamera(camera, animated: false)

        func projectedAngle(_ direction: Double) throws -> Double {
            let heading = try XCTUnwrap(ScooterUserHeading(trueHeading: direction, magneticHeading: direction, accuracy: 5))
            let origin = map.convert(coordinate, toPointTo: map)
            let ahead = map.convert(heading.coordinateAhead(of: coordinate), toPointTo: map)
            return atan2(ahead.x - origin.x, origin.y - ahead.y) * 180 / .pi
        }

        XCTAssertEqual(try projectedAngle(0), 0, accuracy: 1)
        XCTAssertEqual(try projectedAngle(90), 90, accuracy: 1)
        XCTAssertEqual(try projectedAngle(359), -1, accuracy: 1)
        XCTAssertEqual(try projectedAngle(1), 1, accuracy: 1)

        camera.heading = 90
        map.setCamera(camera, animated: false)
        XCTAssertEqual(try projectedAngle(90), 0, accuracy: 1)
        XCTAssertEqual(try projectedAngle(0), -90, accuracy: 1)

        camera.heading = 0
        camera.pitch = 45
        map.setCamera(camera, animated: false)
        XCTAssertGreaterThan(try projectedAngle(45), 45)
        XCTAssertLessThan(try projectedAngle(45), 90)
    }

    @MainActor
    func testAnnotationAccessibilityDescribesAvailabilityAndSelection() throws {
        let scooter = Scooter(
            provider: "lime",
            latitude: 47.3769,
            longitude: 8.5417,
            battery: 82,
            rangeMeters: 12_500,
            vehicleID: "accessible",
            deepLink: nil,
            rentalURIs: nil,
            distanceMeters: 0
        )
        let view = ScooterAnnotationView(annotation: nil, reuseIdentifier: nil)
        view.annotation = ScooterMapAnnotation(scooter: scooter)

        XCTAssertEqual(
            view.accessibilityLabel,
            String(format: String(localized: "%@ scooter"), "Lime")
        )
        let value = try XCTUnwrap(view.accessibilityValue)
        XCTAssertTrue(value.contains(String(localized: "Battery")))
        XCTAssertTrue(value.contains(String(
            format: String(localized: "%lld percent"),
            Int64(82)
        )))
        XCTAssertTrue(value.contains(try XCTUnwrap(scooter.formattedRange)))
        XCTAssertFalse(view.accessibilityTraits.contains(.selected))

        view.setSelected(true, animated: false)

        XCTAssertTrue(view.accessibilityTraits.contains(.button))
        XCTAssertTrue(view.accessibilityTraits.contains(.selected))

        view.setSelected(false, animated: false)

        XCTAssertFalse(view.accessibilityTraits.contains(.selected))
    }

    @MainActor
    func testBirdMarkerAccentRemainsDistinctAgainstTheDarkMarkerSurface() {
        let darkTraits = UITraitCollection(userInterfaceStyle: .dark)
        let surfaceColor = UIColor.secondarySystemBackground.resolvedColor(with: darkTraits)
        let originalContrast = ScooterAnnotationView.contrastRatio(
            between: ScooterProvider.bird.uiColor,
            and: surfaceColor
        )

        let markerAccent = ScooterAnnotationView.markerAccentColor(
            ScooterProvider.bird.uiColor,
            against: surfaceColor
        )

        XCTAssertLessThan(originalContrast, 3.5)
        XCTAssertGreaterThanOrEqual(
            ScooterAnnotationView.contrastRatio(between: markerAccent, and: surfaceColor),
            3.5
        )
    }

    @MainActor
    func testDelayedMapKitSelectionCannotReplaceTheDirectTapTarget() {
        let deadline = 11.0

        XCTAssertTrue(ScooterMapView.Coordinator.shouldSuppressMapKitSelection(
            candidateID: "voi:underneath",
            intendedID: "lime:tapped",
            until: deadline,
            now: 10.5
        ))
        XCTAssertFalse(ScooterMapView.Coordinator.shouldSuppressMapKitSelection(
            candidateID: "lime:tapped",
            intendedID: "lime:tapped",
            until: deadline,
            now: 10.5
        ))
        XCTAssertFalse(ScooterMapView.Coordinator.shouldSuppressMapKitSelection(
            candidateID: "voi:underneath",
            intendedID: "lime:tapped",
            until: deadline,
            now: deadline
        ))
        XCTAssertTrue(ScooterMapView.Coordinator.shouldSuppressMapKitSelection(
            candidateID: "voi:late",
            intendedID: nil,
            until: deadline,
            now: 10.5
        ))
    }

    @MainActor
    func testTopChromeFrameExcludesUnderlyingMapInteractions() {
        let chromeFrame = CGRect(x: 12, y: 62, width: 369, height: 62)

        XCTAssertTrue(ScooterMapView.Coordinator.point(
            CGPoint(x: 200, y: 90),
            isInside: chromeFrame
        ))
        XCTAssertFalse(ScooterMapView.Coordinator.point(
            CGPoint(x: 200, y: 140),
            isInside: chromeFrame
        ))
        XCTAssertFalse(ScooterMapView.Coordinator.point(
            CGPoint(x: 0, y: 0),
            isInside: .null
        ))

        XCTAssertTrue(ScooterMapView.Coordinator.shouldSuppressAllMapKitSelections(
            until: 10,
            now: 9.99
        ))
        XCTAssertFalse(ScooterMapView.Coordinator.shouldSuppressAllMapKitSelections(
            until: 10,
            now: 10
        ))
    }

    @MainActor
    func testMapBackgroundTapClearsSelectionSynchronously() {
        var selectionChanges: [String?] = []
        let parent = ScooterMapView(
            scooters: [],
            scooterRevision: 0,
            clusters: [],
            clusterRevision: 0,
            usesServerClusters: false,
            mapStyle: .standard,
            showsUserLocation: false,
            focusRequest: nil,
            destination: nil,
            selectedScooterID: nil,
            onRegionChange: { _, _ in },
            onSelectionChange: { selectionChanges.append($0) }
        )
        let coordinator = ScooterMapView.Coordinator(parent: parent)
        let mapView = MKMapView()
        coordinator.applySelection("lime:tapped", on: mapView)

        coordinator.clearSelection(on: mapView)
        coordinator.clearSelection(on: mapView)

        XCTAssertEqual(selectionChanges.count, 1)
        XCTAssertNil(selectionChanges[0])
    }

    func testAddressSuggestionsSeparateTheStreetFromPostalCodeAndCity() {
        let examples: [(String, String, String)] = [
            ("Bahnhofstrasse 1 8001 Zürich", "Bahnhofstrasse 1", "8001 Zürich"),
            ("Rue du Rhône 10 1204 Genève", "Rue du Rhône 10", "1204 Genève"),
            ("Via Nassa 5, 6900 Lugano", "Via Nassa 5", "6900 Lugano"),
            ("114, Ankerstrasse, Zurich, Switzerland", "Ankerstrasse 114", "Zurich, Switzerland"),
            ("Zürich HB", "Zürich HB", ""),
            ("8001 Zürich", "8001 Zürich", ""),
            ("  Bahnhofstrasse 1, CH-8001 Zürich  ", "Bahnhofstrasse 1", "CH-8001 Zürich")
        ]
        for (label, title, subtitle) in examples {
            let suggestion = SwissAddressSuggestion(result: AddressSearchResult(
                latitude: 47.3769, longitude: 8.5417, displayName: label
            ))
            XCTAssertEqual(suggestion.title, title, label)
            XCTAssertEqual(suggestion.subtitle, subtitle, label)
        }
    }

    @MainActor
    func testCompassTouchesAreExcludedFromScooterTapHandling() {
        let compass = MKCompassButton(mapView: MKMapView())
        let container = UIView()
        let touchTarget = UIView()
        compass.addSubview(container)
        container.addSubview(touchTarget)

        XCTAssertTrue(ScooterMapView.Coordinator.isCompassView(compass))
        XCTAssertTrue(ScooterMapView.Coordinator.isCompassView(touchTarget))
        XCTAssertFalse(ScooterMapView.Coordinator.isCompassView(UIView()))
        XCTAssertFalse(ScooterMapView.Coordinator.isCompassView(nil))
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
            rentalURIs: nil,
            distanceMeters: 0
        )
    }
}
