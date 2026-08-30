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

enum NearbyOrigin: Equatable, Sendable {
    case searchedDestination(MapDestination)
    case userLocation(GeoPoint)

    var point: GeoPoint {
        switch self {
        case let .searchedDestination(destination):
            destination.point
        case let .userLocation(point):
            point
        }
    }

    var title: String {
        switch self {
        case let .searchedDestination(destination):
            destination.title
        case .userLocation:
            String(localized: "Current location")
        }
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
            rebuildVehicleIndex()
            rebuildMapScooters()
            rebuildVisibleCounts()
        }
    }
    private(set) var clusters: [ScooterCluster] = [] {
        didSet {
            rebuildMapClusters()
            rebuildVisibleCounts()
        }
    }
    var viewport = GeoBounds(region: initialRegion) {
        didSet { rebuildVisibleCounts() }
    }
    private(set) var viewportZoom = 8
    var isLoading = false
    var isLocating = false
    var errorMessage: String?
    var lastUpdated: Date?
    private(set) var responseMetadata: ScooterResponseMetadata?
    var userLocation: GeoPoint?
    private(set) var locationAuthorizationIssue: LocationAuthorizationIssue?
    private(set) var enabledProviders = Set(ScooterProvider.allCases) {
        didSet {
            defaults.set(
                enabledProviders.map(\.rawValue).sorted(),
                forKey: Self.enabledProvidersKey
            )
            rebuildMapScooters()
            rebuildMapClusters()
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
    @ObservationIgnored private var queryZoom: Int?
    @ObservationIgnored private var queryMinimumBattery: Int?
    @ObservationIgnored private var pendingQueryBounds: GeoBounds?
    @ObservationIgnored private var pendingQueryZoom: Int?
    @ObservationIgnored private var pendingQueryMinimumBattery: Int?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var locationTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var bestLocationCandidate: CLLocation?
    @ObservationIgnored private var focusToken = 0
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var hasCompleteResponse = false
    @ObservationIgnored private var distanceOrigin = switzerlandCenter
    @ObservationIgnored private var vehiclesByID: [String: Scooter] = [:]
    private(set) var mapScooters: [Scooter] = []
    private(set) var mapScootersRevision = 0
    private(set) var mapClusters: [ScooterCluster] = []
    private(set) var mapClustersRevision = 0
    private(set) var visibleScooterCount = 0
    private(set) var visibleProviderCounts: [ScooterProvider: Int] = [:]

    private static let minimumBatteryKey = "minimum-battery"
    private static let mapStyleKey = "apple-map-style"
    private static let enabledProvidersKey = "enabled-providers"
    private static let locationTimeout: Duration = .seconds(5)
    private static let userFocusZoomIncrease = 3
    private static let userFocusMeters: CLLocationDistance = 850 / pow(
        2,
        Double(userFocusZoomIncrease)
    )
    private static let userFocusZoom = 16 + userFocusZoomIncrease
    private static let approximateWalkingMetersPerMinute: CLLocationDistance = 80

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

        if let savedProviderIDs = defaults.array(forKey: Self.enabledProvidersKey) as? [String] {
            let savedProviders = Set(savedProviderIDs.compactMap(ScooterProvider.init(rawValue:)))
            if savedProviders.count == savedProviderIDs.count {
                enabledProviders = savedProviders
            }
        }

        super.init()

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 20
    }

    var selectedScooter: Scooter? {
        guard let selectedScooterID else { return nil }
        return vehiclesByID[selectedScooterID]
    }

    var activeOrigin: NearbyOrigin? {
        if let searchedDestination {
            return .searchedDestination(searchedDestination)
        }
        if let userLocation {
            return .userLocation(userLocation)
        }
        return nil
    }

    var activeOriginTitle: String? {
        activeOrigin?.title
    }

    var nearbyScooters: [Scooter] {
        guard let origin = activeOrigin?.point else { return [] }

        return mapScooters
            .filter {
                viewport.contains(latitude: $0.latitude, longitude: $0.longitude)
            }
            .map { scooter in
                (scooter: scooter, distance: scooter.distance(from: origin))
            }
            .sorted { lhs, rhs in
                if lhs.distance == rhs.distance {
                    return lhs.scooter.id < rhs.scooter.id
                }
                return lhs.distance < rhs.distance
            }
            .map(\.scooter)
    }

    var visibleCount: Int { visibleScooterCount }

    var isShowingClusterSummary: Bool {
        responseMetadata?.mode == "clusters" && nearbyScooters.isEmpty && !mapClusters.isEmpty
    }

    var allProvidersSelected: Bool {
        enabledProviders == Set(ScooterProvider.allCases)
    }

    var hasActiveFilters: Bool {
        minimumBattery > 0 || !allProvidersSelected
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
            let shown = representedVehicleCount
            let total = responseMetadata.totalVehicles ?? shown
            messages.append(String(
                format: String(localized: "Showing %@ of %@ results"),
                shown.formatted(),
                total.formatted()
            ))
        }
        return messages.isEmpty ? nil : messages.joined(separator: " · ")
    }

    func count(for provider: ScooterProvider) -> Int {
        var count = vehicles.lazy.filter {
            self.viewport.contains(latitude: $0.latitude, longitude: $0.longitude) &&
                self.passesBatteryFilter($0) &&
                $0.providerInfo == provider
        }.count

        if responseMetadata?.mode == "clusters" {
            count += clusters.lazy.filter {
                self.viewport.contains(latitude: $0.latitude, longitude: $0.longitude)
            }.reduce(0) { partialResult, cluster in
                partialResult + cluster.providers[provider.rawValue, default: 0]
            }
        }

        return count
    }

    var allProviderCount: Int {
        var count = vehicles.lazy.filter {
            self.viewport.contains(latitude: $0.latitude, longitude: $0.longitude) &&
                self.passesBatteryFilter($0)
        }.count

        if responseMetadata?.mode == "clusters" {
            count += clusters.lazy.filter {
                self.viewport.contains(latitude: $0.latitude, longitude: $0.longitude)
            }.reduce(0) { $0 + $1.count }
        }

        return count
    }

    var quickProviderOrder: [ScooterProvider] {
        let isFilteringProviders = !allProvidersSelected

        return ScooterProvider.allCases.sorted { lhs, rhs in
            let lhsSelected = isFilteringProviders && self.enabledProviders.contains(lhs)
            let rhsSelected = isFilteringProviders && self.enabledProviders.contains(rhs)
            if lhsSelected != rhsSelected {
                return lhsSelected
            }

            let lhsCount = self.count(for: lhs)
            let rhsCount = self.count(for: rhs)
            if lhsCount != rhsCount {
                return lhsCount > rhsCount
            }

            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    func formattedDistance(for scooter: Scooter) -> String? {
        guard let origin = activeOrigin?.point else { return nil }
        return scooter.formattedDistance(from: origin)
    }

    func straightLineDistance(to scooter: Scooter) -> CLLocationDistance? {
        guard let origin = activeOrigin?.point else { return nil }
        return scooter.distance(from: origin)
    }

    func approximateWalkingMinutes(to scooter: Scooter) -> Int? {
        guard let distance = straightLineDistance(to: scooter), distance.isFinite else { return nil }
        return max(1, Int(ceil(distance / Self.approximateWalkingMetersPerMinute)))
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

    func updateViewport(_ region: MKCoordinateRegion, zoom: Int) {
        let nextViewport = GeoBounds(region: region)
        viewport = nextViewport
        viewportZoom = zoom
        clearSelectionIfHidden()

        guard !queryCovers(nextViewport, zoom: zoom, pending: false),
              !queryCovers(nextViewport, zoom: zoom, pending: true) else { return }
        scheduleFetch(for: nextViewport.expanded(by: 0.25), zoom: zoom, debounce: true)
    }

    func refresh() {
        scheduleFetch(for: viewport.expanded(by: 0.25), zoom: viewportZoom, debounce: false)
    }

    func showAllProviders() {
        enabledProviders = Set(ScooterProvider.allCases)
    }

    func showProviders(_ providers: Set<ScooterProvider>) {
        enabledProviders = providers
    }

    func toggleQuickProvider(_ provider: ScooterProvider) {
        if allProvidersSelected {
            showProviders([provider])
        } else if enabledProviders == [provider] {
            showAllProviders()
        } else {
            toggle(provider: provider)
        }
    }

    func toggle(provider: ScooterProvider) {
        if enabledProviders.contains(provider) {
            enabledProviders.remove(provider)
        } else {
            enabledProviders.insert(provider)
        }
    }

    func resetFilters() {
        let batteryChanged = minimumBattery != 0
        minimumBattery = 0
        enabledProviders = Set(ScooterProvider.allCases)
        if batteryChanged, ScooterClusteringPolicy.shouldCluster(at: viewportZoom) {
            clusters = []
            scheduleFetch(for: viewport.expanded(by: 0.25), zoom: viewportZoom, debounce: true)
        }
    }

    func setMinimumBattery(_ value: Double) {
        let normalizedValue = min(100, max(0, (value / 5).rounded() * 5))
        guard normalizedValue != minimumBattery else { return }
        minimumBattery = normalizedValue
        if ScooterClusteringPolicy.shouldCluster(at: viewportZoom) {
            clusters = []
            scheduleFetch(for: viewport.expanded(by: 0.25), zoom: viewportZoom, debounce: true)
        }
    }

    func focusOnUser() {
        searchedDestination = nil
        if let userLocation {
            requestUserFocus(at: userLocation)
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
        mapScootersRevision &+= 1
    }

    private func rebuildMapClusters() {
        mapClusters = clusters.compactMap { $0.filtered(to: enabledProviders) }
        mapClustersRevision &+= 1
    }

    private func rebuildVehicleIndex() {
        vehiclesByID = Dictionary(
            vehicles.map { ($0.id, $0) },
            uniquingKeysWith: { _, latest in latest }
        )
    }

    private func rebuildVisibleCounts() {
        if responseMetadata?.mode == "clusters" {
            var count = 0
            var providerCounts: [ScooterProvider: Int] = [:]

            for scooter in mapScooters where viewport.contains(
                latitude: scooter.latitude,
                longitude: scooter.longitude
            ) {
                count += 1
                if let provider = scooter.providerInfo {
                    providerCounts[provider, default: 0] += 1
                }
            }

            for cluster in mapClusters where viewport.contains(
                latitude: cluster.latitude,
                longitude: cluster.longitude
            ) {
                count += cluster.count
                for (providerID, providerCount) in cluster.providers {
                    if let provider = ScooterProvider(rawValue: providerID) {
                        providerCounts[provider, default: 0] += providerCount
                    }
                }
            }

            visibleScooterCount = count
            visibleProviderCounts = providerCounts
            return
        }

        let summary = ScooterFiltering.visibleSummary(
            for: vehicles,
            viewport: viewport,
            minimumBattery: minimumBattery,
            enabledProviders: enabledProviders
        )
        visibleScooterCount = summary.count
        visibleProviderCounts = summary.providerCounts
    }

    private var representedVehicleCount: Int {
        vehicles.count + clusters.reduce(0) { $0 + $1.count }
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

    private func scheduleFetch(for bounds: GeoBounds, zoom: Int, debounce: Bool) {
        fetchTask?.cancel()

        let requestID = UUID()
        let fetchOrigin = userLocation ?? Self.switzerlandCenter
        let requestMinimumBattery = ScooterClusteringPolicy.shouldCluster(at: zoom)
            ? Int(minimumBattery)
            : 0
        activeRequestID = requestID
        pendingQueryBounds = bounds
        pendingQueryZoom = zoom
        pendingQueryMinimumBattery = requestMinimumBattery
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
                let response = try await api.scooters(
                    bounds: bounds,
                    zoom: zoom,
                    minimumBattery: requestMinimumBattery
                )
                guard !Task.isCancelled, activeRequestID == requestID else { return }
                if let metadata = response.meta, metadata.partial, hasCompleteResponse {
                    throw PartialScooterResponseError(failedSources: metadata.failedSources)
                }
                vehicles = response.vehicles
                clusters = response.clusters
                responseMetadata = response.meta
                rebuildVisibleCounts()
                hasCompleteResponse = response.meta?.partial != true
                queryBounds = bounds
                queryZoom = zoom
                queryMinimumBattery = requestMinimumBattery
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
                pendingQueryZoom = nil
                pendingQueryMinimumBattery = nil
                fetchTask = nil
            }
        }
    }

    private func fetchIfNeeded(
        for targetViewport: GeoBounds,
        zoom: Int? = nil,
        debounce: Bool = false
    ) {
        let targetZoom = zoom ?? viewportZoom
        guard !queryCovers(targetViewport, zoom: targetZoom, pending: false),
              !queryCovers(targetViewport, zoom: targetZoom, pending: true) else { return }
        scheduleFetch(
            for: targetViewport.expanded(by: 0.25),
            zoom: targetZoom,
            debounce: debounce
        )
    }

    private func queryCovers(_ targetViewport: GeoBounds, zoom: Int, pending: Bool) -> Bool {
        let bounds = pending ? pendingQueryBounds : queryBounds
        let storedZoom = pending ? pendingQueryZoom : self.queryZoom
        let storedMinimumBattery = pending
            ? pendingQueryMinimumBattery
            : self.queryMinimumBattery
        guard bounds?.contains(targetViewport) == true,
              let storedZoom,
              ScooterClusteringPolicy.representationsMatch(storedZoom, zoom) else { return false }

        let targetMinimumBattery = ScooterClusteringPolicy.shouldCluster(at: zoom)
            ? Int(minimumBattery)
            : 0
        return storedMinimumBattery == targetMinimumBattery
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
            requestUserFocus(at: nextLocation)
            distanceOrigin = nextLocation

            let focusedRegion = MKCoordinateRegion(
                center: nextLocation.coordinate,
                latitudinalMeters: Self.userFocusMeters,
                longitudinalMeters: Self.userFocusMeters
            )
            let focusedViewport = GeoBounds(region: focusedRegion)
            viewport = focusedViewport
            viewportZoom = Self.userFocusZoom
            fetchIfNeeded(for: focusedViewport, zoom: viewportZoom)
        } else if Self.distance(from: distanceOrigin, to: nextLocation) >= max(75, location.horizontalAccuracy) {
            distanceOrigin = nextLocation
        }
    }

    private func requestUserFocus(at point: GeoPoint) {
        focusToken += 1
        focusRequest = MapFocusRequest(
            point: point,
            token: focusToken,
            latitudinalMeters: Self.userFocusMeters,
            longitudinalMeters: Self.userFocusMeters
        )
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
