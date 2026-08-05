import CoreLocation
import MapKit
import SwiftUI
import UIKit

struct Scooter: Decodable, Identifiable, Hashable, Sendable {
    let provider: String
    let latitude: Double
    let longitude: Double
    let battery: Int?
    let rangeMeters: Int?
    let vehicleID: String?
    let deepLink: String?
    let distanceMeters: Double

    var id: String {
        if let vehicleID {
            return "\(provider):\(vehicleID)"
        }
        return "\(provider):\(latitude):\(longitude)"
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var providerInfo: ScooterProvider? {
        ScooterProvider(rawValue: provider)
    }

    func distance(from origin: GeoPoint) -> CLLocationDistance {
        CLLocation(
            latitude: origin.latitude,
            longitude: origin.longitude
        ).distance(
            from: CLLocation(latitude: latitude, longitude: longitude)
        )
    }

    func formattedDistance(from origin: GeoPoint) -> String {
        Self.formattedLength(meters: distance(from: origin))
    }

    var formattedRange: String? {
        guard let rangeMeters else { return nil }
        return Self.formattedLength(meters: Double(rangeMeters))
    }

    private static func formattedLength(meters: Double) -> String {
        Measurement(value: meters, unit: UnitLength.meters).formatted(
            .measurement(width: .abbreviated, usage: .road)
        )
    }

    enum CodingKeys: String, CodingKey {
        case provider
        case latitude = "lat"
        case longitude = "lng"
        case battery
        case rangeMeters = "range_m"
        case vehicleID = "vehicle_id"
        case deepLink = "deep_link"
        case distanceMeters = "distance_m"
    }
}

struct ScooterResponse: Decodable, Sendable {
    let vehicles: [Scooter]
    let meta: ScooterResponseMetadata?

    init(vehicles: [Scooter], meta: ScooterResponseMetadata? = nil) {
        self.vehicles = vehicles
        self.meta = meta
    }
}

struct ScooterResponseMetadata: Decodable, Sendable {
    let partial: Bool
    let stale: Bool
    let failedSources: [String]
    let truncated: Bool
    let totalVehicles: Int?

    init(
        partial: Bool,
        stale: Bool = false,
        failedSources: [String],
        truncated: Bool = false,
        totalVehicles: Int? = nil
    ) {
        self.partial = partial
        self.stale = stale
        self.failedSources = failedSources
        self.truncated = truncated
        self.totalVehicles = totalVehicles
    }

    private enum CodingKeys: String, CodingKey {
        case partial
        case stale
        case failedSources
        case truncated
        case totalVehicles
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        partial = try container.decodeIfPresent(Bool.self, forKey: .partial) ?? false
        stale = try container.decodeIfPresent(Bool.self, forKey: .stale) ?? false
        failedSources = try container.decodeIfPresent([String].self, forKey: .failedSources) ?? []
        truncated = try container.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
        totalVehicles = try container.decodeIfPresent(Int.self, forKey: .totalVehicles)
    }
}

enum ScooterProvider: String, CaseIterable, Identifiable, Sendable {
    case bolt
    case bird
    case dott
    case lime
    case voi
    case hopp
    case publibike

    var id: String { rawValue }

    var name: String {
        switch self {
        case .bolt: "Bolt"
        case .bird: "Bird"
        case .dott: "Dott"
        case .lime: "Lime"
        case .voi: "Voi"
        case .hopp: "Hopp"
        case .publibike: "PubliBike"
        }
    }

    var shortName: String {
        switch self {
        case .bolt: "B"
        case .bird: "Bi"
        case .dott: "D"
        case .lime: "L"
        case .voi: "V"
        case .hopp: "H"
        case .publibike: "PB"
        }
    }

    var color: Color { Color(uiColor: uiColor) }

    var uiColor: UIColor {
        switch self {
        case .bolt: UIColor(red: 0.00, green: 0.80, blue: 0.27, alpha: 1)
        case .bird: UIColor(red: 0.13, green: 0.13, blue: 0.13, alpha: 1)
        case .dott: UIColor(red: 1.00, green: 0.36, blue: 0.00, alpha: 1)
        case .lime: UIColor(red: 0.20, green: 0.80, blue: 0.20, alpha: 1)
        case .voi: UIColor(red: 1.00, green: 0.08, blue: 0.58, alpha: 1)
        case .hopp: UIColor(red: 0.00, green: 0.66, blue: 0.75, alpha: 1)
        case .publibike: UIColor(red: 0.61, green: 0.35, blue: 0.71, alpha: 1)
        }
    }
}

enum AppleMapStyle: String, CaseIterable, Identifiable, Sendable {
    case standard
    case quiet
    case satellite

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: "Standard"
        case .quiet: "Quiet"
        case .satellite: "Satellite"
        }
    }

    var mapType: MKMapType {
        switch self {
        case .standard: .standard
        case .quiet: .mutedStandard
        case .satellite: .hybrid
        }
    }
}

struct GeoPoint: Equatable, Sendable {
    let latitude: Double
    let longitude: Double

    init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    init(_ coordinate: CLLocationCoordinate2D) {
        self.init(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct GeoBounds: Equatable, Sendable {
    let south: Double
    let west: Double
    let north: Double
    let east: Double

    init(region: MKCoordinateRegion) {
        let halfLatitude = region.span.latitudeDelta / 2
        let halfLongitude = region.span.longitudeDelta / 2
        south = max(-90, region.center.latitude - halfLatitude)
        west = max(-180, region.center.longitude - halfLongitude)
        north = min(90, region.center.latitude + halfLatitude)
        east = min(180, region.center.longitude + halfLongitude)
    }

    private init(south: Double, west: Double, north: Double, east: Double) {
        self.south = south
        self.west = west
        self.north = north
        self.east = east
    }

    func contains(_ other: GeoBounds) -> Bool {
        other.south >= south &&
            other.west >= west &&
            other.north <= north &&
            other.east <= east
    }

    func contains(latitude: Double, longitude: Double) -> Bool {
        latitude >= south && latitude <= north && longitude >= west && longitude <= east
    }

    func expanded(by ratio: Double) -> GeoBounds {
        let latitudePadding = (north - south) * ratio
        let longitudePadding = (east - west) * ratio
        return GeoBounds(
            south: max(-90, south - latitudePadding),
            west: max(-180, west - longitudePadding),
            north: min(90, north + latitudePadding),
            east: min(180, east + longitudePadding)
        )
    }
}

struct MapFocusRequest: Equatable, Sendable {
    let point: GeoPoint
    let token: Int
}
