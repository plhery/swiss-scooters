import MapKit
import SwiftUI
import UIKit

struct ScooterMapView: UIViewRepresentable {
    let scooters: [Scooter]
    let scooterRevision: Int
    let clusters: [ScooterCluster]
    let clusterRevision: Int
    let usesServerClusters: Bool
    let mapStyle: AppleMapStyle
    let showsUserLocation: Bool
    let focusRequest: MapFocusRequest?
    let destination: MapDestination?
    let selectedScooterID: String?
    let onRegionChange: (MKCoordinateRegion, Int) -> Void
    let onSelectionChange: (String?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.mapType = mapStyle.mapType
        mapView.showsUserLocation = false
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.pointOfInterestFilter = MKPointOfInterestFilter(including: [
            .publicTransport,
            .landmark
        ])
        mapView.isPitchEnabled = true
        mapView.register(
            ScooterAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterAnnotationView.reuseIdentifier
        )
        mapView.register(
            ScooterClusterAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterClusterAnnotationView.reuseIdentifier
        )
        mapView.register(
            ScooterClusterAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterServerClusterAnnotation.reuseIdentifier
        )
        mapView.register(
            MKMarkerAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: SearchedAddressAnnotation.reuseIdentifier
        )
        // MapKit can defer didSelect while resolving dense, overlapping annotations.
        // Publish direct scooter taps immediately and keep the delegate as a fallback.
        let scooterTapRecognizer = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleMapTap(_:))
        )
        scooterTapRecognizer.cancelsTouchesInView = false
        scooterTapRecognizer.delegate = context.coordinator
        mapView.addGestureRecognizer(scooterTapRecognizer)
        mapView.setRegion(ScooterMapModel.initialRegion, animated: false)
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        if mapView.mapType != mapStyle.mapType {
            mapView.mapType = mapStyle.mapType
        }
        if mapView.showsUserLocation != showsUserLocation {
            mapView.showsUserLocation = showsUserLocation
        }
        context.coordinator.updateClusteringMode(on: mapView)
        context.coordinator.reconcile(scooters, revision: scooterRevision, on: mapView)
        context.coordinator.reconcile(clusters, revision: clusterRevision, on: mapView)
        context.coordinator.applyDestination(destination, on: mapView)
        context.coordinator.applySelection(selectedScooterID, on: mapView)
        context.coordinator.applyFocus(focusRequest, on: mapView)
    }

    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        var parent: ScooterMapView
        private var annotationsByID: [String: ScooterMapAnnotation] = [:]
        private var clusterAnnotationsByID: [String: ScooterServerClusterAnnotation] = [:]
        private var lastFocusToken: Int?
        private var appliedSelectionID: String?
        private var reconciledScooterRevision: Int?
        private var reconciledClusterRevision: Int?
        private var clusteringEnabled: Bool?
        private var appliedDestination: MapDestination?
        private var destinationAnnotation: SearchedAddressAnnotation?
        private var directTapSelectionID: String?
        private var suppressMapKitSelectionUntil: TimeInterval = 0

        static let mapKitTapResolutionGracePeriod: TimeInterval = 1

        init(parent: ScooterMapView) {
            self.parent = parent
        }

        func reconcile(_ scooters: [Scooter], revision: Int, on mapView: MKMapView) {
            guard revision != reconciledScooterRevision else { return }
            reconciledScooterRevision = revision

            let incomingIDs = Set(scooters.map(\.id))
            let removedAnnotations = annotationsByID.compactMap { id, annotation in
                incomingIDs.contains(id) ? nil : annotation
            }

            if !removedAnnotations.isEmpty {
                mapView.removeAnnotations(removedAnnotations)
                for annotation in removedAnnotations {
                    annotationsByID.removeValue(forKey: annotation.scooter.id)
                }
            }

            var additions: [ScooterMapAnnotation] = []
            for scooter in scooters {
                if let annotation = annotationsByID[scooter.id] {
                    if annotation.update(with: scooter),
                       let view = mapView.view(for: annotation) as? ScooterAnnotationView {
                        view.refreshAppearance()
                    }
                } else {
                    let annotation = ScooterMapAnnotation(scooter: scooter)
                    annotationsByID[scooter.id] = annotation
                    additions.append(annotation)
                }
            }

            if !additions.isEmpty {
                mapView.addAnnotations(additions)
            }
        }

        func reconcile(_ clusters: [ScooterCluster], revision: Int, on mapView: MKMapView) {
            guard revision != reconciledClusterRevision else { return }
            reconciledClusterRevision = revision

            let incomingIDs = Set(clusters.map(\.id))
            let removedAnnotations = clusterAnnotationsByID.compactMap { id, annotation in
                incomingIDs.contains(id) ? nil : annotation
            }
            if !removedAnnotations.isEmpty {
                mapView.removeAnnotations(removedAnnotations)
                for annotation in removedAnnotations {
                    clusterAnnotationsByID.removeValue(forKey: annotation.cluster.id)
                }
            }

            var additions: [ScooterServerClusterAnnotation] = []
            for cluster in clusters {
                if let annotation = clusterAnnotationsByID[cluster.id] {
                    if annotation.update(with: cluster),
                       let view = mapView.view(for: annotation) as? ScooterClusterAnnotationView {
                        view.refreshAppearance()
                    }
                } else {
                    let annotation = ScooterServerClusterAnnotation(cluster: cluster)
                    clusterAnnotationsByID[cluster.id] = annotation
                    additions.append(annotation)
                }
            }

            if !additions.isEmpty {
                mapView.addAnnotations(additions)
            }
        }

        func applySelection(_ selectedID: String?, on mapView: MKMapView) {
            guard selectedID != appliedSelectionID else { return }
            appliedSelectionID = selectedID

            for annotation in mapView.selectedAnnotations where annotation is ScooterMapAnnotation {
                mapView.deselectAnnotation(annotation, animated: true)
            }

            if let selectedID, let annotation = annotationsByID[selectedID] {
                mapView.selectAnnotation(annotation, animated: true)
            }
        }

        func applyFocus(_ request: MapFocusRequest?, on mapView: MKMapView) {
            guard let request, request.token != lastFocusToken else { return }
            lastFocusToken = request.token
            let region = MKCoordinateRegion(
                center: request.point.coordinate,
                latitudinalMeters: request.latitudinalMeters,
                longitudinalMeters: request.longitudinalMeters
            )
            mapView.setRegion(region, animated: !UIAccessibility.isReduceMotionEnabled)
        }

        func applyDestination(_ destination: MapDestination?, on mapView: MKMapView) {
            guard destination != appliedDestination else { return }
            appliedDestination = destination

            if let destinationAnnotation {
                mapView.removeAnnotation(destinationAnnotation)
                self.destinationAnnotation = nil
            }

            guard let destination else { return }
            let annotation = SearchedAddressAnnotation(destination: destination)
            destinationAnnotation = annotation
            mapView.addAnnotation(annotation)
        }

        func updateClusteringMode(on mapView: MKMapView) {
            guard mapView.bounds.width > 0, mapView.visibleMapRect.width > 0 else { return }

            let shouldCluster = !parent.usesServerClusters && ScooterClusteringPolicy.shouldCluster(
                at: Self.zoomLevel(on: mapView)
            )
            guard shouldCluster != clusteringEnabled else { return }
            clusteringEnabled = shouldCluster

            let scooterAnnotations = mapView.annotations.compactMap { annotation in
                annotation as? ScooterMapAnnotation
            }
            if !scooterAnnotations.isEmpty {
                // Re-adding the annotations makes MapKit immediately rebuild or
                // dissolve clusters when the zoom threshold is crossed.
                mapView.removeAnnotations(scooterAnnotations)
                mapView.addAnnotations(scooterAnnotations)
            }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            updateClusteringMode(on: mapView)
            let region = mapView.region
            let zoom = ScooterClusteringPolicy.apiZoom(for: Self.zoomLevel(on: mapView))
            Task { @MainActor [parent] in
                parent.onRegionChange(region, zoom)
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation {
                return nil
            }

            if let address = annotation as? SearchedAddressAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: SearchedAddressAnnotation.reuseIdentifier,
                    for: address
                ) as! MKMarkerAnnotationView
                view.markerTintColor = .systemBlue
                view.glyphImage = UIImage(systemName: "magnifyingglass")
                view.canShowCallout = true
                view.displayPriority = .required
                view.clusteringIdentifier = nil
                view.accessibilityLabel = address.title
                return view
            }

            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: ScooterClusterAnnotationView.reuseIdentifier,
                    for: cluster
                ) as! ScooterClusterAnnotationView
                view.refreshAppearance()
                return view
            }

            if let cluster = annotation as? ScooterServerClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: ScooterServerClusterAnnotation.reuseIdentifier,
                    for: cluster
                ) as! ScooterClusterAnnotationView
                view.refreshAppearance()
                return view
            }

            guard annotation is ScooterMapAnnotation else { return nil }
            let view = mapView.dequeueReusableAnnotationView(
                withIdentifier: ScooterAnnotationView.reuseIdentifier,
                for: annotation
            ) as! ScooterAnnotationView
            view.setClusteringEnabled(ScooterClusteringPolicy.shouldCluster(
                at: Self.zoomLevel(on: mapView)
            ))
            view.refreshAppearance()
            return view
        }

        private static func zoomLevel(on mapView: MKMapView) -> Double {
            guard mapView.bounds.width > 0, mapView.visibleMapRect.width > 0 else { return 0 }
            let zoomScale = Double(mapView.bounds.width) / mapView.visibleMapRect.width
            return log2(zoomScale * MKMapSize.world.width / 256)
        }

        @objc func handleMapTap(_ gestureRecognizer: UITapGestureRecognizer) {
            guard let mapView = gestureRecognizer.view as? MKMapView else { return }
            let annotation = scooterAnnotation(
                at: gestureRecognizer.location(in: mapView),
                on: mapView
            )
            registerDirectMapTap(selectionID: annotation?.scooter.id)

            if let annotation {
                publishSelection(annotation)
                mapView.selectAnnotation(
                    annotation,
                    animated: !UIAccessibility.isReduceMotionEnabled
                )
            } else {
                clearSelection(on: mapView)
            }
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        private func scooterAnnotation(
            at point: CGPoint,
            on mapView: MKMapView
        ) -> ScooterMapAnnotation? {
            var hitView: UIView? = mapView.hitTest(point, with: nil)
            while let view = hitView, view !== mapView {
                if let annotationView = view as? MKAnnotationView {
                    return annotationView.annotation as? ScooterMapAnnotation
                }
                hitView = view.superview
            }

            return annotationsByID.values
                .compactMap { annotation -> (ScooterMapAnnotation, CGFloat)? in
                    guard let view = mapView.view(for: annotation),
                          !view.isHidden,
                          view.alpha > 0.01,
                          view.window != nil else { return nil }
                    let frame = view.convert(view.bounds, to: mapView).insetBy(dx: -4, dy: -4)
                    guard frame.contains(point) else { return nil }
                    let distance = hypot(frame.midX - point.x, frame.midY - point.y)
                    return (annotation, distance)
                }
                .min(by: { $0.1 < $1.1 })?
                .0
        }

        private func publishSelection(_ annotation: ScooterMapAnnotation) {
            let scooterID = annotation.scooter.id
            guard appliedSelectionID != scooterID else { return }
            appliedSelectionID = scooterID
            parent.onSelectionChange(scooterID)
        }

        func clearSelection(on mapView: MKMapView) {
            guard appliedSelectionID != nil else { return }
            appliedSelectionID = nil
            for annotation in mapView.selectedAnnotations where annotation is ScooterMapAnnotation {
                mapView.deselectAnnotation(annotation, animated: false)
            }
            parent.onSelectionChange(nil)
        }

        private func registerDirectMapTap(selectionID: String?) {
            directTapSelectionID = selectionID
            suppressMapKitSelectionUntil = ProcessInfo.processInfo.systemUptime +
                Self.mapKitTapResolutionGracePeriod
        }

        static func shouldSuppressMapKitSelection(
            candidateID: String,
            intendedID: String?,
            until deadline: TimeInterval,
            now: TimeInterval
        ) -> Bool {
            now < deadline && candidateID != intendedID
        }

        private func restoreDirectSelection(on mapView: MKMapView) {
            guard let directTapSelectionID,
                  let annotation = annotationsByID[directTapSelectionID] else { return }
            mapView.selectAnnotation(annotation, animated: false)
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            if let cluster = view.annotation as? ScooterServerClusterAnnotation {
                let span = mapView.region.span
                mapView.setRegion(
                    MKCoordinateRegion(
                        center: cluster.coordinate,
                        span: MKCoordinateSpan(
                            latitudeDelta: span.latitudeDelta / 4,
                            longitudeDelta: span.longitudeDelta / 4
                        )
                    ),
                    animated: !UIAccessibility.isReduceMotionEnabled
                )
                mapView.deselectAnnotation(cluster, animated: false)
                return
            }

            if let cluster = view.annotation as? MKClusterAnnotation {
                mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                mapView.deselectAnnotation(cluster, animated: false)
                return
            }

            guard let annotation = view.annotation as? ScooterMapAnnotation else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if Self.shouldSuppressMapKitSelection(
                candidateID: annotation.scooter.id,
                intendedID: directTapSelectionID,
                until: suppressMapKitSelectionUntil,
                now: now
            ) {
                mapView.deselectAnnotation(annotation, animated: false)
                restoreDirectSelection(on: mapView)
                return
            }
            if now >= suppressMapKitSelectionUntil {
                directTapSelectionID = nil
                suppressMapKitSelectionUntil = 0
            }
            publishSelection(annotation)
        }

        func mapView(_ mapView: MKMapView, didDeselect view: MKAnnotationView) {
            guard ProcessInfo.processInfo.systemUptime >= suppressMapKitSelectionUntil else { return }
            guard let annotation = view.annotation as? ScooterMapAnnotation,
                  appliedSelectionID == annotation.scooter.id else { return }
            appliedSelectionID = nil
            parent.onSelectionChange(nil)
        }
    }
}

