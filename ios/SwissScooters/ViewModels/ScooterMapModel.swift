import CoreLocation
import Foundation
import MapKit
import Observation

enum ScooterLocationPolicy {
    static let preferredAccuracy: CLLocationAccuracy = 200
    static let fallbackAccuracy: CLLocationAccuracy = 1_000
    static let maximumAge: TimeInterval = 30

    static func isAcceptable(
        _ location: CLLocation,
        maximumAccuracy: CLLocationAccuracy
    ) -> Bool {
        location.horizontalAccuracy >= 0 &&
            location.horizontalAccuracy <= maximumAccuracy &&
            abs(location.timestamp.timeIntervalSinceNow) <= maximumAge
    }

    static func bestCandidate(
        in locations: [CLLocation],
        maximumAccuracy: CLLocationAccuracy = fallbackAccuracy
    ) -> CLLocation? {
        locations
            .filter { isAcceptable($0, maximumAccuracy: maximumAccuracy) }
            .min(by: { $0.horizontalAccuracy < $1.horizontalAccuracy })
    }
}

enum LocationAuthorizationIssue: Equatable {
    case denied
    case restricted

    var message: String {
        switch self {
        case .denied:
            String(localized: "Location access is off. Enable it in Settings to find scooters near you.")
        case .restricted:
            String(localized: "Location access is restricted on this device. You can still browse the map manually.")
        }
    }

    var canOpenSettings: Bool {
        self == .denied
    }
}

private struct PartialScooterResponseError: LocalizedError {
    let failedSources: [String]

    var errorDescription: String? {
        let sourceDescription = failedSources.isEmpty
            ? String(localized: "one or more data sources")
            : failedSources.joined(separator: ", ")
        return String(
            format: String(localized: "Scooter data from %@ is temporarily unavailable. Keeping the last complete map."),
            sourceDescription
        )
    }
}

@MainActor
@Observable
final class ScooterMapModel: NSObject, @MainActor CLLocationManagerDelegate {
    static let switzerlandCenter = GeoPoint(latitude: 46.8182, longitude: 8.2275)
    static let initialRegion = MKCoordinateRegion(
        center: switzerlandCenter.coordinate,
        latitudinalMeters: 300_000,
        longitudinalMeters: 500_000
    )

    private(set) var vehicles: [Scooter] = [] {
        didSet {
            rebuildMapScooters()
            rebuildVisibleCounts()
        }
    }
    var viewport = GeoBounds(region: initialRegion) {
        didSet { rebuildVisibleCounts() }
    }
    var isLoading = false
    var isLocating = false
    var errorMessage: String?
    var lastUpdated: Date?
    private(set) var responseMetadata: ScooterResponseMetadata?
    var userLocation: GeoPoint?
    private(set) var locationAuthorizationIssue: LocationAuthorizationIssue?
    var enabledProviders = Set(ScooterProvider.allCases) {
        didSet {
            rebuildMapScooters()
            rebuildVisibleCounts()
            clearSelectionIfHidden()
        }
    }
    var selectedScooterID: String?
    var searchedDestination: MapDestination?
    var focusRequest: MapFocusRequest?

    var minimumBattery: Double {
        didSet {
            defaults.set(Int(minimumBattery), forKey: Self.minimumBatteryKey)
            rebuildMapScooters()
            rebuildVisibleCounts()
            clearSelectionIfHidden()
        }
    }

    var mapStyle: AppleMapStyle {
        didSet {
            defaults.set(mapStyle.rawValue, forKey: Self.mapStyleKey)
        }
    }

    @ObservationIgnored private let api: any ScooterAPIClient
    @ObservationIgnored private let locationManager: CLLocationManager
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var queryBounds: GeoBounds?
    @ObservationIgnored private var pendingQueryBounds: GeoBounds?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var locationTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var bestLocationCandidate: CLLocation?
    @ObservationIgnored private var focusToken = 0
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var hasCompleteResponse = false
    @ObservationIgnored private var distanceOrigin = switzerlandCenter
    private(set) var mapScooters: [Scooter] = []
    private(set) var visibleScooterCount = 0
    private(set) var visibleProviderCounts: [ScooterProvider: Int] = [:]

