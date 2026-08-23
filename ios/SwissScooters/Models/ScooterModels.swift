import CoreLocation
import MapKit
import SwiftUI
import UIKit

struct Scooter: Identifiable, Hashable, Sendable {
    let provider: String
    let latitude: Double
    let longitude: Double
    let battery: Int?
    let rangeMeters: Int?
    let vehicleID: String?
    let deepLink: String?
    let rentalURIs: ScooterRentalURIs?
    let distanceMeters: Double?

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

    var rentalURL: URL? {
        ScooterRentalLinkPolicy.rentalURL(
            provider: provider,
            rentalURIs: rentalURIs,
            legacyLink: deepLink
        )
    }

    private static func formattedLength(meters: Double) -> String {
        Measurement(value: meters, unit: UnitLength.meters).formatted(
            .measurement(width: .abbreviated, usage: .road)
        )
    }
}

struct ScooterRentalURIs: Hashable, Sendable {
    let ios: String?
    let android: String?
    let web: String?
}

enum ScooterRentalLinkPolicy {
    private struct ProviderPolicy {
        let schemes: Set<String>
        let httpsHosts: Set<String>
    }

    private static let policies: [String: ProviderPolicy] = [
        "bolt": ProviderPolicy(
            schemes: ["bolt"],
            httpsHosts: ["bolt.eu", "bolt.com"]
        ),
        "bird": ProviderPolicy(
            schemes: ["bird"],
            httpsHosts: ["bird.co", "birdapp.com", "birdapp.app.link"]
        ),
        "dott": ProviderPolicy(
            schemes: ["dott", "ridedott"],
            httpsHosts: ["ridedott.com"]
        ),
        "hopp": ProviderPolicy(
            schemes: ["hopp"],
            httpsHosts: ["hopp.bike"]
        ),
        "lime": ProviderPolicy(
            schemes: ["lime", "limebike"],
            httpsHosts: ["li.me", "lime.bike", "limebike.com"]
        ),
        "voi": ProviderPolicy(
            schemes: ["voiapp"],
            httpsHosts: ["voi.com", "voiscooters.com", "lqfa.adj.st"]
        ),
        "publibike": ProviderPolicy(
            schemes: ["publibike", "velospot"],
            httpsHosts: ["publibike.ch", "velospot.info"]
        )
    ]

    static func rentalURL(
        provider: String,
        rentalURIs: ScooterRentalURIs?,
        legacyLink: String?
    ) -> URL? {
        for candidate in [rentalURIs?.ios, rentalURIs?.web, legacyLink] {
            if let url = safeURL(provider: provider, value: candidate) {
                return url
            }
        }
        return nil
    }

    static func safeURL(provider: String, value: String?) -> URL? {
        guard let value else { return nil }
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty,
              candidate.utf8.count <= 2_048,
              !candidate.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              let policy = policies[provider],
              let components = URLComponents(string: candidate),
              components.user == nil,
              components.password == nil,
              let scheme = components.scheme?.lowercased() else { return nil }

        if scheme == "https" {
            guard components.port == nil,
                  let hostname = components.host?.lowercased(),
                  policy.httpsHosts.contains(where: { allowedHost in
                      hostname == allowedHost || hostname.hasSuffix(".\(allowedHost)")
                  }) else { return nil }
        } else if !policy.schemes.contains(scheme) {
            return nil
        }

        return components.url
    }
}

struct ScooterCluster: Identifiable, Hashable, Sendable {
    let id: String
    let latitude: Double
    let longitude: Double
    let count: Int
    let providers: [String: Int]

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    func filtered(to enabledProviders: Set<ScooterProvider>) -> ScooterCluster? {
        let filteredProviders = providers.filter { providerID, _ in
            ScooterProvider(rawValue: providerID).map(enabledProviders.contains) == true
        }
        let filteredCount = filteredProviders.values.reduce(0, +)
        guard filteredCount > 0 else { return nil }
        return ScooterCluster(
            id: id,
            latitude: latitude,
            longitude: longitude,
            count: filteredCount,
            providers: filteredProviders
        )
    }
}

enum ScooterClusteringPolicy {
    static let maximumClusterZoom = 15
    static let denseLocalClusterMinimumCount = 150
    static let maximumDenseLocalClusterZoom = 16.5

    static func shouldCluster(at zoomLevel: Double) -> Bool {
        zoomLevel <= Double(maximumClusterZoom)
    }