final class SearchedAddressAnnotation: NSObject, MKAnnotation {
    static let reuseIdentifier = "searched-address"

    let coordinate: CLLocationCoordinate2D
    let title: String?

    init(destination: MapDestination) {
        coordinate = destination.point.coordinate
        title = destination.title
        super.init()
    }
}

final class ScooterMapAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    private(set) var scooter: Scooter

    init(scooter: Scooter) {
        self.scooter = scooter
        coordinate = scooter.coordinate
        super.init()
    }

    @discardableResult
    func update(with scooter: Scooter) -> Bool {
        guard self.scooter != scooter else { return false }
        let coordinateChanged = coordinate.latitude != scooter.latitude ||
            coordinate.longitude != scooter.longitude
        self.scooter = scooter
        if coordinateChanged {
            coordinate = scooter.coordinate
        }
        return true
    }
}

final class ScooterServerClusterAnnotation: NSObject, MKAnnotation {
    static let reuseIdentifier = "server-scooter-cluster"

    @objc dynamic var coordinate: CLLocationCoordinate2D
    private(set) var cluster: ScooterCluster

    init(cluster: ScooterCluster) {
        self.cluster = cluster
        coordinate = cluster.coordinate
        super.init()
    }

    @discardableResult
    func update(with cluster: ScooterCluster) -> Bool {
        guard self.cluster != cluster else { return false }
        let coordinateChanged = coordinate.latitude != cluster.latitude ||
            coordinate.longitude != cluster.longitude
        self.cluster = cluster
        if coordinateChanged {
            coordinate = cluster.coordinate
        }
        return true
    }
}

