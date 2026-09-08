import CoreLocation
import MapKit
import UIKit

struct ScooterUserHeading: Equatable {
    let direction: CLLocationDirection
    let accuracy: CLLocationDirection

    init?(trueHeading: Double, magneticHeading: Double, accuracy: Double) {
        guard accuracy.isFinite, (0..<90).contains(accuracy) else { return nil }
        let direction = trueHeading.isFinite && trueHeading >= 0 ? trueHeading : magneticHeading
        guard direction.isFinite, (0..<360).contains(direction) else { return nil }
        self.direction = direction
        self.accuracy = accuracy
    }

    var halfAngle: CGFloat {
        CGFloat(min(60, max(22, accuracy))) * .pi / 180
    }

    // Project a short geographic bearing through MapKit so the beam stays aligned
    // with the map even while its camera is rotated or pitched.
    func coordinateAhead(of coordinate: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
        let point = MKMapPoint(coordinate)
        let distance = 30 * MKMapPointsPerMeterAtLatitude(coordinate.latitude)
        let radians = direction * .pi / 180
        return MKMapPoint(
            x: point.x + sin(radians) * distance,
            y: point.y - cos(radians) * distance
        ).coordinate
    }
}

final class ScooterUserLocationView: MKUserLocationView {
    static let reuseIdentifier = "ScooterUserLocation"
    private let headingBeam = ScooterHeadingBeamView()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        headingBeam.isHidden = true
        headingBeam.isUserInteractionEnabled = false
        headingBeam.isAccessibilityElement = false
        headingBeam.layer.zPosition = -1
        addSubview(headingBeam)
        clipsToBounds = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        headingBeam.bounds = CGRect(x: 0, y: 0, width: 144, height: 144)
        headingBeam.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        headingBeam.layer.removeAllAnimations()
        headingBeam.isHidden = true
    }

    func updateHeading(_ heading: ScooterUserHeading?, on mapView: MKMapView, animated: Bool) {
        guard let heading, let coordinate = annotation?.coordinate,
              CLLocationCoordinate2DIsValid(coordinate) else {
            headingBeam.isHidden = true
            return
        }

        let origin = mapView.convert(coordinate, toPointTo: mapView)
        let ahead = mapView.convert(heading.coordinateAhead(of: coordinate), toPointTo: mapView)
        let dx = ahead.x - origin.x
        let dy = ahead.y - origin.y
        guard dx.isFinite, dy.isFinite, hypot(dx, dy) > 0.001 else {
            headingBeam.isHidden = true
            return
        }

        let wasHidden = headingBeam.isHidden
        headingBeam.isHidden = false
        headingBeam.halfAngle = heading.halfAngle
        let transform = CGAffineTransform(rotationAngle: atan2(dx, -dy))
        if animated && !wasHidden && !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(
                withDuration: 0.18,
                delay: 0,
                options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]
            ) {
                self.headingBeam.transform = transform
            }
        } else {
            headingBeam.layer.removeAllAnimations()
            headingBeam.transform = transform
        }
    }
}

final class ScooterHeadingBeamView: UIView {
    var halfAngle: CGFloat = 22 * .pi / 180 {
        didSet {
            if halfAngle != oldValue { setNeedsDisplay() }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        contentMode = .redraw
        registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitAccessibilityContrast.self]) {
            (view: ScooterHeadingBeamView, _: UITraitCollection) in
            view.setNeedsDisplay()
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = min(bounds.width, bounds.height) / 2
        let sector = UIBezierPath()
        sector.move(to: center)
        sector.addArc(
            withCenter: center,
            radius: radius,
            startAngle: -.pi / 2 - halfAngle,
            endAngle: -.pi / 2 + halfAngle,
            clockwise: true
        )
        sector.close()
        context.addPath(sector.cgPath)
        context.clip()

        let blue = UIColor.systemBlue.resolvedColor(with: traitCollection)
        let opacity: CGFloat = traitCollection.accessibilityContrast == .high ? 0.65 : 0.42
        let colors = [
            blue.withAlphaComponent(opacity).cgColor,
            blue.withAlphaComponent(opacity * 0.5).cgColor,
            blue.withAlphaComponent(0).cgColor
        ] as CFArray
        guard let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: colors,
            locations: [0, 0.45, 1]
        ) else { return }
        context.drawRadialGradient(
            gradient,
            startCenter: center,
            startRadius: 0,
            endCenter: center,
            endRadius: radius,
            options: []
        )
    }
}