    static func shouldCluster(at apiZoom: Int) -> Bool {
        apiZoom <= maximumClusterZoom
    }

    static func shouldClusterLocally(at zoomLevel: Double, scooterCount: Int) -> Bool {
        zoomLevel.isFinite &&
            scooterCount >= denseLocalClusterMinimumCount &&
            zoomLevel <= maximumDenseLocalClusterZoom
    }

    static func apiZoom(for zoomLevel: Double) -> Int {
        guard zoomLevel.isFinite else { return 0 }
        return min(22, max(0, Int(floor(zoomLevel))))
    }

    static func representationsMatch(_ lhs: Int, _ rhs: Int) -> Bool {
        if !shouldCluster(at: lhs), !shouldCluster(at: rhs) {
            return true
        }
        return lhs == rhs
    }
}

struct ScooterResponse: Sendable {
    let vehicles: [Scooter]
    let clusters: [ScooterCluster]
    let providers: [String: Int]
    let meta: ScooterResponseMetadata?

    init(
        vehicles: [Scooter],
        clusters: [ScooterCluster] = [],
        providers: [String: Int] = [:],
        meta: ScooterResponseMetadata? = nil
    ) {
        self.vehicles = vehicles
        self.clusters = clusters
        self.providers = providers
        self.meta = meta
    }
}

struct ScooterResponseMetadata: Sendable {
    let partial: Bool
    let stale: Bool
    let failedSources: [String]
    let sources: [String: String]
    let generatedAt: String?
    let truncated: Bool
    let totalVehicles: Int?
    let mode: String?
    let zoom: Int?

    init(
        partial: Bool,
        stale: Bool = false,
        failedSources: [String],
        sources: [String: String] = [:],
        generatedAt: String? = nil,
        truncated: Bool = false,
        totalVehicles: Int? = nil,
        mode: String? = nil,
        zoom: Int? = nil
    ) {
        self.partial = partial
        self.stale = stale
        self.failedSources = failedSources
        self.sources = sources
        self.generatedAt = generatedAt
        self.truncated = truncated
        self.totalVehicles = totalVehicles
        self.mode = mode
        self.zoom = zoom
    }
}

extension ScooterVehiclePayload {
    var model: Scooter {
        Scooter(
            provider: provider,
            latitude: latitude,
            longitude: longitude,
            battery: battery,
            rangeMeters: rangeMeters,
            vehicleID: vehicleID,
            deepLink: deepLink,
            rentalURIs: rentalURIs.map {
                ScooterRentalURIs(ios: $0.ios, android: $0.android, web: $0.web)
            },
            distanceMeters: distanceMeters
        )
    }
}

extension ScooterClusterPayload {
    var model: ScooterCluster {
        ScooterCluster(
            id: id,
            latitude: latitude,
            longitude: longitude,
            count: count,
            providers: providers
        )
    }
}

extension ScooterResponseMetadataPayload {
    var model: ScooterResponseMetadata {
        ScooterResponseMetadata(
            partial: partial,
            stale: stale,
            failedSources: failedSources,
            sources: sources.mapValues(\.rawValue),
            generatedAt: generatedAt,
            truncated: truncated,
            totalVehicles: totalVehicles,
            mode: mode.rawValue,
            zoom: zoom
        )
    }
}

extension ScooterAPIResponsePayload {
    var model: ScooterResponse {
        ScooterResponse(
            vehicles: vehicles.map(\.model),
            clusters: clusters.map(\.model),
            providers: providers,
            meta: meta.model
        )
    }
}

enum AppleMapStyle: String, CaseIterable, Identifiable, Sendable {
    case standard
    case quiet
    case satellite

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: String(localized: "Standard")
        case .quiet: String(localized: "Quiet")
        case .satellite: String(localized: "Satellite")
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
    let latitudinalMeters: CLLocationDistance
    let longitudinalMeters: CLLocationDistance

    init(
        point: GeoPoint,
        token: Int,
        latitudinalMeters: CLLocationDistance = 850,
        longitudinalMeters: CLLocationDistance = 850
    ) {
        self.point = point
        self.token = token
        self.latitudinalMeters = latitudinalMeters
        self.longitudinalMeters = longitudinalMeters
    }
}

struct MapDestination: Equatable, Sendable {
    let title: String
    let point: GeoPoint
}