final class ScooterAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "scooter"
    static let clusteringIdentifier = "scooters"

    private let selectionHaloView = UIView()
    private let surfaceView = UIView()
    private let glyphImageView = UIImageView()
    private let fallbackLabel = UILabel()
    private let providerDot = UIView()
    private var renderedScooter: Scooter?
    private var providerBrandColor = UIColor.systemGray

    override var annotation: MKAnnotation? {
        didSet { refreshAppearance() }
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        configureView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureView()
    }

    private func configureView() {
        bounds = CGRect(x: 0, y: 0, width: 46, height: 46)
        centerOffset = CGPoint(x: 0, y: -3)
        setClusteringEnabled(false)
        canShowCallout = false
        backgroundColor = .clear

        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.16
        layer.shadowRadius = 4
        layer.shadowOffset = CGSize(width: 0, height: 2)
        layer.shadowPath = UIBezierPath(ovalIn: bounds.insetBy(dx: 4, dy: 4)).cgPath

        selectionHaloView.frame = bounds.insetBy(dx: 1, dy: 1)
        selectionHaloView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        selectionHaloView.layer.cornerRadius = 22
        selectionHaloView.layer.borderWidth = 1
        selectionHaloView.alpha = 0
        selectionHaloView.transform = CGAffineTransform(scaleX: 0.84, y: 0.84)
        addSubview(selectionHaloView)

        surfaceView.frame = bounds.insetBy(dx: 4, dy: 4)
        surfaceView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        surfaceView.backgroundColor = .secondarySystemBackground
        surfaceView.layer.cornerRadius = 19
        surfaceView.layer.borderWidth = 1.75
        addSubview(surfaceView)

        let glyphConfiguration = UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold)
        glyphImageView.frame = surfaceView.bounds.insetBy(dx: 8, dy: 8)
        glyphImageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        glyphImageView.contentMode = .scaleAspectFit
        glyphImageView.preferredSymbolConfiguration = glyphConfiguration
        glyphImageView.image = UIImage(systemName: "scooter") ?? UIImage(systemName: "bicycle")
        glyphImageView.tintColor = .label
        surfaceView.addSubview(glyphImageView)

        fallbackLabel.frame = surfaceView.bounds.insetBy(dx: 7, dy: 7)
        fallbackLabel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        fallbackLabel.textAlignment = .center
        fallbackLabel.textColor = .label
        fallbackLabel.font = .systemFont(ofSize: 10, weight: .heavy)
        fallbackLabel.adjustsFontSizeToFitWidth = true
        fallbackLabel.minimumScaleFactor = 0.7
        fallbackLabel.isHidden = glyphImageView.image != nil
        surfaceView.addSubview(fallbackLabel)

        providerDot.bounds = CGRect(x: 0, y: 0, width: 9, height: 9)
        providerDot.center = CGPoint(x: 37, y: 37)
        providerDot.autoresizingMask = [.flexibleLeftMargin, .flexibleTopMargin]
        providerDot.layer.cornerRadius = 4.5
        providerDot.layer.borderWidth = 1.5
        addSubview(providerDot)
        updateAdaptiveColors()
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
            (view: ScooterAnnotationView, _) in
            view.updateAdaptiveColors()
        }

        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    private func updateAdaptiveColors() {
        let surfaceColor = UIColor.secondarySystemBackground.resolvedColor(with: traitCollection)
        let brandColor = providerBrandColor.resolvedColor(with: traitCollection)
        let accentColor = Self.markerAccentColor(brandColor, against: surfaceColor)
        surfaceView.layer.borderColor = accentColor.withAlphaComponent(0.88).cgColor
        selectionHaloView.backgroundColor = accentColor.withAlphaComponent(0.14)
        selectionHaloView.layer.borderColor = accentColor.withAlphaComponent(0.34).cgColor
        providerDot.backgroundColor = accentColor
        providerDot.layer.borderColor = surfaceColor.cgColor
    }

    static func markerAccentColor(_ brandColor: UIColor, against surfaceColor: UIColor) -> UIColor {
        let minimumContrastRatio = 3.5
        guard relativeLuminance(of: surfaceColor) < 0.25,
              contrastRatio(between: brandColor, and: surfaceColor) < minimumContrastRatio else {
            return brandColor
        }

        for step in 1 ... 20 {
            let amount = CGFloat(step) / 20
            let candidate = blend(brandColor, toward: .white, amount: amount)
            if contrastRatio(between: candidate, and: surfaceColor) >= minimumContrastRatio {
                return candidate
            }
        }

        return .white
    }

    static func contrastRatio(between firstColor: UIColor, and secondColor: UIColor) -> Double {
        let firstLuminance = relativeLuminance(of: firstColor)
        let secondLuminance = relativeLuminance(of: secondColor)
        return (max(firstLuminance, secondLuminance) + 0.05) /
            (min(firstLuminance, secondLuminance) + 0.05)
    }

    private static func blend(_ color: UIColor, toward target: UIColor, amount: CGFloat) -> UIColor {
        guard let sourceComponents = color.rgbaComponents,
              let targetComponents = target.rgbaComponents else { return color }

        let amount = min(1, max(0, amount))
        return UIColor(
            red: sourceComponents.red + (targetComponents.red - sourceComponents.red) * amount,
            green: sourceComponents.green + (targetComponents.green - sourceComponents.green) * amount,
            blue: sourceComponents.blue + (targetComponents.blue - sourceComponents.blue) * amount,
            alpha: sourceComponents.alpha + (targetComponents.alpha - sourceComponents.alpha) * amount
        )
    }

    private static func relativeLuminance(of color: UIColor) -> Double {
        guard let components = color.rgbaComponents else { return 0 }

        func linearized(_ component: CGFloat) -> Double {
            let value = Double(component)
            return value <= 0.04045
                ? value / 12.92
                : pow((value + 0.055) / 1.055, 2.4)
        }

        return 0.2126 * linearized(components.red) +
            0.7152 * linearized(components.green) +
            0.0722 * linearized(components.blue)
    }

    func setClusteringEnabled(_ enabled: Bool) {
        clusteringIdentifier = enabled ? Self.clusteringIdentifier : nil
        collisionMode = enabled ? .circle : .none
        displayPriority = enabled ? .defaultHigh : .required
    }

    func refreshAppearance() {
        guard let scooterAnnotation = annotation as? ScooterMapAnnotation else { return }
        let scooter = scooterAnnotation.scooter
        guard scooter != renderedScooter else { return }
        renderedScooter = scooter
        let provider = scooter.providerInfo
        providerBrandColor = provider?.uiColor ?? .systemGray
        updateAdaptiveColors()
        fallbackLabel.text = provider?.shortName ?? "?"
        accessibilityLabel = String(
            format: String(localized: "%@ scooter"),
            provider?.name ?? scooter.provider.capitalized
        )
        var accessibilityDetails: [String] = []
        if let battery = scooter.battery {
            let batteryValue = String(
                format: String(localized: "%lld percent"),
                Int64(battery)
            )
            accessibilityDetails.append("\(String(localized: "Battery")): \(batteryValue)")
        }
        if let range = scooter.formattedRange {
            accessibilityDetails.append("\(String(localized: "Estimated")): \(range)")
        }
        accessibilityValue = accessibilityDetails.isEmpty
            ? nil
            : accessibilityDetails.joined(separator: ", ")
        accessibilityHint = String(localized: "Shows scooter details")
    }

    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: animated)
        if selected {
            accessibilityTraits.insert(.selected)
        } else {
            accessibilityTraits.remove(.selected)
        }
        let changes = {
            self.transform = selected ? CGAffineTransform(scaleX: 1.16, y: 1.16) : .identity
            self.layer.shadowOpacity = selected ? 0.28 : 0.16
            self.layer.shadowRadius = selected ? 8 : 4
            self.layer.shadowOffset = selected
                ? CGSize(width: 0, height: 4)
                : CGSize(width: 0, height: 2)
            self.layer.zPosition = selected ? 1 : 0
            self.selectionHaloView.alpha = selected ? 1 : 0
            self.selectionHaloView.transform = selected
                ? .identity
                : CGAffineTransform(scaleX: 0.84, y: 0.84)
            self.surfaceView.layer.borderWidth = selected ? 2.75 : 1.75
            self.providerDot.transform = selected
                ? CGAffineTransform(scaleX: 1.12, y: 1.12)
                : .identity
        }
        if animated && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(
                withDuration: 0.28,
                delay: 0,
                usingSpringWithDamping: 0.72,
                initialSpringVelocity: 0.25,
                animations: changes
            )
        } else {
            changes()
        }
    }
}