    private static let minimumBatteryKey = "minimum-battery"
    private static let mapStyleKey = "apple-map-style"
    private static let locationTimeout: Duration = .seconds(5)

    override convenience init() {
        self.init(api: ScooterAPI(), locationManager: CLLocationManager(), defaults: .standard)
    }

    init(
        api: any ScooterAPIClient,
        locationManager: CLLocationManager,
        defaults: UserDefaults
    ) {
        self.api = api
        self.locationManager = locationManager
        self.defaults = defaults

        let savedBattery = defaults.object(forKey: Self.minimumBatteryKey) as? Int ?? 0
        minimumBattery = Double(savedBattery)

        let savedStyle = defaults.string(forKey: Self.mapStyleKey)
        mapStyle = AppleMapStyle(rawValue: savedStyle ?? "") ?? .standard

        super.init()

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 20
    }

    var selectedScooter: Scooter? {
        guard let selectedScooterID else { return nil }
        return vehicles.first { $0.id == selectedScooterID }
    }

    var visibleCount: Int { visibleScooterCount }

    var allProvidersSelected: Bool {
        enabledProviders == Set(ScooterProvider.allCases)
    }

    var hasActiveFilters: Bool {
        minimumBattery > 0 || !allProvidersSelected
    }

    var nearbyScooters: [Scooter] {
        let center = GeoPoint(
            latitude: (viewport.south + viewport.north) / 2,
            longitude: (viewport.west + viewport.east) / 2
        )
        let origin = userLocation ?? center
        return mapScooters
            .filter { viewport.contains(latitude: $0.latitude, longitude: $0.longitude) }
            .sorted { $0.distance(from: origin) < $1.distance(from: origin) }
            .prefix(5)
            .map { $0 }
    }

    var dataHealthMessage: String? {
        guard let responseMetadata else { return nil }

        var messages: [String] = []
        if responseMetadata.stale {
            messages.append(String(localized: "Showing cached data"))
        }
        if responseMetadata.partial {
            messages.append(String(localized: "Some providers are unavailable"))
        }
        if responseMetadata.truncated {
            let total = responseMetadata.totalVehicles ?? vehicles.count
            messages.append(String(
                format: String(localized: "Showing %@ of %@ results"),
                vehicles.count.formatted(),
                total.formatted()
            ))
        }
        return messages.isEmpty ? nil : messages.joined(separator: " · ")
    }

    func count(for provider: ScooterProvider) -> Int {
        visibleProviderCounts[provider, default: 0]
    }

    var allProviderCount: Int {
        visibleProviderCounts.values.reduce(0, +)
    }

