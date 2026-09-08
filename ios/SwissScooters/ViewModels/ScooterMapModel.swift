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
            guard !isApplyingResponse else { return }
            rebuildVehicleIndex()
            rebuildMapScooters()
            rebuildVisibleCounts()
        }
    }
    private(set) var clusters: [ScooterCluster] = [] {
        didSet {
            guard !isApplyingResponse else { return }
            rebuildMapClusters()
            rebuildVisibleCounts()
        }
    }
    private(set) var parking: [ScooterParking] = []
    var mapParking: [ScooterParking] {
        guard viewportZoom >= 16 else { return [] }
        return parking.filter { location in
            guard let provider = ScooterProvider(rawValue: location.provider) else { return false }
            return enabledProviders.contains(provider) && viewport.contains(latitude: location.latitude, longitude: location.longitude)
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
    private(set) var userHeading: ScooterUserHeading?
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

    private(set) var rideEstimateMinutes: Int
    private(set) var ridePasses: [ScooterProvider: ProviderRidePass]

    @ObservationIgnored private let api: any ScooterAPIClient
    @ObservationIgnored private let locationManager: CLLocationManager
    @ObservationIgnored private var isTrackingHeading = false
    @ObservationIgnored private var isSceneActive = true
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var queryBounds: GeoBounds?
    @ObservationIgnored private var queryZoom: Int?
    @ObservationIgnored private var queryMinimumBattery: Int?
    @ObservationIgnored private var pendingQueryBounds: GeoBounds?
    @ObservationIgnored private var pendingQueryZoom: Int?
    @ObservationIgnored private var pendingQueryMinimumBattery: Int?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var expirationTask: Task<Void, Never>?
    @ObservationIgnored private var vehiclesExpireAt: Date?
    @ObservationIgnored private var parkingExpireAt: Date?
    @ObservationIgnored private var locationTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var bestLocationCandidate: CLLocation?
    @ObservationIgnored private var focusToken = 0
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var isApplyingResponse = false
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
    private static let rideEstimateMinutesKey = "ride-estimate-minutes-v1"
    private static let ridePassesKey = "provider-ride-passes-v1"
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
        minimumBattery = Double(min(100, max(0, savedBattery)))

        let savedStyle = defaults.string(forKey: Self.mapStyleKey)
        mapStyle = AppleMapStyle(rawValue: savedStyle ?? "") ?? .standard

        let savedEstimateMinutes = defaults.object(
            forKey: Self.rideEstimateMinutesKey
        ) as? Int ?? RideEstimateDuration.defaultMinutes
        rideEstimateMinutes = RideEstimateDuration.normalized(savedEstimateMinutes)
        ridePasses = Self.loadRidePasses(from: defaults)

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
        locationManager.headingFilter = 2
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

    var visibleCount: Int { visibleScooterCount }

    var isShowingClusterSummary: Bool {
        responseMetadata?.mode == "clusters" && mapScooters.isEmpty && !mapClusters.isEmpty
    }

    var allProvidersSelected: Bool {
        Set(availableProviders).isSubset(of: enabledProviders)
    }

    var availableProviders: [ScooterProvider] {
        let providers = Set(ScooterProviderCoverage.providers(in: viewport)).union(visibleProviderCounts.keys)
        return ScooterProvider.allCases.filter { providers.contains($0) }
    }

    var hasActiveFilters: Bool {
        minimumBattery > 0 || !allProvidersSelected
    }

    var dataHealthMessage: String? {
        guard let responseMetadata else { return nil }

        var messages: [String] = []
        if responseMetadata.stale && !responseMetadata.overview {
            messages.append(String(localized: "Showing cached data"))
        }
        if responseMetadata.partial {
            messages.append(String(localized: "Some providers are unavailable"))
        }
        if responseMetadata.parkingStatus == "failed" || responseMetadata.parkingStatus == "partial" {
            messages.append(String(localized: "Parking data is temporarily unavailable"))
        } else if responseMetadata.parkingStatus == "stale" {
            messages.append(String(localized: "Parking data may be out of date"))
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
        visibleProviderCounts[provider, default: 0]
    }

    var allProviderCount: Int { visibleProviderCounts.values.reduce(0, +) }

    var quickProviderOrder: [ScooterProvider] {
        let isFilteringProviders = !allProvidersSelected

        return availableProviders.sorted { lhs, rhs in
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

    func setRideEstimateMinutes(_ minutes: Int) {
        let normalizedMinutes = RideEstimateDuration.normalized(minutes)
        guard normalizedMinutes != rideEstimateMinutes else { return }
        rideEstimateMinutes = normalizedMinutes
        defaults.set(normalizedMinutes, forKey: Self.rideEstimateMinutesKey)
    }

    func ridePass(for provider: ScooterProvider) -> ProviderRidePass {
        ridePasses[provider] ?? ProviderRidePass()
    }

    func setRidePass(_ pass: ProviderRidePass, for provider: ScooterProvider) {
        ridePasses[provider] = pass
        persistRidePasses()
    }

    func ridePriceQuote(
        for scooter: Scooter,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> RidePriceQuote? {
        guard let pricing = scooter.pricing else { return nil }
        let pass = scooter.providerInfo.map(ridePass(for:))
        return RidePriceEstimator.quote(
            pricing: pricing,
            durationMinutes: rideEstimateMinutes,
            pass: pass,
            now: now,
            calendar: calendar
        )
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        switch locationManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            startHeadingUpdates()
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
        expireDataIfNeeded()
        isSceneActive = true
        if hasStarted { startHeadingUpdates() }
        refreshIfStale()
    }

    func becameInactive() {
        isSceneActive = false
        stopHeadingUpdates()
    }

    private func startHeadingUpdates() {
        guard isSceneActive, !isTrackingHeading, CLLocationManager.headingAvailable(),
              locationManager.authorizationStatus == .authorizedWhenInUse ||
                locationManager.authorizationStatus == .authorizedAlways else { return }
        isTrackingHeading = true
        // Location updates let Core Location resolve true north for the map.
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
    }

    private func stopHeadingUpdates() {
        locationManager.stopUpdatingHeading()
        isTrackingHeading = false
        userHeading = nil
    }

    func autoRefreshIfNeeded() {
        expireDataIfNeeded()
        refreshIfStale()
    }

    private func refreshIfStale() {
        guard let lastUpdated else {
            if fetchTask == nil, !isLocating {
                refresh()
            }
            return
        }
        if fetchTask == nil, Date().timeIntervalSince(lastUpdated) >= Double(responseMetadata?.refreshAfterSeconds ?? 60) {
            refresh()
        }
    }

    func updateViewport(_ region: MKCoordinateRegion, zoom: Int) {
        let nextViewport = GeoBounds(region: region)
        viewport = nextViewport
        viewportZoom = zoom
        clearSelectionIfHidden()

        if queryCovers(nextViewport, zoom: zoom, pending: false) {
            if fetchTask != nil && !queryCovers(nextViewport, zoom: zoom, pending: true) {
                cancelPendingFetch()
            }
            return
        }
        guard !queryCovers(nextViewport, zoom: zoom, pending: true) else { return }
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
        let next = ScooterFiltering.mapScooters(
            from: vehicles,
            minimumBattery: minimumBattery,
            enabledProviders: enabledProviders
        )
        guard next != mapScooters else { return }
        mapScooters = next
        mapScootersRevision &+= 1
    }

    private func rebuildMapClusters() {
        let next = clusters.compactMap { $0.filtered(to: enabledProviders) }
        guard next != mapClusters else { return }
        mapClusters = next
        mapClustersRevision &+= 1
    }

    private func rebuildVehicleIndex() {
        vehiclesByID = Dictionary(
            vehicles.map { ($0.id, $0) },
            uniquingKeysWith: { _, latest in latest }
        )
    }

    private func rebuildVisibleCounts() {
        let summary = ScooterFiltering.visibleSummary(
            for: vehicles, viewport: viewport, minimumBattery: minimumBattery,
            enabledProviders: enabledProviders
        )
        var count = summary.count
        var providers = summary.providerCounts
        if responseMetadata?.mode == "clusters" {
            for cluster in clusters where viewport.contains(latitude: cluster.latitude, longitude: cluster.longitude) {
                for (providerID, providerCount) in cluster.providers {
                    guard let provider = ScooterProvider(rawValue: providerID) else { continue }
                    providers[provider, default: 0] += providerCount
                    if enabledProviders.contains(provider) { count += providerCount }
                }
            }
        }
        visibleScooterCount = count
        visibleProviderCounts = providers
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

            defer {
                if activeRequestID == requestID { clearPendingFetch() }
            }
            if debounce {
                do {
                    try await Task.sleep(for: .milliseconds(180))
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
                // The backend preserves recent successful feeds independently.
                // Accept healthy cities even when another operator is unavailable.
                isApplyingResponse = true
                vehicles = response.vehicles
                clusters = response.clusters
                parking = response.parking
                responseMetadata = response.meta
                isApplyingResponse = false
                rebuildVehicleIndex()
                rebuildMapScooters()
                rebuildMapClusters()
                rebuildVisibleCounts()
                queryBounds = bounds
                queryZoom = zoom
                queryMinimumBattery = requestMinimumBattery
                distanceOrigin = fetchOrigin
                lastUpdated = response.meta?.generatedAt.flatMap { value in
                    let formatter = ISO8601DateFormatter()
                    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
                } ?? Date()
                scheduleDataExpiry(response.meta)
                expireDataIfNeeded()
                clearSelectionIfHidden()
            } catch is CancellationError {
                return
            } catch {
                guard activeRequestID == requestID else { return }
                errorMessage = error.localizedDescription
            }

        }
    }

    private func clearPendingFetch() {
        isLoading = false
        activeRequestID = nil
        pendingQueryBounds = nil
        pendingQueryZoom = nil
        pendingQueryMinimumBattery = nil
        fetchTask = nil
    }

    private func cancelPendingFetch() {
        fetchTask?.cancel()
        clearPendingFetch()
    }

    private static func apiDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func scheduleDataExpiry(_ meta: ScooterResponseMetadata?) {
        let receivedAt = Date()
        let observedAt = min(receivedAt, Self.apiDate(meta?.generatedAt) ?? receivedAt)
        let maximumAge: TimeInterval = meta?.overview == true ? 3 * 3600 : 300
        vehiclesExpireAt = min(Self.apiDate(meta?.expiresAt) ?? .distantFuture,
            observedAt.addingTimeInterval(maximumAge))
        parkingExpireAt = min(Self.apiDate(meta?.parkingExpiresAt) ?? .distantFuture,
            receivedAt.addingTimeInterval(300))
        scheduleExpirationTimer()
    }

    private func scheduleExpirationTimer() {
        expirationTask?.cancel()
        guard let deadline = [vehiclesExpireAt, parkingExpireAt].compactMap({ $0 }).min() else { return }
        let delay = max(0, deadline.timeIntervalSinceNow)
        expirationTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            self?.expireDataIfNeeded()
        }
    }

    func expireDataIfNeeded(now: Date = .now) {
        var expired = false
        if let deadline = vehiclesExpireAt, now >= deadline {
            vehiclesExpireAt = nil
            vehicles = []
            clusters = []
            selectedScooterID = nil
            queryBounds = nil
            errorMessage = String(localized: "Availability has expired. Refresh to see current scooters.")
            expired = true
        }
        if let deadline = parkingExpireAt, now >= deadline {
            parkingExpireAt = nil
            parking = []
            expired = true
        }
        if expired { scheduleExpirationTimer() }
    }

    private func fetchIfNeeded(
        for targetViewport: GeoBounds,
        zoom: Int? = nil,
        debounce: Bool = false
    ) {
        let targetZoom = zoom ?? viewportZoom
        if queryCovers(targetViewport, zoom: targetZoom, pending: false) {
            if fetchTask != nil && !queryCovers(targetViewport, zoom: targetZoom, pending: true) {
                cancelPendingFetch()
            }
            return
        }
        guard !queryCovers(targetViewport, zoom: targetZoom, pending: true) else { return }
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
            startHeadingUpdates()
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
        if manager.authorizationStatus != .authorizedAlways &&
            manager.authorizationStatus != .authorizedWhenInUse {
            stopHeadingUpdates()
        }
        // CLLocationManager can deliver the current authorization state as soon as
        // its delegate is assigned. Wait until the app has actually requested a
        // location so model initialization cannot unexpectedly recenter the map.
        guard hasStarted || isLocating else { return }

        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            locationAuthorizationIssue = nil
            isLocating = true
            manager.startUpdatingLocation()
            startHeadingUpdates()
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

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard isTrackingHeading else { return }
        guard abs(newHeading.timestamp.timeIntervalSinceNow) <= 10 else {
            userHeading = nil
            return
        }
        userHeading = ScooterUserHeading(
            trueHeading: newHeading.trueHeading,
            magneticHeading: newHeading.magneticHeading,
            accuracy: newHeading.headingAccuracy
        )
    }

    func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        false
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

    private func persistRidePasses() {
        let storedPasses = Dictionary(
            uniqueKeysWithValues: ridePasses.map { provider, pass in
                (provider.rawValue, pass)
            }
        )
        guard let encodedPasses = try? JSONEncoder().encode(storedPasses) else { return }
        defaults.set(encodedPasses, forKey: Self.ridePassesKey)
    }

    private static func loadRidePasses(
        from defaults: UserDefaults
    ) -> [ScooterProvider: ProviderRidePass] {
        guard let encodedPasses = defaults.data(forKey: ridePassesKey),
              let storedPasses = try? JSONDecoder().decode(
                  [String: ProviderRidePass].self,
                  from: encodedPasses
              ) else { return [:] }

        return Dictionary(
            uniqueKeysWithValues: storedPasses.compactMap { providerID, pass in
                ScooterProvider(rawValue: providerID).map { ($0, pass) }
            }
        )
    }

    private static func distance(from start: GeoPoint, to end: GeoPoint) -> CLLocationDistance {
        CLLocation(latitude: start.latitude, longitude: start.longitude)
            .distance(from: CLLocation(latitude: end.latitude, longitude: end.longitude))
    }
}