final class ScooterClusterAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "scooter-cluster"

    private let ringView = UIView()
    private let gradientLayer = CAGradientLayer()
    private let ringMaskLayer = CAShapeLayer()
    private let countLabel = UILabel()
    private var renderedProviderCounts: [ScooterProvider: Int] = [:]
    private var renderedCount = 0

    override var annotation: MKAnnotation? {
        didSet { refreshAppearance() }
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        configureView()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureView()
    }

    private func configureView() {
        bounds = CGRect(x: 0, y: 0, width: 48, height: 48)
        centerOffset = CGPoint(x: 0, y: -4)
        collisionMode = .circle
        displayPriority = .required
        canShowCallout = false

        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.16
        layer.shadowRadius = 5
        layer.shadowOffset = CGSize(width: 0, height: 3)
        layer.shadowPath = UIBezierPath(ovalIn: bounds.insetBy(dx: 1, dy: 1)).cgPath

        ringView.frame = bounds.insetBy(dx: 1, dy: 1)
        ringView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        ringView.backgroundColor = .secondarySystemBackground
        ringView.layer.cornerRadius = 23
        ringView.layer.masksToBounds = true
        gradientLayer.mask = ringMaskLayer
        ringView.layer.addSublayer(gradientLayer)
        addSubview(ringView)

        countLabel.bounds = CGRect(x: 0, y: 0, width: 33, height: 33)
        countLabel.center = CGPoint(x: bounds.midX, y: bounds.midY)
        countLabel.autoresizingMask = [
            .flexibleLeftMargin,
            .flexibleRightMargin,
            .flexibleTopMargin,
            .flexibleBottomMargin
        ]
        countLabel.layer.cornerRadius = 16.5
        countLabel.layer.masksToBounds = true
        countLabel.backgroundColor = .tertiarySystemBackground
        countLabel.textColor = .label
        countLabel.textAlignment = .center
        countLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
        addSubview(countLabel)

        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityHint = String(localized: "Zooms in to show individual scooters")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradientLayer.frame = ringView.bounds
        gradientLayer.type = .conic
        gradientLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
        gradientLayer.endPoint = CGPoint(x: 0.5, y: 0)
        ringMaskLayer.frame = gradientLayer.bounds
        ringMaskLayer.path = UIBezierPath(
            ovalIn: gradientLayer.bounds.insetBy(dx: 3, dy: 3)
        ).cgPath
        ringMaskLayer.fillColor = UIColor.clear.cgColor
        ringMaskLayer.strokeColor = UIColor.black.cgColor
        ringMaskLayer.lineWidth = 5
    }

    func refreshAppearance() {
        var providerCounts: [ScooterProvider: Int] = [:]
        providerCounts.reserveCapacity(ScooterProvider.allCases.count)
        let count: Int

        if let cluster = annotation as? MKClusterAnnotation {
            for case let member as ScooterMapAnnotation in cluster.memberAnnotations {
                if let provider = member.scooter.providerInfo {
                    providerCounts[provider, default: 0] += 1
                }
            }
            count = cluster.memberAnnotations.count
        } else if let annotation = annotation as? ScooterServerClusterAnnotation {
            for (providerID, providerCount) in annotation.cluster.providers {
                if let provider = ScooterProvider(rawValue: providerID) {
                    providerCounts[provider, default: 0] += providerCount
                }
            }
            count = annotation.cluster.count
        } else {
            return
        }

        guard count != renderedCount || providerCounts != renderedProviderCounts else { return }
        renderedCount = count
        renderedProviderCounts = providerCounts
        countLabel.text = "\(count)"
        accessibilityLabel = String(
            format: String(localized: "%@ scooters"),
            count.formatted()
        )
        applyProviderGradient(providerCounts, total: count)
    }

    private func applyProviderGradient(_ counts: [ScooterProvider: Int], total: Int) {
        let entries = ScooterProvider.allCases.compactMap { provider -> (ScooterProvider, Int)? in
            guard let count = counts[provider] else { return nil }
            return (provider, count)
        }

        guard !entries.isEmpty else {
            gradientLayer.colors = [
                UIColor.systemGray.withAlphaComponent(0.72).cgColor,
                UIColor.systemGray.withAlphaComponent(0.72).cgColor
            ]
            gradientLayer.locations = [0, 1]
            return
        }

        var colors: [CGColor] = []
        var locations: [NSNumber] = []
        var progress = 0.0
        let total = Double(total)

        for (provider, count) in entries {
            let end = progress + Double(count) / total
            colors.append(provider.uiColor.withAlphaComponent(0.88).cgColor)
            locations.append(NSNumber(value: progress))
            colors.append(provider.uiColor.withAlphaComponent(0.88).cgColor)
            locations.append(NSNumber(value: end))
            progress = end
        }

        gradientLayer.colors = colors
        gradientLayer.locations = locations
    }
}

private extension UIColor {
    var rgbaComponents: (red: CGFloat, green: CGFloat, blue: CGFloat, alpha: CGFloat)? {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        if getRed(&red, green: &green, blue: &blue, alpha: &alpha) {
            return (red, green, blue, alpha)
        }

        var white: CGFloat = 0
        guard getWhite(&white, alpha: &alpha) else { return nil }
        return (white, white, white, alpha)
    }
}
