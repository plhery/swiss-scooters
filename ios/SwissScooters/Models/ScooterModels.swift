import CoreLocation
import Foundation
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
    let pricing: ScooterRidePricing?

    init(
        provider: String,
        latitude: Double,
        longitude: Double,
        battery: Int?,
        rangeMeters: Int?,
        vehicleID: String?,
        deepLink: String?,
        rentalURIs: ScooterRentalURIs?,
        distanceMeters: Double?,
        pricing: ScooterRidePricing? = nil
    ) {
        self.provider = provider
        self.latitude = latitude
        self.longitude = longitude
        self.battery = battery
        self.rangeMeters = rangeMeters
        self.vehicleID = vehicleID
        self.deepLink = deepLink
        self.rentalURIs = rentalURIs
        self.distanceMeters = distanceMeters
        self.pricing = pricing
    }

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

enum ScooterBatteryLevel: Equatable, Sendable {
    case good
    case low
    case critical

    /// Good from 50%, low from 20% to 49%, critical under 20%, as on the web.
    init(percent: Int) {
        if percent >= 50 {
            self = .good
        } else if percent >= 20 {
            self = .low
        } else {
            self = .critical
        }
    }
}

extension Scooter {
    var batteryLevel: ScooterBatteryLevel? {
        battery.map(ScooterBatteryLevel.init(percent:))
    }
}

struct ScooterRentalURIs: Hashable, Sendable {
    let ios: String?
    let android: String?
    let web: String?
}

struct ScooterRidePricing: Hashable, Sendable {
    let currency: String
    let unlockFeeMinorUnits: Int
    let minuteFeeMinorUnits: Int
}

struct ProviderRidePass: Codable, Hashable, Sendable {
    var enabled: Bool
    var freeUnlock: Bool
    var freeMinutes: Int
    var expiryDate: Date?

    init(
        enabled: Bool = false,
        freeUnlock: Bool = false,
        freeMinutes: Int = 0,
        expiryDate: Date? = nil
    ) {
        self.enabled = enabled
        self.freeUnlock = freeUnlock
        self.freeMinutes = max(0, freeMinutes)
        self.expiryDate = expiryDate
    }

    func isActive(on date: Date = .now, calendar: Calendar = .current) -> Bool {
        guard enabled else { return false }
        guard let expiryDate else { return true }

        let expiryDay = calendar.startOfDay(for: expiryDate)
        guard let firstMomentAfterExpiryDay = calendar.date(
            byAdding: .day,
            value: 1,
            to: expiryDay
        ) else { return false }

        return date < firstMomentAfterExpiryDay
    }
}

enum RideEstimateDuration {
    static let allowedMinutes = [5, 10, 15, 20, 30]
    static let defaultMinutes = 10

    static func normalized(_ minutes: Int) -> Int {
        allowedMinutes.contains(minutes) ? minutes : defaultMinutes
    }
}

struct RidePriceQuote: Hashable, Sendable {
    let currency: String
    let durationMinutes: Int
    let grossMinorUnits: Int
    let totalMinorUnits: Int
    let chargedUnlockFeeMinorUnits: Int
    let billedMinutes: Int
    let freeMinutesApplied: Int
    let passApplied: Bool
}

