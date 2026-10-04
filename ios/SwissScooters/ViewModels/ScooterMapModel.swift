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
}

extension MapFocusRequest {
    /// Moves the map to the point and keeps the zoom it has: there is no span to fit.
    static func center(_ point: GeoPoint, token: Int) -> MapFocusRequest {
        MapFocusRequest(point: point, token: token, latitudinalMeters: 0, longitudinalMeters: 0)
    }

    var keepsZoom: Bool {
        latitudinalMeters <= 0 || longitudinalMeters <= 0
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
    /// The bays drawn on the map: zoom 16 and closer, for the providers that are shown.
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
    /// What went wrong with loading, until a load succeeds again.
    private(set) var loadIssue: ScooterLoadIssue?
    /// When the data on the map was observed. It survives the map being cleared,
    /// so the out-of-date card can say when the last update was.
    var lastUpdated: Date?
    private(set) var responseMetadata: ScooterResponseMetadata?
    var userLocation: GeoPoint?
    private(set) var userHeading: ScooterUserHeading?
    /// True once this device has located successfully. Only this boolean is stored.
    private(set) var hasLocatedOnce: Bool
    private var locationProblem: ScooterLocationIssue? {
        didSet {
            if locationProblem != oldValue { locationIssueDismissed = false }
        }
    }
    private var locationIssueDismissed = false
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
    var selectedScooterID: String? {
        didSet {
            if selectedScooterID != nil { selectedParkingID = nil }
        }
    }
    /// Selecting a bay clears the selected scooter, and the other way round.
    private(set) var selectedParkingID: String?
    var searchedDestination: MapDestination?
    /// Places chosen during this session, newest first. Never persisted: the
    /// privacy notice promises that precise origins are not stored.
    private(set) var recentPlaces: [MapDestination] = []
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
            if oldValue != mapStyle { ScooterAnalytics.shared.track("map_style", result: mapStyle.rawValue) }
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
    @ObservationIgnored private let locationTimeout: Duration
    @ObservationIgnored private let refreshPolicy: ScooterRefreshPolicy
    @ObservationIgnored private let clock: () -> Date
    // What the data on the map was requested for. Observed, because the dock
    // only reports an area as empty once the data covers it.
    private var queryBounds: GeoBounds?
    private var queryZoom: Int?
    private var queryMinimumBattery: Int?
    @ObservationIgnored private var pendingQueryBounds: GeoBounds?
    @ObservationIgnored private var pendingQueryZoom: Int?
    @ObservationIgnored private var pendingQueryMinimumBattery: Int?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var refreshTimerTask: Task<Void, Never>?
    @ObservationIgnored private var parkingExpiryTask: Task<Void, Never>?
    /// When the previous request finished, whatever its outcome.
    @ObservationIgnored private var lastAttemptAt: Date?
    @ObservationIgnored private var lastSuccessAt: Date?
    @ObservationIgnored private var vehiclesExpireAt: Date?
    @ObservationIgnored private var parkingExpireAt: Date?
    @ObservationIgnored private var locationTimeoutTask: Task<Void, Never>?
    @ObservationIgnored private var knownAuthorizationStatus: CLAuthorizationStatus
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var bestLocationCandidate: CLLocation?
    /// Set while a card asked for the location: the first fix leaves the map where it is.
    @ObservationIgnored private var keepsMapOnFirstFix = false
    /// Counts the places and cities the rider sent the map to, so that a fix can
    /// tell whether one was chosen while it was on its way.
    @ObservationIgnored private var placeChoices = 0
    @ObservationIgnored private var placeChoicesAtLocate = 0
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
    private var unfilteredVisibleCount = 0
    private var unfilteredVisibleProviders = Set<ScooterProvider>()

    private static let minimumBatteryKey = "minimum-battery"
    private static let mapStyleKey = "apple-map-style"
    private static let enabledProvidersKey = "enabled-providers"
    private static let rideEstimateMinutesKey = "ride-estimate-minutes-v1"
    private static let ridePassesKey = "provider-ride-passes-v1"
    private static let hasLocatedOnceKey = "has-located-once"
    private static let maximumRecentPlaces = 3
    /// Locating shows about 350 m across, like zoom 17 on the web.
    static let userFocusMeters: CLLocationDistance = 350
    private static let userFocusZoom = 17
    private static let approximateWalkingMetersPerMinute: CLLocationDistance = 80

    override convenience init() {
        self.init(api: ScooterAPI(), locationManager: CLLocationManager(), defaults: .standard)
    }

    init(
        api: any ScooterAPIClient,
        locationManager: CLLocationManager,
        defaults: UserDefaults,
        locationTimeout: Duration = .seconds(5),
        refreshPolicy: ScooterRefreshPolicy = .standard,
        now: @escaping () -> Date = Date.init
    ) {
        self.api = api
        self.locationManager = locationManager
        self.defaults = defaults
        self.locationTimeout = locationTimeout
        self.refreshPolicy = refreshPolicy
        clock = now
        knownAuthorizationStatus = locationManager.authorizationStatus
        hasLocatedOnce = defaults.bool(forKey: Self.hasLocatedOnceKey)

        let savedBattery = defaults.object(forKey: Self.minimumBatteryKey) as? Int ?? 0
        minimumBattery = Double(ScooterBatteryFilter.snapped(savedBattery))

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

    /// The selected bay, while it is still drawn on the map.
    var selectedParking: ScooterParking? {
        guard let selectedParkingID else { return nil }
        return mapParking.first { $0.id == selectedParkingID }
    }

    /// The location card under the search bar, unless it was dismissed. The
    /// next locate attempt brings it back.
    var locationIssue: ScooterLocationIssue? {
        locationIssueDismissed ? nil : locationProblem
    }

    var searchBarState: ScooterSearchBarState {
        if let searchedDestination { return .place(searchedDestination) }
        if isLocating { return .locating }
        return userLocation == nil ? .empty : .nearYou
    }

    /// The six covered cities nearest to the map centre, for "Cities with scooters".
    var nearbyCities: [ScooterCityDistance] {
        ScooterCityCatalog.nearest(to: viewport.center, count: 6)
    }

    /// The three covered cities nearest to the map centre, for the outside-coverage card.
    var closestCities: [ScooterCityDistance] {
        ScooterCityCatalog.nearest(to: viewport.center, count: 3)
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

    var visibleCount: Int { visibleScooterCount }

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

    /// The providers that are not sharing data here: a feed of theirs failed, they
    /// operate in the viewport and the map holds none of their scooters in view,
    /// whatever the rider's filters hide. City totals name no one, and neither does
    /// data that cannot tell who has scooters here: loaded for another area, or
    /// already without the scooters under the battery minimum, which the server
    /// leaves out of clusters.
    var providerHealth: ScooterProviderHealth {
        guard let responseMetadata, responseMetadata.overview != true, viewportIsLoaded,
              (queryMinimumBattery ?? 0) == 0 else { return .healthy }
        return ScooterProviderHealth(
            failedSources: responseMetadata.failedSources,
            operating: ScooterProviderCoverage.providers(in: viewport),
            inView: unfilteredVisibleProviders
        )
    }

    /// The calm lines under the dock status: providers down, truncation, parking.
    var dockNotices: [ScooterDockNotice] {
        guard let responseMetadata else { return [] }
        return ScooterDockNotice.notices(
            health: providerHealth,
            metadata: responseMetadata,
            shownCount: representedVehicleCount
        )
    }

    func count(for provider: ScooterProvider) -> Int {
        visibleProviderCounts[provider, default: 0]
    }

    var allProviderCount: Int { visibleProviderCounts.values.reduce(0, +) }

    /// The providers in the filter sheet, in catalogue order.
    var filterProviders: [ScooterProviderEntry] {
        let down = Set(providerHealth.downProviders)
        let isFilteringProviders = !allProvidersSelected
        return availableProviders.map { provider in
            let count = count(for: provider)
            let isDown = down.contains(provider)
            let isEnabled = enabledProviders.contains(provider)
            return ScooterProviderEntry(
                provider: provider,
                count: count,
                isEnabled: isEnabled,
                isSelected: isFilteringProviders && isEnabled && !isDown,
                isDown: isDown
            )
        }
    }

    /// The chips after "All": providers that are down first, then by count,
    /// largest first. Ties keep the catalogue order.
    var dockChips: [ScooterProviderEntry] {
        let entries = filterProviders
        let sharing = entries.enumerated()
            .filter { !$0.element.isDown }
            .sorted { lhs, rhs in
                lhs.element.count != rhs.element.count
                    ? lhs.element.count > rhs.element.count
                    : lhs.offset < rhs.offset
            }
            .map(\.element)
        return entries.filter(\.isDown) + sharing
    }

    /// What the filter sheet's "Show n scooters" button promises: filters apply
    /// as they are chosen, so this is the count on the map.
    var showResultsTitle: String {
        ScooterFiltering.showResultsTitle(count: visibleCount)
    }

    /// The providers listed under Passes: those operating in the viewport or
    /// with a pass, and every provider when that leaves none.
    var passProviders: [ScooterProvider] {
        let operating = Set(availableProviders)
        let listed = ScooterProvider.allCases.filter {
            operating.contains($0) || ridePass(for: $0).enabled
        }
        return listed.isEmpty ? ScooterProvider.allCases : listed
    }

    /// What the dock shows.
    var dock: ScooterDockContent {
        if let selectedScooter { return .scooter(selectedScooter) }
        if let selectedParking { return .parking(selectedParking) }
        if case let .outOfDate(failure, lastUpdate) = loadIssue {
            return .outOfDate(failure, lastUpdate: lastUpdate)
        }
        guard let lastUpdated else {
            return loadIssue == nil ? .finding(chips: []) : .waiting
        }

        // A failure already explains an empty map.
        let isEmpty = visibleCount == 0 && loadIssue == nil
        if isEmpty {
            // No provider operates here, whatever the pending request answers.
            if availableProviders.isEmpty { return .outsideCoverage(closestCities) }
            // The data on the map is for another area: no count to show yet.
            guard viewportIsLoaded else { return .finding(chips: dockChips) }
            if let filterSummary = hiddenByFilters { return .filtersHideEverything(filterSummary) }
        }

        let isOverview = responseMetadata?.overview == true
        let hint: ScooterDockHint? = if isEmpty {
            .emptyArea
        } else {
            isOverview && visibleCount > 0 ? .tapCity : nil
        }
        return .summary(ScooterDockSummary(
            count: visibleCount,
            countContext: activeOrigin.map { viewport.contains($0.point) } == true ? .nearby : .onThisMap,
            lastUpdated: lastUpdated,
            refreshFailure: refreshFailure,
            isOverview: isOverview,
            isDelayed: responseMetadata?.stale == true,
            notices: dockNotices,
            hint: hint,
            chips: dockChips
        ))
    }

    private var refreshFailure: ScooterLoadFailure? {
        guard case let .refreshFailed(failure, _) = loadIssue else { return nil }
        return failure
    }

    /// The failed refresh or the delay to report at the top of a scooter or bay
    /// card, which hides the dock's own status line. Nil while the data is healthy.
    var cardStatus: ScooterDockStatus? {
        if case let .refreshFailed(failure, showing) = loadIssue {
            return failure == .offline ? .offline(showing: showing) : .refreshFailed(showing: showing)
        }
        guard responseMetadata?.stale == true, let lastUpdated else { return nil }
        return .delayed(showing: lastUpdated)
    }

    /// What VoiceOver is told when the dock turns into a card, which happens far
    /// from the marker that was activated: the card's own first lines. Nil for
    /// the count and its chips.
    var dockAnnouncement: String? {
        switch dock {
        case let .scooter(scooter):
            let name = String(
                format: String(localized: "%@ scooter"),
                scooter.providerInfo?.name ?? scooter.provider.capitalized
            )
            return [name, walkingSummary(for: scooter)].compactMap { $0 }.joined(separator: ", ")
        case let .parking(parking):
            let heading = [parking.bayTitle, parkingSubtitle(for: parking)]
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
            return "\(heading). \(parking.notice)"
        case let .outOfDate(failure, lastUpdate):
            let title = String(localized: "These positions are out of date")
            return "\(title). \(ScooterDockStatus.outOfDateBody(failure, lastUpdate: lastUpdate))"
        case .finding, .waiting, .outsideCoverage, .filtersHideEverything, .summary:
            return nil
        }
    }

    /// Whether the data on the map was loaded for the area on screen. Only then
    /// is an empty map a fact about the area rather than a load in progress.
    private var viewportIsLoaded: Bool {
        queryCovers(viewport, zoom: viewportZoom, pending: false)
    }

    /// The filters and what they hide, when they are the reason the loaded area is empty.
    private var hiddenByFilters: ScooterFilterSummary? {
        guard hasActiveFilters else { return nil }
        // The response cannot tell how many scooters there are once the server
        // filtered clustered data by battery or cut the list short.
        let isCountKnown = (queryMinimumBattery ?? 0) == 0 && responseMetadata?.truncated != true
        let hiddenCount: Int? = isCountKnown ? unfilteredVisibleCount : nil
        // Filters that hide nothing are not the reason the map is empty.
        if hiddenCount == 0 { return nil }

        var providers: [ScooterProvider] = []
        if !allProvidersSelected {
            providers = availableProviders.filter(enabledProviders.contains)
            if providers.isEmpty {
                providers = ScooterProvider.allCases.filter(enabledProviders.contains)
            }
        }
        return ScooterFilterSummary(
            hiddenCount: hiddenCount,
            providers: providers,
            minimumBattery: minimumBattery > 0 ? Int(minimumBattery) : nil
        )
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

    func approximateWalkingMinutes(to parking: ScooterParking) -> Int? {
        guard let origin = activeOrigin?.point else { return nil }
        let distance = Self.distance(
            from: origin,
            to: GeoPoint(latitude: parking.latitude, longitude: parking.longitude)
        )
        guard distance.isFinite else { return nil }
        return max(1, Int(ceil(distance / Self.approximateWalkingMetersPerMinute)))
    }

    /// The second line of the scooter card: "≈4 min walk · 320 m", or
    /// "≈4 min walk from Zürich HB · 320 m" when the origin is a searched
    /// place. Nil without an origin.
    func walkingSummary(for scooter: Scooter) -> String? {
        guard let minutes = approximateWalkingMinutes(to: scooter),
              let distance = formattedDistance(for: scooter) else { return nil }
        if let searchedDestination {
            return String(
                format: String(localized: "≈%1$lld min walk from %2$@ · %3$@"),
                Int64(minutes),
                searchedDestination.title,
                distance
            )
        }
        return String(format: String(localized: "≈%1$lld min walk · %2$@"), Int64(minutes), distance)
    }

    /// The second line of the bay card: "Rue Faidherbe · ≈3 min walk", with
    /// "from Zürich HB" when the origin is a searched place, or the name alone
    /// without an origin.
    func parkingSubtitle(for parking: ScooterParking) -> String {
        guard let minutes = approximateWalkingMinutes(to: parking) else { return parking.name }
        let walk = if let searchedDestination {
            String(
                format: String(localized: "≈%1$lld min walk from %2$@"),
                Int64(minutes),
                searchedDestination.title
            )
        } else {
            String(format: String(localized: "≈%lld min walk"), Int64(minutes))
        }
        guard !parking.name.isEmpty else { return walk }
        return String(format: String(localized: "%1$@ · %2$@"), parking.name, walk)
    }

    func setRideEstimateMinutes(_ minutes: Int) {
        let normalizedMinutes = RideEstimateDuration.normalized(minutes)
        guard normalizedMinutes != rideEstimateMinutes else { return }
        ScooterAnalytics.shared.track("ride_duration", value: normalizedMinutes)
        rideEstimateMinutes = normalizedMinutes
        defaults.set(normalizedMinutes, forKey: Self.rideEstimateMinutesKey)
    }

    func ridePass(for provider: ScooterProvider) -> ProviderRidePass {
        ridePasses[provider] ?? ProviderRidePass()
    }

    func setRidePass(_ pass: ProviderRidePass, for provider: ScooterProvider) {
        ScooterAnalytics.shared.track("ride_pass_change", provider: provider.rawValue)
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
        isSceneActive = true
        if hasStarted { startHeadingUpdates() }
        expireParkingIfNeeded()
        // Back in the foreground a due refresh starts at once. The old data
        // stays on the map until the outcome is known.
        refreshIfDue(respectingAttemptGap: false)
    }

    func becameInactive() {
        isSceneActive = false
        stopHeadingUpdates()
        refreshTimerTask?.cancel()
        refreshTimerTask = nil
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

    /// What the refresh timer does when it fires: bays past their time go, and
    /// the scooters are fetched again once they are due or have expired.
    func autoRefreshIfNeeded() {
        expireParkingIfNeeded()
        refreshIfDue(respectingAttemptGap: true)
    }

    private var refreshAfter: TimeInterval {
        guard let seconds = responseMetadata?.refreshAfterSeconds, seconds > 0 else {
            return refreshPolicy.defaultRefreshAfter
        }
        return TimeInterval(seconds)
    }

    private func refreshIfDue(respectingAttemptGap: Bool) {
        // A request in flight decides the outcome; nothing is cleared meanwhile.
        guard isSceneActive, fetchTask == nil else { return }
        guard lastAttemptAt != nil else {
            if !isLocating { refresh() }
            return
        }

        let due = respectingAttemptGap
            ? refreshPolicy.nextAttempt(
                lastSuccess: lastSuccessAt,
                refreshAfter: refreshAfter,
                expiresAt: vehiclesExpireAt,
                lastAttempt: lastAttemptAt
            )
            : refreshPolicy.refreshDue(
                lastSuccess: lastSuccessAt,
                refreshAfter: refreshAfter,
                expiresAt: vehiclesExpireAt
            )
        if clock() >= due {
            refresh()
        } else {
            scheduleAutomaticRefresh()
        }
    }

    private func scheduleAutomaticRefresh() {
        refreshTimerTask?.cancel()
        refreshTimerTask = nil
        guard isSceneActive, fetchTask == nil, lastAttemptAt != nil else { return }

        let nextAttempt = refreshPolicy.nextAttempt(
            lastSuccess: lastSuccessAt,
            refreshAfter: refreshAfter,
            expiresAt: vehiclesExpireAt,
            lastAttempt: lastAttemptAt
        )
        let delay = max(0, nextAttempt.timeIntervalSince(clock()))
        refreshTimerTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self else { return }
            refreshTimerTask = nil
            autoRefreshIfNeeded()
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

    /// "Try again" and "Refresh": a manual refresh, fetched at once.
    func retryLoad() {
        ScooterAnalytics.shared.track("refresh")
        refresh()
    }

    func showAllProviders() {
        ScooterAnalytics.shared.track("providers_all")
        enabledProviders = Set(ScooterProvider.allCases)
    }

    func showProviders(_ providers: Set<ScooterProvider>) {
        ScooterAnalytics.shared.track("provider_filter", provider: providers.count == 1 ? providers.first?.rawValue : nil, value: providers.count)
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
        ScooterAnalytics.shared.track("provider_filter", provider: provider.rawValue, result: enabledProviders.contains(provider) ? "disabled" : "enabled")
        if enabledProviders.contains(provider) {
            enabledProviders.remove(provider)
        } else {
            enabledProviders.insert(provider)
        }
    }

    func resetFilters() {
        ScooterAnalytics.shared.track("filters_reset")
        let batteryChanged = minimumBattery != 0
        minimumBattery = 0
        enabledProviders = Set(ScooterProvider.allCases)
        if batteryChanged, ScooterClusteringPolicy.shouldCluster(at: viewportZoom) {
            clusters = []
            scheduleFetch(for: viewport.expanded(by: 0.25), zoom: viewportZoom, debounce: true)
        }
    }

    /// Sets the minimum battery to a preset; other values snap down (45 → 30).
    func setMinimumBattery(_ value: Double) {
        let normalizedValue = Double(ScooterBatteryFilter.snapped(
            value.isFinite ? Int(min(100, max(0, value))) : 0
        ))
        guard normalizedValue != minimumBattery else { return }
        ScooterAnalytics.shared.track("battery_filter", value: Int(normalizedValue))
        minimumBattery = normalizedValue
        if ScooterClusteringPolicy.shouldCluster(at: viewportZoom) {
            clusters = []
            scheduleFetch(for: viewport.expanded(by: 0.25), zoom: viewportZoom, debounce: true)
        }
    }

    func focusOnUser() {
        ScooterAnalytics.shared.track("locate")
        searchedDestination = nil
        keepsMapOnFirstFix = false
        if let userLocation {
            requestUserFocus(at: userLocation)
        } else {
            isLocating = true
            requestLocationAccess()
        }
    }

    /// "Turn on location to see walking time" on a card: locates like Near me,
    /// but the map stays where it is, so the card is not closed by the map
    /// moving away from the scooter.
    func locateForWalkingTime() {
        guard userLocation == nil else { return }
        ScooterAnalytics.shared.track("locate")
        keepsMapOnFirstFix = true
        isLocating = true
        requestLocationAccess()
    }

    /// Chooses a place: it becomes the origin for walking times, is remembered
    /// for this session and the map moves there.
    func focusOnAddress(_ destination: MapDestination) {
        ScooterAnalytics.shared.track("search_select")
        selectedScooterID = nil
        selectedParkingID = nil
        placeChoices += 1
        searchedDestination = destination
        rememberPlace(destination)
        focusToken += 1
        focusRequest = destination.kind == .city
            ? .city(destination.point, token: focusToken)
            : MapFocusRequest(point: destination.point, token: focusToken)
    }

    /// A "Cities with scooters" chip: like choosing the city as a place.
    func chooseCity(_ city: ScooterCity) {
        focusOnAddress(city.destination)
    }

    /// A closest-city chip: the map flies to the city, the place stays as it is.
    func focusOnCity(_ city: ScooterCity) {
        selectedScooterID = nil
        selectedParkingID = nil
        placeChoices += 1
        focusToken += 1
        focusRequest = .city(city.center, token: focusToken)
    }

    private func rememberPlace(_ destination: MapDestination) {
        recentPlaces.removeAll { $0.id == destination.id }
        recentPlaces.insert(destination, at: 0)
        if recentPlaces.count > Self.maximumRecentPlaces {
            recentPlaces.removeLast(recentPlaces.count - Self.maximumRecentPlaces)
        }
    }

    /// The card header: centres the scooter and leaves the zoom as it is.
    func focusOnScooter(_ scooter: Scooter) {
        selectScooter(scooter.id)
        focusToken += 1
        focusRequest = .center(GeoPoint(scooter.coordinate), token: focusToken)
    }

    func clearAddressSearch() {
        searchedDestination = nil
    }

    func selectScooter(_ id: String?) {
        guard id != selectedScooterID else { return }
        ScooterAnalytics.shared.track(id == nil ? "vehicle_dismiss" : "vehicle_select", provider: id.flatMap { vehiclesByID[$0]?.provider })
        selectedScooterID = id
    }

    /// Selects a parking bay by id, or closes the bay card with nil. The map
    /// reports `parking_select` itself, so nothing is tracked here.
    func selectParking(_ id: String?) {
        guard id != selectedParkingID else { return }
        if id != nil { selectedScooterID = nil }
        selectedParkingID = id
    }

    /// A tap on the map background: closes the scooter or the bay card.
    func clearSelection() {
        selectScooter(nil)
        selectedParkingID = nil
    }

    func dismissLocationIssue() {
        locationIssueDismissed = true
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
        var unfilteredCount = summary.unfilteredCount
        var unfilteredProviders = summary.unfilteredProviders
        if responseMetadata?.mode == "clusters" {
            for cluster in clusters where viewport.contains(latitude: cluster.latitude, longitude: cluster.longitude) {
                for (providerID, providerCount) in cluster.providers {
                    unfilteredCount += providerCount
                    guard let provider = ScooterProvider(rawValue: providerID) else { continue }
                    if providerCount > 0 { unfilteredProviders.insert(provider) }
                    providers[provider, default: 0] += providerCount
                    if enabledProviders.contains(provider) { count += providerCount }
                }
            }
        }
        visibleScooterCount = count
        visibleProviderCounts = providers
        unfilteredVisibleCount = unfilteredCount
        unfilteredVisibleProviders = unfilteredProviders
    }

    private var representedVehicleCount: Int {
        vehicles.count + clusters.reduce(0) { $0 + $1.count }
    }

    private func clearSelectionIfHidden() {
        if let selectedParkingID, !mapParking.contains(where: { $0.id == selectedParkingID }) {
            self.selectedParkingID = nil
        }

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
        refreshTimerTask?.cancel()
        refreshTimerTask = nil

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

            do {
                let response = try await api.scooters(
                    bounds: bounds,
                    zoom: zoom,
                    minimumBattery: requestMinimumBattery
                )
                guard !Task.isCancelled, activeRequestID == requestID else { return }
                // The backend preserves recent successful feeds independently.
                // Accept healthy cities even when another operator is unavailable.
                // A response is shown whatever its own timestamps say.
                let receivedAt = clock()
                isApplyingResponse = true
                vehicles = response.vehicles
                clusters = response.clusters
                parking = response.parking
                responseMetadata = response.meta
                isApplyingResponse = false
                queryBounds = bounds
                queryZoom = zoom
                queryMinimumBattery = requestMinimumBattery
                rebuildVehicleIndex()
                rebuildMapScooters()
                rebuildMapClusters()
                rebuildVisibleCounts()
                distanceOrigin = fetchOrigin
                lastUpdated = min(Self.apiDate(response.meta?.generatedAt) ?? receivedAt, receivedAt)
                lastSuccessAt = receivedAt
                lastAttemptAt = receivedAt
                loadIssue = nil
                scheduleDataExpiry(response.meta, receivedAt: receivedAt)
                expireParkingIfNeeded()
                clearSelectionIfHidden()
            } catch is CancellationError {
                return
            } catch {
                guard activeRequestID == requestID else { return }
                // Retries repeat every few seconds; report a failure once, when it starts.
                if loadIssue == nil {
                    ScooterAnalytics.shared.track("data_error", result: "request_failed")
                }
                lastAttemptAt = clock()
                handleLoadFailure(ScooterLoadFailure(error))
            }

        }
    }

    private func handleLoadFailure(_ failure: ScooterLoadFailure) {
        guard let lastUpdated else {
            loadIssue = .firstLoadFailed(failure)
            return
        }
        if case let .outOfDate(_, lastUpdate) = loadIssue {
            loadIssue = .outOfDate(failure, lastUpdate: lastUpdate)
            return
        }
        guard let vehiclesExpireAt, clock() >= vehiclesExpireAt else {
            // The data on the map is still valid and stays exactly as it is.
            loadIssue = .refreshFailed(failure, showing: lastUpdated)
            return
        }

        // Only now is the data both expired and impossible to renew.
        vehicles = []
        clusters = []
        selectedScooterID = nil
        selectedParkingID = nil
        queryBounds = nil
        loadIssue = .outOfDate(failure, lastUpdate: lastUpdated)
    }

    private func clearPendingFetch() {
        isLoading = false
        activeRequestID = nil
        pendingQueryBounds = nil
        pendingQueryZoom = nil
        pendingQueryMinimumBattery = nil
        fetchTask = nil
        scheduleAutomaticRefresh()
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

    private func scheduleDataExpiry(_ meta: ScooterResponseMetadata?, receivedAt: Date) {
        let observedAt = min(receivedAt, Self.apiDate(meta?.generatedAt) ?? receivedAt)
        let maximumAge: TimeInterval = meta?.overview == true ? 3 * 3600 : 300
        // Scooters past this moment are only cleared once a refresh has failed.
        vehiclesExpireAt = min(Self.apiDate(meta?.expiresAt) ?? .distantFuture,
            observedAt.addingTimeInterval(maximumAge))
        parkingExpireAt = min(Self.apiDate(meta?.parkingExpiresAt) ?? .distantFuture,
            receivedAt.addingTimeInterval(300))

        parkingExpiryTask?.cancel()
        let delay = max(0, (parkingExpireAt ?? receivedAt).timeIntervalSince(receivedAt))
        parkingExpiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            self?.expireParkingIfNeeded()
        }
    }

    /// Parking bays expire on their own schedule, whatever happens to the scooters.
    func expireParkingIfNeeded() {
        guard let parkingExpireAt, clock() >= parkingExpireAt else { return }
        self.parkingExpireAt = nil
        parking = []
        clearSelectionIfHidden()
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

    private var isLocationAuthorized: Bool {
        locationManager.authorizationStatus == .authorizedWhenInUse ||
            locationManager.authorizationStatus == .authorizedAlways
    }

    private func requestLocationAccess() {
        // A new attempt brings a dismissed card back and retires the last "not found".
        locationIssueDismissed = false
        if locationProblem == .notFound { locationProblem = nil }
        placeChoicesAtLocate = placeChoices

        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationProblem = nil
            isLocating = true
            // The wait for a fix starts with the answer to the prompt, however
            // long that takes: the authorization callback begins it.
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            locationProblem = nil
            isLocating = true
            locationManager.startUpdatingLocation()
            startHeadingUpdates()
            if userLocation == nil {
                beginLocationTimeout()
            }
        case .denied:
            locationProblem = .denied
            isLocating = false
            finishLocationAttemptWithoutFix()
        case .restricted:
            locationProblem = .restricted
            isLocating = false
            finishLocationAttemptWithoutFix()
        @unknown default:
            isLocating = false
            finishLocationAttemptWithoutFix()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let statusChanged = status != knownAuthorizationStatus
        knownAuthorizationStatus = status
        if status != .authorizedAlways && status != .authorizedWhenInUse {
            stopHeadingUpdates()
        }
        // CLLocationManager can deliver the current authorization state as soon as
        // its delegate is assigned. Wait until the app has actually requested a
        // location so model initialization cannot unexpectedly recenter the map.
        guard hasStarted || isLocating else { return }

        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            locationProblem = nil
            manager.startUpdatingLocation()
            startHeadingUpdates()
            // With a position already in hand there is nothing to wait for.
            if userLocation == nil {
                isLocating = true
                beginLocationTimeout()
            }
        case .denied, .restricted:
            // The same goes for the location card: a refusal that was already
            // known, with no request pending, answers nothing the user just did.
            guard statusChanged || isLocating else { return }
            locationProblem = status == .denied ? .denied : .restricted
            isLocating = false
            finishLocationAttemptWithoutFix()
        case .notDetermined:
            locationProblem = nil
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
        if !hadLocation { ScooterAnalytics.shared.track("location_result", result: "success") }
        userLocation = nextLocation
        isLocating = false
        locationProblem = nil
        if !hasLocatedOnce {
            hasLocatedOnce = true
            defaults.set(true, forKey: Self.hasLocatedOnceKey)
        }

        // A place chosen while the fix was on its way is the later wish, however
        // late the fix is: the map stays there and the place stays the origin.
        let keepsMap = keepsMapOnFirstFix || placeChoices != placeChoicesAtLocate
        keepsMapOnFirstFix = false
        if !hadLocation, keepsMap {
            // Also when a card asked: the walking time appears and the map stays put.
            distanceOrigin = nextLocation
        } else if !hadLocation {
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
        let code = (error as? CLError)?.code
        if code == .denied {
            switch manager.authorizationStatus {
            case .denied:
                locationProblem = .denied
            case .restricted:
                locationProblem = .restricted
            default:
                break
            }
        }
        // Core Location keeps trying after "location unknown"; the timeout decides.
        if code == .locationUnknown, locationTimeoutTask != nil { return }
        isLocating = false
        finishLocationAttemptWithoutFix()
    }

    private func beginLocationTimeout() {
        locationTimeoutTask?.cancel()
        let timeout = locationTimeout
        locationTimeoutTask = Task { [weak self] in
            do {
                try await Task.sleep(for: timeout)
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
        // Allowed, and still no position in time.
        if locationProblem == nil, userLocation == nil, isLocationAuthorized {
            locationProblem = .notFound
        }
        ScooterAnalytics.shared.track("location_result", result: locationProblem == .denied ? "denied" : "unavailable")
        keepsMapOnFirstFix = false
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