    func formattedDistance(for scooter: Scooter) -> String? {
        guard let userLocation else { return nil }
        return scooter.formattedDistance(from: userLocation)
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            if let cachedLocation = locationManager.location,
               ScooterLocationPolicy.isAcceptable(
                   cachedLocation,
                   maximumAccuracy: ScooterLocationPolicy.preferredAccuracy
               ) {
                acceptLocation(cachedLocation)
            } else {
                requestLocationAccess()
            }
        default:
            refresh()
        }
    }

    func becameActive() {
        refreshIfStale()
    }

    func autoRefreshIfNeeded() {
        refreshIfStale()
    }

    private func refreshIfStale() {
        guard let lastUpdated else {
            if fetchTask == nil, !isLocating {
                refresh()
            }
            return
        }
        if fetchTask == nil, Date().timeIntervalSince(lastUpdated) >= 60 {
            refresh()
        }
    }

    func updateViewport(_ region: MKCoordinateRegion) {
        let nextViewport = GeoBounds(region: region)
        viewport = nextViewport
        clearSelectionIfHidden()

        guard queryBounds?.contains(nextViewport) != true,
              pendingQueryBounds?.contains(nextViewport) != true else { return }
        scheduleFetch(for: nextViewport.expanded(by: 0.25), debounce: true)
    }

    func refresh() {
        scheduleFetch(for: viewport.expanded(by: 0.25), debounce: false)
    }

    func showAllProviders() {
        enabledProviders = Set(ScooterProvider.allCases)
    }

    func toggle(provider: ScooterProvider) {
        if enabledProviders.contains(provider) {
            enabledProviders.remove(provider)
        } else {
            enabledProviders.insert(provider)
        }
    }

    func resetFilters() {
        minimumBattery = 0
        enabledProviders = Set(ScooterProvider.allCases)
    }

    func setMinimumBattery(_ value: Double) {
        let normalizedValue = min(100, max(0, (value / 5).rounded() * 5))
        guard normalizedValue != minimumBattery else { return }
        minimumBattery = normalizedValue
    }

    func focusOnUser() {
        if let userLocation {
            focusToken += 1
            focusRequest = MapFocusRequest(point: userLocation, token: focusToken)
        } else {
            isLocating = true
            requestLocationAccess()
        }
    }

    func focusOnAddress(_ destination: MapDestination) {
        selectedScooterID = nil
        searchedDestination = destination
        focusToken += 1
        focusRequest = MapFocusRequest(point: destination.point, token: focusToken)
    }

    func focusOnSwitzerland() {
        selectedScooterID = nil
        focusToken += 1
        focusRequest = MapFocusRequest(
            point: Self.switzerlandCenter,
            token: focusToken,
            latitudinalMeters: 300_000,
            longitudinalMeters: 500_000
        )
    }

    func focusOnScooter(_ scooter: Scooter) {
        selectedScooterID = scooter.id
        focusToken += 1
        focusRequest = MapFocusRequest(point: GeoPoint(scooter.coordinate), token: focusToken)
    }

    func clearAddressSearch() {
        searchedDestination = nil
    }

    func selectScooter(_ id: String?) {
        selectedScooterID = id
    }

    private func passesBatteryFilter(_ scooter: Scooter) -> Bool {
        ScooterFiltering.passesBattery(scooter, minimumBattery: minimumBattery)
    }

    private func rebuildMapScooters() {
        mapScooters = ScooterFiltering.mapScooters(
            from: vehicles,
            minimumBattery: minimumBattery,
            enabledProviders: enabledProviders
        )
    }

    private func rebuildVisibleCounts() {
        let summary = ScooterFiltering.visibleSummary(
            for: vehicles,
            viewport: viewport,
            minimumBattery: minimumBattery,
            enabledProviders: enabledProviders
        )
        visibleScooterCount = summary.count
        visibleProviderCounts = summary.providerCounts
    }

    private func clearSelectionIfHidden() {
        guard let selectedScooter else { return }
        let remainsVisible = viewport.contains(
            latitude: selectedScooter.latitude,
            longitude: selectedScooter.longitude
        ) && passesBatteryFilter(selectedScooter) && (
            allProvidersSelected || selectedScooter.providerInfo.map(enabledProviders.contains) == true
        )

        if !remainsVisible {
            selectedScooterID = nil
        }
    }

    private func scheduleFetch(for bounds: GeoBounds, debounce: Bool) {
        fetchTask?.cancel()

        let requestID = UUID()
        let fetchOrigin = userLocation ?? Self.switzerlandCenter
        activeRequestID = requestID
        pendingQueryBounds = bounds
        fetchTask = Task { [weak self] in
            guard let self else { return }

            if debounce {
                do {
                    try await Task.sleep(for: .milliseconds(320))
                } catch {
                    return
                }
            }

            guard !Task.isCancelled else { return }
            isLoading = true
            errorMessage = nil

            do {
                let response = try await api.scooters(bounds: bounds)
                guard !Task.isCancelled, activeRequestID == requestID else { return }
                if let metadata = response.meta, metadata.partial, hasCompleteResponse {
                    throw PartialScooterResponseError(failedSources: metadata.failedSources)
                }
                vehicles = response.vehicles
                responseMetadata = response.meta
                hasCompleteResponse = response.meta?.partial != true
                queryBounds = bounds
                distanceOrigin = fetchOrigin
                lastUpdated = Date()
                clearSelectionIfHidden()
            } catch is CancellationError {
                return
            } catch {
                guard activeRequestID == requestID else { return }
                errorMessage = error.localizedDescription
            }

            if activeRequestID == requestID {
                isLoading = false
                pendingQueryBounds = nil
                fetchTask = nil
            }
        }
    }

    private func fetchIfNeeded(for targetViewport: GeoBounds, debounce: Bool = false) {
        guard queryBounds?.contains(targetViewport) != true,
              pendingQueryBounds?.contains(targetViewport) != true else { return }
        scheduleFetch(for: targetViewport.expanded(by: 0.25), debounce: debounce)
    }

    private func requestLocationAccess() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationAuthorizationIssue = nil
            isLocating = true
            locationManager.requestWhenInUseAuthorization()
            beginLocationTimeout()
        case .authorizedAlways, .authorizedWhenInUse:
            locationAuthorizationIssue = nil
            isLocating = true
            locationManager.startUpdatingLocation()
            if userLocation == nil {
                beginLocationTimeout()
            }
        case .denied:
            locationAuthorizationIssue = .denied
            isLocating = false
            finishLocationAttemptWithoutFix()
        case .restricted:
            locationAuthorizationIssue = .restricted
            isLocating = false
            finishLocationAttemptWithoutFix()
        @unknown default:
            isLocating = false
            finishLocationAttemptWithoutFix()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            locationAuthorizationIssue = nil
            isLocating = true
            manager.startUpdatingLocation()
            if userLocation == nil {
                beginLocationTimeout()
            }
        case .denied:
            locationAuthorizationIssue = .denied
            isLocating = false
            finishLocationAttemptWithoutFix()
        case .restricted:
            locationAuthorizationIssue = .restricted
            isLocating = false
            finishLocationAttemptWithoutFix()
        case .notDetermined:
            locationAuthorizationIssue = nil
            break
        @unknown default:
            isLocating = false
            finishLocationAttemptWithoutFix()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = ScooterLocationPolicy.bestCandidate(in: locations) else { return }

        if bestLocationCandidate.map({ location.horizontalAccuracy < $0.horizontalAccuracy }) ?? true {
            bestLocationCandidate = location
        }

        guard location.horizontalAccuracy <= ScooterLocationPolicy.preferredAccuracy else { return }
        acceptLocation(location)
    }

    private func acceptLocation(_ location: CLLocation) {
        locationTimeoutTask?.cancel()
        locationTimeoutTask = nil
        bestLocationCandidate = nil

        let nextLocation = GeoPoint(location.coordinate)
        let hadLocation = userLocation != nil
        userLocation = nextLocation
        isLocating = false

        if !hadLocation {
            focusToken += 1
            focusRequest = MapFocusRequest(point: nextLocation, token: focusToken)
            distanceOrigin = nextLocation

            let focusedRegion = MKCoordinateRegion(
                center: nextLocation.coordinate,
                latitudinalMeters: 850,
                longitudinalMeters: 850
            )
            let focusedViewport = GeoBounds(region: focusedRegion)
            viewport = focusedViewport
            fetchIfNeeded(for: focusedViewport)
        } else if Self.distance(from: distanceOrigin, to: nextLocation) >= max(75, location.horizontalAccuracy) {
            distanceOrigin = nextLocation
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let locationError = error as? CLError, locationError.code == .denied {
            switch manager.authorizationStatus {
            case .denied:
                locationAuthorizationIssue = .denied
            case .restricted:
                locationAuthorizationIssue = .restricted
            default:
                break
            }
        }
        isLocating = false
        finishLocationAttemptWithoutFix()
    }

    private func beginLocationTimeout() {
        locationTimeoutTask?.cancel()
        locationTimeoutTask = Task { [weak self] in
            do {
                try await Task.sleep(for: Self.locationTimeout)
            } catch {
                return
            }

            guard let self else { return }
            if let bestLocationCandidate {
                acceptLocation(bestLocationCandidate)
            } else {
                isLocating = false
                finishLocationAttemptWithoutFix()
            }
        }
    }

    private func finishLocationAttemptWithoutFix() {
        locationTimeoutTask?.cancel()
        locationTimeoutTask = nil
        bestLocationCandidate = nil
        fetchIfNeeded(for: viewport)
    }

    private static func distance(from start: GeoPoint, to end: GeoPoint) -> CLLocationDistance {
        CLLocation(latitude: start.latitude, longitude: start.longitude)
            .distance(from: CLLocation(latitude: end.latitude, longitude: end.longitude))
    }
}