enum RidePriceEstimator {
    static func quote(
        pricing: ScooterRidePricing,
        durationMinutes: Int,
        pass: ProviderRidePass? = nil,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> RidePriceQuote {
        let durationMinutes = max(0, durationMinutes)
        let unlockFee = max(0, pricing.unlockFeeMinorUnits)
        let minuteFee = max(0, pricing.minuteFeeMinorUnits)
        let grossMinorUnits = totalMinorUnits(
            unlockFee: unlockFee,
            minuteFee: minuteFee,
            billedMinutes: durationMinutes
        )

        let activePass = pass.flatMap { candidate in
            candidate.isActive(on: now, calendar: calendar) ? candidate : nil
        }
        let billedMinutes = max(0, durationMinutes - max(0, activePass?.freeMinutes ?? 0))
        let chargedUnlockFee = activePass?.freeUnlock == true ? 0 : unlockFee
        let totalMinorUnits = totalMinorUnits(
            unlockFee: chargedUnlockFee,
            minuteFee: minuteFee,
            billedMinutes: billedMinutes
        )

        return RidePriceQuote(
            currency: pricing.currency,
            durationMinutes: durationMinutes,
            grossMinorUnits: grossMinorUnits,
            totalMinorUnits: totalMinorUnits,
            chargedUnlockFeeMinorUnits: chargedUnlockFee,
            billedMinutes: billedMinutes,
            freeMinutesApplied: durationMinutes - billedMinutes,
            passApplied: totalMinorUnits < grossMinorUnits
        )
    }

    private static func totalMinorUnits(
        unlockFee: Int,
        minuteFee: Int,
        billedMinutes: Int
    ) -> Int {
        let (minuteTotal, multiplicationOverflowed) = minuteFee.multipliedReportingOverflow(
            by: billedMinutes
        )
        guard !multiplicationOverflowed else { return Int.max }

        let (total, additionOverflowed) = unlockFee.addingReportingOverflow(minuteTotal)
        return additionOverflowed ? Int.max : total
    }
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
        "pony": ProviderPolicy(
            schemes: ["co.ponybikes.mercury", "co.ponybikes.venus"],
            httpsHosts: ["getapony.com"]
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
    var city: String? = nil

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
            providers: filteredProviders,
            city: city
        )
    }
}

enum ScooterClusteringPolicy {
    static let maximumClusterZoom = 15
    static let maximumOverviewZoom = 10

    static func shouldCluster(at zoomLevel: Double) -> Bool {
        zoomLevel <= Double(maximumClusterZoom)
    }

    static func shouldCluster(at apiZoom: Int) -> Bool {
        apiZoom <= maximumClusterZoom
    }

    static func apiZoom(for zoomLevel: Double) -> Int {
        guard zoomLevel.isFinite else { return 0 }
        return min(22, max(0, Int(ceil(zoomLevel))))
    }

    static func representationsMatch(_ lhs: Int, _ rhs: Int) -> Bool {
        if lhs <= maximumOverviewZoom, rhs <= maximumOverviewZoom { return true }
        if !shouldCluster(at: lhs), !shouldCluster(at: rhs) {
            return true
        }
        return lhs == rhs
    }
}

struct ScooterParking: Identifiable, Equatable, Sendable {
    let id: String
    let provider: String
    let name: String
    let latitude: Double
    let longitude: Double
    let mandatory: Bool

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
    var title: String {
        "\(ScooterProvider(rawValue: provider)?.name ?? provider) · \(String(localized: "Parking"))"
    }
    var guidance: String {
        let rule = mandatory ? String(localized: "Designated parking is required in this zone.")
            : String(localized: "Designated scooter parking.")
        return "\(rule)\n\(String(localized: "Check the operator app to confirm you can end your ride here."))"
    }

    var providerInfo: ScooterProvider? {
        ScooterProvider(rawValue: provider)
    }

    var providerName: String {
        providerInfo?.name ?? provider.capitalized
    }

    /// "Dott parking bay", the title of the bay card in the dock.
    var bayTitle: String {
        String(format: String(localized: "%@ parking bay"), providerName)
    }

    /// The card's notice: a warning when parking in a bay is mandatory, neutral otherwise.
    var notice: String {
        mandatory ? String(localized: "You must park in a bay in this zone.")
            : String(localized: "Designated scooter parking.")
    }

    /// "Check the Dott app before you end your ride."
    var footnote: String {
        String(format: String(localized: "Check the %@ app before you end your ride."), providerName)
    }
}

