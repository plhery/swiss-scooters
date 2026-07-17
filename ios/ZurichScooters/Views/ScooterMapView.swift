import MapKit
import SwiftUI
import UIKit

enum ScooterClusteringPolicy {
    static let maximumClusterZoom = 15.0

    static func shouldCluster(at zoomLevel: Double) -> Bool {
        zoomLevel <= maximumClusterZoom
    }
}

struct ScooterMapView: UIViewRepresentable {
    let scooters: [Scooter]
    let mapStyle: AppleMapStyle
    let focusRequest: MapFocusRequest?
    let selectedScooterID: String?
    let onRegionChange: (MKCoordinateRegion) -> Void
    let onSelectionChange: (String?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MKMapView {
        let mapView = MKMapView(frame: .zero)
        mapView.delegate = context.coordinator
        mapView.mapType = mapStyle.mapType
        mapView.showsUserLocation = true
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.pointOfInterestFilter = .excludingAll
        mapView.isPitchEnabled = true
        mapView.register(
            ScooterAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterAnnotationView.reuseIdentifier
        )
        mapView.register(
            ScooterClusterAnnotationView.self,
            forAnnotationViewWithReuseIdentifier: ScooterClusterAnnotationView.reuseIdentifier
        )
        mapView.setRegion(ScooterMapModel.initialRegion, animated: false)
        return mapView
    }

    func updateUIView(_ mapView: MKMapView, context: Context) {
        context.coordinator.parent = self
        if mapView.mapType != mapStyle.mapType {
            mapView.mapType = mapStyle.mapType
        }
        context.coordinator.updateClusteringMode(on: mapView)
        context.coordinator.reconcile(scooters, on: mapView)
        context.coordinator.applySelection(selectedScooterID, on: mapView)
        context.coordinator.applyFocus(focusRequest, on: mapView)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: ScooterMapView
        private var annotationsByID: [String: ScooterMapAnnotation] = [:]
        private var lastFocusToken: Int?
        private var appliedSelectionID: String?
        private var reconciledScooters: [Scooter] = []
        private var clusteringEnabled: Bool?

        init(parent: ScooterMapView) {
            self.parent = parent
        }

        func reconcile(_ scooters: [Scooter], on mapView: MKMapView) {
            guard scooters != reconciledScooters else { return }
            reconciledScooters = scooters

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
                latitudinalMeters: 850,
                longitudinalMeters: 850
            )
            mapView.setRegion(region, animated: true)
        }

        func updateClusteringMode(on mapView: MKMapView) {
            guard mapView.bounds.width > 0, mapView.visibleMapRect.width > 0 else { return }

            let shouldCluster = ScooterClusteringPolicy.shouldCluster(
                at: Self.zoomLevel(on: mapView)
            )
            guard shouldCluster != clusteringEnabled else { return }
            clusteringEnabled = shouldCluster

            for case let annotation as ScooterMapAnnotation in mapView.annotations {
                mapView.view(for: annotation)?.clusteringIdentifier = shouldCluster
                    ? ScooterAnnotationView.clusteringIdentifier
                    : nil
            }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            updateClusteringMode(on: mapView)
            let region = mapView.region
            Task { @MainActor [parent] in
                parent.onRegionChange(region)
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation {
                return nil
            }

            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: ScooterClusterAnnotationView.reuseIdentifier,
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
            view.clusteringIdentifier = ScooterClusteringPolicy.shouldCluster(
                at: Self.zoomLevel(on: mapView)
            )
                ? ScooterAnnotationView.clusteringIdentifier
                : nil
            view.refreshAppearance()
            return view
        }

        private static func zoomLevel(on mapView: MKMapView) -> Double {
            guard mapView.bounds.width > 0, mapView.visibleMapRect.width > 0 else { return 0 }
            let zoomScale = Double(mapView.bounds.width) / mapView.visibleMapRect.width
            return log2(zoomScale * MKMapSize.world.width / 256)
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            if let cluster = view.annotation as? MKClusterAnnotation {
                mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                mapView.deselectAnnotation(cluster, animated: false)
                return
            }

            guard let annotation = view.annotation as? ScooterMapAnnotation else { return }
            appliedSelectionID = annotation.scooter.id
            parent.onSelectionChange(annotation.scooter.id)
        }

        func mapView(_ mapView: MKMapView, didDeselect view: MKAnnotationView) {
            guard let annotation = view.annotation as? ScooterMapAnnotation,
                  appliedSelectionID == annotation.scooter.id else { return }
            appliedSelectionID = nil
            parent.onSelectionChange(nil)
        }
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

final class ScooterAnnotationView: MKAnnotationView {
    static let reuseIdentifier = "scooter"
    static let clusteringIdentifier = "scooters"

    private let monogramLabel = UILabel()
    private var renderedScooter: Scooter?

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
        bounds = CGRect(x: 0, y: 0, width: 36, height: 36)
        centerOffset = CGPoint(x: 0, y: -3)
        collisionMode = .circle
        displayPriority = .defaultHigh
        clusteringIdentifier = Self.clusteringIdentifier
        canShowCallout = false

        layer.cornerRadius = 18
        layer.borderWidth = 3
        layer.borderColor = UIColor.white.withAlphaComponent(0.96).cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.25
        layer.shadowRadius = 6
        layer.shadowOffset = CGSize(width: 0, height: 3)
        layer.shadowPath = UIBezierPath(ovalIn: bounds).cgPath

        monogramLabel.frame = bounds
        monogramLabel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        monogramLabel.textAlignment = .center
        monogramLabel.textColor = .white
        monogramLabel.font = .systemFont(ofSize: 10, weight: .heavy)
        monogramLabel.adjustsFontSizeToFitWidth = true
        monogramLabel.minimumScaleFactor = 0.7
        addSubview(monogramLabel)

        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    func refreshAppearance() {
        guard let scooterAnnotation = annotation as? ScooterMapAnnotation else { return }
        let scooter = scooterAnnotation.scooter
        guard scooter != renderedScooter else { return }
        renderedScooter = scooter
        let provider = scooter.providerInfo
        backgroundColor = provider?.uiColor ?? .systemGray
        monogramLabel.text = provider?.shortName ?? "?"
        accessibilityLabel = "\(provider?.name ?? scooter.provider) scooter"
        accessibilityHint = "Shows scooter details"
    }

    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: animated)
        let changes = {
            self.transform = selected ? CGAffineTransform(scaleX: 1.18, y: 1.18) : .identity
            self.layer.shadowOpacity = selected ? 0.38 : 0.25
            self.layer.shadowRadius = selected ? 9 : 6
        }
        if animated {
            UIView.animate(
                withDuration: 0.25,
                delay: 0,
                usingSpringWithDamping: 0.68,
                initialSpringVelocity: 0.3,
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
        bounds = CGRect(x: 0, y: 0, width: 50, height: 50)
        centerOffset = CGPoint(x: 0, y: -4)
        collisionMode = .circle
        displayPriority = .required
        canShowCallout = false

        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.24
        layer.shadowRadius = 7
        layer.shadowOffset = CGSize(width: 0, height: 4)
        layer.shadowPath = UIBezierPath(ovalIn: bounds).cgPath

        ringView.frame = bounds
        ringView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        ringView.layer.cornerRadius = 25
        ringView.layer.masksToBounds = true
        ringView.layer.borderWidth = 3
        ringView.layer.borderColor = UIColor.white.withAlphaComponent(0.96).cgColor
        ringView.layer.addSublayer(gradientLayer)
        addSubview(ringView)

        countLabel.bounds = CGRect(x: 0, y: 0, width: 31, height: 31)
        countLabel.center = CGPoint(x: bounds.midX, y: bounds.midY)
        countLabel.autoresizingMask = [
            .flexibleLeftMargin,
            .flexibleRightMargin,
            .flexibleTopMargin,
            .flexibleBottomMargin
        ]
        countLabel.layer.cornerRadius = 15.5
        countLabel.layer.masksToBounds = true
        countLabel.backgroundColor = UIColor.label.withAlphaComponent(0.76)
        countLabel.textColor = .systemBackground
        countLabel.textAlignment = .center
        countLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .bold)
        addSubview(countLabel)

        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityHint = "Zooms in to show individual scooters"
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        gradientLayer.frame = ringView.bounds
        gradientLayer.type = .conic
        gradientLayer.startPoint = CGPoint(x: 0.5, y: 0.5)
        gradientLayer.endPoint = CGPoint(x: 0.5, y: 0)
    }

    func refreshAppearance() {
        guard let cluster = annotation as? MKClusterAnnotation else { return }
        var providerCounts: [ScooterProvider: Int] = [:]
        providerCounts.reserveCapacity(ScooterProvider.allCases.count)

        for case let member as ScooterMapAnnotation in cluster.memberAnnotations {
            if let provider = member.scooter.providerInfo {
                providerCounts[provider, default: 0] += 1
            }
        }

        let count = cluster.memberAnnotations.count
        guard count != renderedCount || providerCounts != renderedProviderCounts else { return }
        renderedCount = count
        renderedProviderCounts = providerCounts
        countLabel.text = "\(count)"
        accessibilityLabel = "\(count) scooters"
        applyProviderGradient(providerCounts, total: count)
    }

    private func applyProviderGradient(_ counts: [ScooterProvider: Int], total: Int) {
        let entries = ScooterProvider.allCases.compactMap { provider -> (ScooterProvider, Int)? in
            guard let count = counts[provider] else { return nil }
            return (provider, count)
        }

        guard !entries.isEmpty else {
            gradientLayer.colors = [UIColor.systemGray.cgColor, UIColor.systemGray.cgColor]
            gradientLayer.locations = [0, 1]
            return
        }

        var colors: [CGColor] = []
        var locations: [NSNumber] = []
        var progress = 0.0
        let total = Double(total)

        for (provider, count) in entries {
            let end = progress + Double(count) / total
            colors.append(provider.uiColor.cgColor)
            locations.append(NSNumber(value: progress))
            colors.append(provider.uiColor.cgColor)
            locations.append(NSNumber(value: end))
            progress = end
        }

        gradientLayer.colors = colors
        gradientLayer.locations = locations
    }
}
