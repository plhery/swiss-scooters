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
    func testMapStartsWithASizeSoItOpensOnSwitzerland() {
        // A map created without a size drops the region it is given.
        XCTAssertFalse(ScooterMapCameraPolicy.openingFrame.isEmpty)

        let mapView = MKMapView(frame: ScooterMapCameraPolicy.openingFrame)
        mapView.setRegion(ScooterMapModel.initialRegion, animated: false)
        ScooterMapCameraPolicy.applyOpeningPitch(to: mapView)

        let center = mapView.camera.centerCoordinate
        XCTAssertEqual(center.latitude, ScooterMapModel.switzerlandCenter.latitude, accuracy: 0.5)
        XCTAssertEqual(center.longitude, ScooterMapModel.switzerlandCenter.longitude, accuracy: 0.5)
    }

    @MainActor
    func testCentringAScooterShowsItInTheMapLeftVisibleAboveTheDock() {
        let scooter = CLLocationCoordinate2D(latitude: 47.3769, longitude: 8.5417)
        let mapView = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        mapView.setRegion(
            MKCoordinateRegion(center: scooter, latitudinalMeters: 850, longitudinalMeters: 850),
            animated: false
        )

        // The search bar ends at 110 pt and a tall card begins at 380 pt: the middle is at 245 pt.
        let center = ScooterMapCameraPolicy.center(showing: scooter, on: mapView, visibleTop: 110, visibleBottom: 380)
        XCTAssertLessThan(center.latitude, scooter.latitude)
        XCTAssertEqual(center.longitude, scooter.longitude, accuracy: 0.0001)

        mapView.setCenter(center, animated: false)
        let shown = mapView.convert(scooter, toPointTo: mapView)
        XCTAssertEqual(shown.y, 245, accuracy: 3)
        XCTAssertEqual(shown.x, 195, accuracy: 3)

        // Nothing covers the map, or nearly all of it is covered: the scooter itself is the centre.
        let uncovered = ScooterMapCameraPolicy.center(showing: scooter, on: mapView, visibleTop: 0, visibleBottom: 844)
        XCTAssertEqual(uncovered.latitude, scooter.latitude, accuracy: 0.000_001)
        let covered = ScooterMapCameraPolicy.center(showing: scooter, on: mapView, visibleTop: 400, visibleBottom: 420)
        XCTAssertEqual(covered.latitude, scooter.latitude, accuracy: 0.000_001)
    }

    @MainActor
    func testFocusRequestWaitsUntilTheMapHasASize() {
        let request = MapFocusRequest(
            point: GeoPoint(latitude: 47.3769, longitude: 8.5417),
            token: 7,
            latitudinalMeters: 350,
            longitudinalMeters: 350
        )
        let parent = ScooterMapView(
            scooters: [],
            scooterRevision: 0,
            clusters: [],
            clusterRevision: 0,
            usesServerClusters: false,
            mapStyle: .standard,
            showsUserLocation: false,
            focusRequest: request,
            destination: nil,
            selectedScooterID: nil,
            onRegionChange: { _, _ in },
            onSelectionChange: { _ in }
        )
        let coordinator = ScooterMapView.Coordinator(parent: parent)
        let mapView = MKMapView(frame: .zero)

        // Before the first layout the request is kept for later, not dropped.
        coordinator.applyFocus(request, on: mapView)
        XCTAssertNil(coordinator.lastFocusToken)

        // The region change that follows the layout applies it.
        mapView.frame = ScooterMapCameraPolicy.openingFrame
        coordinator.mapView(mapView, regionDidChangeAnimated: false)
        XCTAssertEqual(coordinator.lastFocusToken, 7)
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

    @MainActor
    func testMapBackgroundTapClosesTheSelectedParkingBay() {
        var parkingChanges: [String?] = []
        let bay = ScooterParking(id: "dott:bay", provider: "dott", name: "Rue Faidherbe",
            latitude: 50.63, longitude: 3.06, mandatory: true)
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
            onSelectionChange: { _ in },
            parking: [bay],
            onParkingSelectionChange: { parkingChanges.append($0) }
        )
        let coordinator = ScooterMapView.Coordinator(parent: parent)
        let mapView = MKMapView()
        coordinator.reconcileParking([bay], on: mapView)

        // Selecting from the model is not reported back to it.
        coordinator.applyParkingSelection(bay.id, on: mapView)
        XCTAssertTrue(parkingChanges.isEmpty)
        XCTAssertEqual(mapView.selectedAnnotations.count, 1)

        coordinator.clearSelection(on: mapView)
        coordinator.clearSelection(on: mapView)

        XCTAssertEqual(parkingChanges.count, 1)
        XCTAssertNil(parkingChanges[0])
        XCTAssertTrue(mapView.selectedAnnotations.isEmpty)
    }

    @MainActor
    func testParkingBaysOpenInTheDockWithoutACallout() throws {
        let bay = ScooterParking(id: "dott:bay", provider: "dott", name: "Rue Faidherbe",
            latitude: 50.63, longitude: 3.06, mandatory: true)
        let annotation = ScooterParkingAnnotation(parking: bay)
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
            onSelectionChange: { _ in }
        )
        let coordinator = ScooterMapView.Coordinator(parent: parent)
        let mapView = MKMapView()
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterParkingAnnotation.reuseIdentifier
        )

        let view = try XCTUnwrap(coordinator.mapView(mapView, viewFor: annotation))

        XCTAssertFalse(view.canShowCallout)
        XCTAssertEqual(view.accessibilityLabel, "\(bay.bayTitle), Rue Faidherbe")
        XCTAssertEqual(annotation.title, bay.bayTitle)
    }

    @MainActor
    func testCreditsNameEverySourceOnceAndAboutLinksAreSecure() {
        let sources = ScooterCreditsList.sources

        // The sources of the credits list on the web, Lille's parking bays included.
        XCTAssertEqual(sources.count, 6)
        XCTAssertEqual(Set(sources.map(\.url)).count, sources.count)
        XCTAssertTrue(sources.allSatisfy { $0.url.scheme == "https" && !$0.title.isEmpty })
        XCTAssertTrue(sources.contains { $0.url.host() == "data.lillemetropole.fr" })

        XCTAssertEqual(ScooterLinks.privacyNotice.absoluteString, "https://scooters.plhery.com/privacy")
        XCTAssertEqual(ScooterLinks.sourceCode.absoluteString, "https://github.com/plhery/swiss-scooters")
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

// Filter presets and the filtered-out summary.
extension ScooterFilteringTests {
    func testBatteryFilterOffersFourPresetsAndSnapsOtherValuesDown() {
        XCTAssertEqual(ScooterBatteryFilter.presets, [0, 30, 60, 80])

        let examples = [(0, 0), (29, 0), (30, 30), (45, 30), (60, 60), (79, 60), (80, 80), (95, 80), (100, 80), (-10, 0)]
        for (value, preset) in examples {
            XCTAssertEqual(ScooterBatteryFilter.snapped(value), preset, "\(value)")
        }
        XCTAssertEqual(ScooterBatteryFilter.label(for: 0), String(localized: "Any"))
        XCTAssertEqual(ScooterBatteryFilter.label(for: 60), "60%+")
    }

    func testVisibleSummaryAlsoCountsWhatTheFiltersHide() {
        let scooters = [
            scooter(id: "lime-inside", provider: "lime", battery: 80),
            scooter(id: "lime-low", provider: "lime", battery: 10),
            scooter(id: "bird-inside", provider: "bird", battery: 90),
            scooter(id: "unknown", provider: "future-provider", battery: 95),
            scooter(id: "bird-outside", provider: "bird", battery: 90, latitude: 47.5)
        ]

        let summary = ScooterFiltering.visibleSummary(
            for: scooters,
            viewport: viewport,
            minimumBattery: 50,
            enabledProviders: [.lime]
        )

        XCTAssertEqual(summary.count, 1)
        XCTAssertEqual(summary.unfilteredCount, 4)
        XCTAssertEqual(summary.unfilteredProviders, [.lime, .bird])
    }

    func testFilterResultTitlesUseSingularAndPluralForms() {
        XCTAssertEqual(ScooterFiltering.showResultsTitle(count: 1), String(localized: "Show 1 scooter"))
        XCTAssertTrue(ScooterFiltering.showResultsTitle(count: 16).contains("16"))
        XCTAssertNotEqual(
            ScooterFiltering.showResultsTitle(count: 0),
            ScooterFiltering.showResultsTitle(count: 1)
        )
    }

    func testFilterSummaryDescribesTheActiveFilters() {
        let both = ScooterFilterSummary(hiddenCount: 26, providers: [.lime], minimumBattery: 60)

        XCTAssertTrue(both.title.contains("26"))
        XCTAssertTrue(both.showAllTitle.contains("26"))
        XCTAssertEqual(both.parts.count, 2)
        XCTAssertTrue(both.parts[0].contains("Lime"))
        XCTAssertTrue(both.parts[1].contains("60%"))
        XCTAssertFalse(both.parts[1].contains("%%"))
        XCTAssertEqual(both.body, both.parts.joined(separator: " · "))

        let one = ScooterFilterSummary(hiddenCount: 1, providers: [.bird, .voi], minimumBattery: nil)
        XCTAssertEqual(one.title, String(localized: "1 scooter hidden by your filters"))
        XCTAssertEqual(one.parts.count, 1)
        XCTAssertTrue(one.body.contains("Bird") && one.body.contains("Voi"))

        let unknown = ScooterFilterSummary(hiddenCount: nil, providers: [], minimumBattery: 80)
        XCTAssertEqual(unknown.title, String(localized: "No scooters match your filters here"))
        XCTAssertEqual(unknown.showAllTitle, String(localized: "Show all"))
        XCTAssertEqual(unknown.parts.count, 1)
        // On its own the battery part opens the line, so it starts with a capital.
        XCTAssertEqual(String(unknown.body.prefix(1)), unknown.parts[0].prefix(1).localizedUppercase)
        XCTAssertEqual(unknown.body.dropFirst(), unknown.parts[0].dropFirst())
        XCTAssertNotEqual(unknown.body, unknown.parts[0])
    }
}