struct ScooterResponse: Sendable {
    let vehicles: [Scooter]
    let clusters: [ScooterCluster]
    let providers: [String: Int]
    let meta: ScooterResponseMetadata?
    let parking: [ScooterParking]

    init(
        vehicles: [Scooter],
        clusters: [ScooterCluster] = [],
        providers: [String: Int] = [:],
        meta: ScooterResponseMetadata? = nil,
        parking: [ScooterParking] = []
    ) {
        self.vehicles = vehicles
        self.clusters = clusters
        self.providers = providers
        self.meta = meta
        self.parking = parking
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
    let overview: Bool
    let refreshAfterSeconds: Int?
    let parkingStatus: String?
    let expiresAt: String?
    let parkingExpiresAt: String?

    init(
        partial: Bool,
        stale: Bool = false,
        failedSources: [String],
        sources: [String: String] = [:],
        generatedAt: String? = nil,
        truncated: Bool = false,
        totalVehicles: Int? = nil,
        mode: String? = nil,
        zoom: Int? = nil,
        overview: Bool = false,
        refreshAfterSeconds: Int? = nil,
        parkingStatus: String? = nil,
        expiresAt: String? = nil,
        parkingExpiresAt: String? = nil
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
        self.overview = overview
        self.refreshAfterSeconds = refreshAfterSeconds
        self.parkingStatus = parkingStatus
        self.expiresAt = expiresAt
        self.parkingExpiresAt = parkingExpiresAt
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
            distanceMeters: distanceMeters,
            pricing: pricing.flatMap { payload in
                let currency = payload.currency.uppercased()
                guard currency.utf8.count == 3,
                      currency.utf8.allSatisfy({ $0 >= 65 && $0 <= 90 }),
                      payload.unlockFeeMinorUnits >= 0,
                      payload.minuteFeeMinorUnits >= 0 else { return nil }
                return ScooterRidePricing(
                    currency: currency,
                    unlockFeeMinorUnits: payload.unlockFeeMinorUnits,
                    minuteFeeMinorUnits: payload.minuteFeeMinorUnits
                )
            }
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
            providers: providers,
            city: city
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
            zoom: zoom,
            overview: overview ?? false,
            refreshAfterSeconds: refreshAfterSeconds,
            parkingStatus: parkingStatus?.rawValue,
            expiresAt: expiresAt,
            parkingExpiresAt: parkingExpiresAt
        )
    }
}

extension ScooterAPIResponsePayload {
    var model: ScooterResponse {
        ScooterResponse(
            vehicles: vehicles.map(\.model),
            clusters: clusters.map(\.model),
            providers: providers,
            meta: meta.model,
            parking: (parking ?? []).map { ScooterParking(id: $0.id, provider: $0.provider,
                name: $0.name, latitude: $0.lat, longitude: $0.lng, mandatory: $0.mandatory) }
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

    init(south: Double, west: Double, north: Double, east: Double) {
        self.south = south
        self.west = west
        self.north = north
        self.east = east
    }

    func intersects(_ other: GeoBounds) -> Bool {
        south <= other.north && north >= other.south && west <= other.east && east >= other.west
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

    func contains(_ point: GeoPoint) -> Bool {
        contains(latitude: point.latitude, longitude: point.longitude)
    }

    var center: GeoPoint {
        GeoPoint(latitude: (south + north) / 2, longitude: (west + east) / 2)
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

extension MapFocusRequest {
    /// The span the map zooms to when a city total is tapped: 0.08° by 0.12°.
    static func city(_ point: GeoPoint, token: Int) -> MapFocusRequest {
        let metersPerDegree = 111_320.0
        return MapFocusRequest(
            point: point,
            token: token,
            latitudinalMeters: 0.08 * metersPerDegree,
            longitudinalMeters: 0.12 * metersPerDegree * cos(point.latitude * .pi / 180)
        )
    }
}

struct MapDestination: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable {
        case address
        /// A covered city: the map shows the whole city rather than one street.
        case city
    }

    let title: String
    /// The second line of a recent place; may be empty.
    let subtitle: String
    let point: GeoPoint
    let kind: Kind
    /// False when no operator serves the place: nothing may promise scooters there.
    let isCovered: Bool

    init(
        title: String,
        subtitle: String = "",
        point: GeoPoint,
        kind: Kind = .address,
        isCovered: Bool? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.point = point
        self.kind = kind
        // Without the search's own answer the bundled service areas decide.
        self.isCovered = isCovered ?? ScooterCityCatalog.contains(point)
    }

    var id: String { "\(title)|\(point.latitude)|\(point.longitude)" }
}

extension ScooterCity {
    /// The country in the user's language, such as "Germany".
    var countryName: String {
        Locale.current.localizedString(forRegionCode: countryCode) ?? countryCode
    }

    /// The city as a place to search from.
    var destination: MapDestination {
        MapDestination(title: name, subtitle: countryName, point: center, kind: .city, isCovered: true)
    }
}

extension ScooterCityDistance {
    /// Whole kilometres such as "61 km", as on the web.
    var formattedDistance: String {
        Measurement(
            value: max(1, (distanceMeters / 1_000).rounded()),
            unit: UnitLength.kilometers
        ).formatted(.measurement(
            width: .abbreviated,
            usage: .asProvided,
            numberFormatStyle: .number.precision(.fractionLength(0))
        ))
    }

    /// "Bern · 61 km", the label of a closest-city chip.
    var label: String {
        String(format: String(localized: "%1$@ · %2$@"), city.name, formattedDistance)
    }
}

/// When scooter data is refreshed automatically. Web and iOS follow the same rules.
struct ScooterRefreshPolicy: Equatable, Sendable {
    /// The interval when a response names none.
    var defaultRefreshAfter: TimeInterval = 60
    /// Refresh this long before the data expires.
    var expiryLead: TimeInterval = 5
    /// Automatic requests leave at least this long after the previous one finished.
    var minimumAttemptGap: TimeInterval = 10

    static let standard = ScooterRefreshPolicy()

    /// When the data is due for a refresh, before the gap between requests is
    /// applied: at the server's interval or shortly before the data expires,
    /// whichever comes first. Without a successful load it is always due.
    func refreshDue(
        lastSuccess: Date?,
        refreshAfter: TimeInterval,
        expiresAt: Date?
    ) -> Date {
        guard let lastSuccess else { return .distantPast }
        let interval = lastSuccess.addingTimeInterval(max(minimumAttemptGap, refreshAfter))
        guard let expiresAt else { return interval }
        return min(interval, expiresAt.addingTimeInterval(-expiryLead))
    }

    /// When the next automatic request may start. `lastAttempt` is when the
    /// previous request finished, whatever its outcome.
    func nextAttempt(
        lastSuccess: Date?,
        refreshAfter: TimeInterval,
        expiresAt: Date?,
        lastAttempt: Date?
    ) -> Date {
        let due = refreshDue(lastSuccess: lastSuccess, refreshAfter: refreshAfter, expiresAt: expiresAt)
        guard let lastAttempt else { return due }
        return max(due, lastAttempt.addingTimeInterval(minimumAttemptGap))
    }
}

/// What went wrong with loading scooters, and what is still on the map.
enum ScooterLoadIssue: Equatable, Sendable {
    /// Nothing has loaded yet and the load failed: the banner under the search bar.
    case firstLoadFailed(ScooterLoadFailure)
    /// The last refresh failed and the data from `showing` is still on the map,
    /// unchanged: the warning status line and the Try again pill in the dock.
    case refreshFailed(ScooterLoadFailure, showing: Date)
    /// The data expired and the refresh after that failed, so the map was cleared:
    /// the out-of-date card in the dock.
    case outOfDate(ScooterLoadFailure, lastUpdate: Date)

    var failure: ScooterLoadFailure {
        switch self {
        case let .firstLoadFailed(failure),
             let .refreshFailed(failure, _),
             let .outOfDate(failure, _):
            failure
        }
    }
}

/// Which providers are not sharing data for the area on screen.
struct ScooterProviderHealth: Equatable, Sendable {
    /// Providers with a failed feed that operate in the viewport, in catalogue order.
    let downProviders: [ScooterProvider]
    /// A failed source belongs to no known provider, such as "city-overview".
    let hasUnknownFailures: Bool

    static let healthy = ScooterProviderHealth(downProviders: [], hasUnknownFailures: false)

    init(downProviders: [ScooterProvider], hasUnknownFailures: Bool) {
        self.downProviders = downProviders
        self.hasUnknownFailures = hasUnknownFailures
    }

    init(failedSources: [String], operating: [ScooterProvider]) {
        var failed = Set<ScooterProvider>()
        var hasUnknownFailures = false
        for source in failedSources {
            if let provider = Self.provider(forSource: source) {
                failed.insert(provider)
            } else {
                hasUnknownFailures = true
            }
        }
        let operating = Set(operating)
        downProviders = ScooterProvider.allCases.filter {
            failed.contains($0) && operating.contains($0)
        }
        self.hasUnknownFailures = hasUnknownFailures
    }

    /// The provider behind an entry of `failedSources`. An id can carry its
    /// source in front ("national:lime_zurich", "france:dott_fr_lyon", plain
    /// "hopp"), so the source goes before the system id is matched.
    static func provider(forSource source: String) -> ScooterProvider? {
        let systemID = source.firstIndex(of: ":").map { source[source.index(after: $0)...] } ?? source[...]
        return ScooterProvider.provider(forSystemID: String(systemID))
    }
}

/// What the dock shows; `ScooterMapModel.dock` picks the one that applies.
enum ScooterDockContent: Equatable, Sendable {
    /// Only the scooter card: no count, no chips.
    case scooter(Scooter)
    /// Only the parking bay card.
    case parking(ScooterParking)
    /// The out-of-date card with a Refresh button, instead of count and chips.
    case outOfDate(ScooterLoadFailure, lastUpdate: Date)
    /// The answer for this view is on its way: "Finding scooters…" instead of
    /// a count. The chips are empty until something has loaded.
    case finding(chips: [ScooterProviderEntry])
    /// Nothing has loaded and the load failed: "Waiting for scooter data", no count, no chips.
    case waiting
    /// No provider operates here: the three closest covered cities.
    case outsideCoverage([ScooterCityDistance])
    /// There are scooters here, all of them hidden by the filters.
    case filtersHideEverything(ScooterFilterSummary)
    /// Count, status line, notices and chips.
    case summary(ScooterDockSummary)
}

struct ScooterDockSummary: Equatable, Sendable {
    let count: Int
    let countContext: ScooterCountContext
    /// When the data on the map was observed.
    let lastUpdated: Date
    /// Set while the last refresh failed and the earlier data is still shown.
    let refreshFailure: ScooterLoadFailure?
    /// City totals instead of single scooters.
    let isOverview: Bool
    /// The server answered with data it could not renew.
    let isDelayed: Bool
    /// One calm line each, under the status.
    let notices: [ScooterDockNotice]
    let hint: ScooterDockHint?
    /// Providers after the "All" chip, in display order.
    let chips: [ScooterProviderEntry]

    /// "scooters nearby" or "scooters on this map"; the view renders the number.
    var countLabel: String { countContext.label(for: count) }

    /// The Try again pill at the right of the dock header.
    var showsTryAgain: Bool { refreshFailure != nil }

    /// The status line. It changes as the data ages, so ask again over time.
    func status(at now: Date = .now) -> ScooterDockStatus {
        if let refreshFailure {
            return refreshFailure == .offline
                ? .offline(showing: lastUpdated)
                : .refreshFailed(showing: lastUpdated)
        }
        // Delayed data says so at every zoom, city totals included.
        if isDelayed { return .delayed(showing: lastUpdated) }
        if isOverview { return .cityTotals }

        let age = max(0, now.timeIntervalSince(lastUpdated))
        if age < ScooterDockStatus.liveWindow { return .live }
        if age < 3_600 { return .updatedMinutesAgo(Int(age / 60)) }
        return .updatedAt(lastUpdated)
    }
}

enum ScooterCountContext: Equatable, Sendable {
    /// Your location or the chosen place is on screen.
    case nearby
    case onThisMap

    func label(for count: Int) -> String {
        switch (self, count == 1) {
        case (.nearby, true): String(localized: "scooter nearby")
        case (.nearby, false): String(localized: "scooters nearby")
        case (.onThisMap, true): String(localized: "scooter on this map")
        case (.onThisMap, false): String(localized: "scooters on this map")
        }
    }
}

enum ScooterDockStatus: Equatable, Sendable {
    case refreshFailed(showing: Date)
    case offline(showing: Date)
    case cityTotals
    case delayed(showing: Date)
    case live
    case updatedMinutesAgo(Int)
    case updatedAt(Date)

    /// Data younger than this reads "Live".
    static let liveWindow: TimeInterval = 90

    /// Failed refreshes use the warning style.
    var isWarning: Bool {
        switch self {
        case .refreshFailed, .offline: true
        default: false
        }
    }

    /// The green dot in front of "Live".
    var isLive: Bool { self == .live }

    var text: String {
        switch self {
        case let .refreshFailed(date):
            String(format: String(localized: "Couldn’t refresh · showing %@"), Self.clockTime(date))
        case let .offline(date):
            String(format: String(localized: "You’re offline · showing %@"), Self.clockTime(date))
        case .cityTotals:
            String(localized: "City totals · refreshed hourly")
        case let .delayed(date):
            String(format: String(localized: "Data delayed · showing %@"), Self.clockTime(date))
        case .live:
            String(localized: "Live")
        case let .updatedMinutesAgo(minutes):
            String(format: String(localized: "Updated %lld min ago"), Int64(minutes))
        case let .updatedAt(date):
            String(format: String(localized: "Updated %@"), Self.clockTime(date))
        }
    }

    /// "14:02", the time of day in the user's format.
    static func clockTime(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// The body of the out-of-date card: "Last update 14:02. You’re offline. Check your connection."
    static func outOfDateBody(_ failure: ScooterLoadFailure, lastUpdate: Date) -> String {
        "\(String(format: String(localized: "Last update %@."), clockTime(lastUpdate))) \(failure.message)"
    }
}

enum ScooterDockNotice: Hashable, Identifiable, Sendable {
    /// Named providers, in catalogue order; never empty.
    case providersDown([ScooterProvider])
    /// Only sources that belong to no known provider failed.
    case someProvidersDown
    case truncated(shown: Int, total: Int)
    case parkingUnavailable
    case parkingOutOfDate

    var id: Self { self }

    var text: String {
        switch self {
        case let .providersDown(providers) where providers.count == 1:
            String(format: String(localized: "%@ isn’t sharing data right now."), providers[0].name)
        case let .providersDown(providers) where providers.count == 2:
            String(
                format: String(localized: "%1$@ and %2$@ aren’t sharing data right now."),
                providers[0].name,
                providers[1].name
            )
        case let .providersDown(providers):
            String(
                format: String(localized: "%lld providers aren’t sharing data right now."),
                Int64(providers.count)
            )
        case .someProvidersDown:
            String(localized: "Some providers aren’t sharing data right now.")
        case let .truncated(shown, total):
            String(
                format: String(localized: "Showing %1$@ of %2$@ — zoom in to see all"),
                shown.formatted(),
                total.formatted()
            )
        case .parkingUnavailable:
            String(localized: "Parking bays unavailable right now")
        case .parkingOutOfDate:
            String(localized: "Parking bays may be out of date")
        }
    }

    /// Providers down, then truncation, then parking.
    static func notices(
        health: ScooterProviderHealth,
        metadata: ScooterResponseMetadata,
        shownCount: Int
    ) -> [ScooterDockNotice] {
        var notices: [ScooterDockNotice] = []
        if !health.downProviders.isEmpty {
            notices.append(.providersDown(health.downProviders))
        } else if health.hasUnknownFailures {
            notices.append(.someProvidersDown)
        }
        if metadata.truncated {
            notices.append(.truncated(shown: shownCount, total: metadata.totalVehicles ?? shownCount))
        }
        if metadata.parkingStatus == "failed" || metadata.parkingStatus == "partial" {
            notices.append(.parkingUnavailable)
        } else if metadata.parkingStatus == "stale" {
            notices.append(.parkingOutOfDate)
        }
        return notices
    }
}

enum ScooterDockHint: Equatable, Sendable {
    /// City totals are on screen: "Tap a city to see its scooters."
    case tapCity
    /// A covered area with no scooters: "No scooters here right now. Zoom out or move the map."
    case emptyArea

    var text: String {
        switch self {
        case .tapCity: String(localized: "Tap a city to see its scooters.")
        case .emptyArea: String(localized: "No scooters here right now. Zoom out or move the map.")
        }
    }
}

/// The dismissible card under the search bar when locating did not work.
enum ScooterLocationIssue: Equatable, Sendable {
    /// Refused: "Location is off", with Open Settings and Search a place.
    case denied
    /// Restricted on this device: Search a place only.
    case restricted
    /// No position in time: Try again.
    case notFound

    var title: String? {
        self == .denied ? String(localized: "Location is off") : nil
    }

    var message: String {
        switch self {
        case .denied: String(localized: "Turn it on in Settings, or search a place instead.")
        case .restricted: String(localized: "Location is restricted on this device. Search a place instead.")
        case .notFound: String(localized: "Couldn’t find your location.")
        }
    }

    var canOpenSettings: Bool { self == .denied }
    var canSearchPlace: Bool { self != .notFound }
    var canRetry: Bool { self == .notFound }
}

/// What the collapsed search bar shows.
enum ScooterSearchBarState: Equatable, Sendable {
    /// Nothing chosen: search icon and "Search city or address".
    case empty
    /// Using your location: "Near you" / "Tap to search a city or address".
    case nearYou
    /// A searched place: its title / "Scooters near this place", with a clear
    /// button. A place no operator serves gets the neutral second line instead.
    case place(MapDestination)
    /// A spinner and "Finding your location…".
    case locating

    var title: String {
        switch self {
        case .empty: String(localized: "Search city or address")
        case .nearYou: String(localized: "Near you")
        case let .place(destination): destination.title
        case .locating: String(localized: "Finding your location…")
        }
    }

    /// The second line; nil when there is only one.
    var subtitle: String? {
        switch self {
        case .nearYou:
            String(localized: "Tap to search a city or address")
        case let .place(destination):
            // "Scooters near this place" would be untrue where there is no scooter data.
            destination.isCovered
                ? String(localized: "Scooters near this place")
                : String(localized: "Tap to search a city or address")
        case .empty, .locating:
            nil
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .nearYou:
            String(localized: "Showing scooters near you. Search a city or address.")
        case let .place(destination) where destination.isCovered:
            String(format: String(localized: "Showing scooters near %@. Search another place."), destination.title)
        case let .place(destination):
            // No scooters to announce: the place, then the same neutral line as on screen.
            "\(destination.title). \(String(localized: "Tap to search a city or address"))"
        case .empty, .locating:
            title
        }
    }
}
