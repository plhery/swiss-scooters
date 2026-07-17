import CoreLocation
import Foundation
import MapKit
import Observation

@MainActor
@Observable
final class ScooterMapModel: NSObject, @MainActor CLLocationManagerDelegate {
    static let zurichCenter = GeoPoint(latitude: 47.3769, longitude: 8.5417)
    static let initialRegion = MKCoordinateRegion(
        center: zurichCenter.coordinate,
        latitudinalMeters: 1_800,
        longitudinalMeters: 1_800
    )

    private(set) var vehicles: [Scooter] = [] {
        didSet { rebuildVisibleData() }
    }
    var viewport = GeoBounds(region: initialRegion) {
        didSet { rebuildVisibleData() }
    }
    var isLoading = false
    var isLocating = false
    var errorMessage: String?
    var lastUpdated: Date?
    var userLocation: GeoPoint?
    var selectedProvider: ScooterProvider? {
        didSet { rebuildVisibleData() }
    }
    var selectedScooterID: String?
    var focusRequest: MapFocusRequest?

    var minimumBattery: Double {
        didSet {
            UserDefaults.standard.set(Int(minimumBattery), forKey: Self.minimumBatteryKey)
            rebuildVisibleData()
            clearSelectionIfHidden()
        }
    }

    var mapStyle: AppleMapStyle {
        didSet {
            UserDefaults.standard.set(mapStyle.rawValue, forKey: Self.mapStyleKey)
        }
    }

    @ObservationIgnored private let api: ScooterAPI
    @ObservationIgnored private let locationManager = CLLocationManager()
    @ObservationIgnored private var queryBounds: GeoBounds?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var focusToken = 0
    @ObservationIgnored private var hasStarted = false
    @ObservationIgnored private var distanceOrigin = zurichCenter
    private(set) var visibleScooters: [Scooter] = []
    private(set) var visibleProviderCounts: [ScooterProvider: Int] = [:]

    private static let minimumBatteryKey = "minimum-battery"
    private static let mapStyleKey = "apple-map-style"

    override init() {
        let savedBattery = UserDefaults.standard.object(forKey: Self.minimumBatteryKey) as? Int ?? 0
        minimumBattery = Double(savedBattery)

        let savedStyle = UserDefaults.standard.string(forKey: Self.mapStyleKey)
        mapStyle = AppleMapStyle(rawValue: savedStyle ?? "") ?? .standard
        api = ScooterAPI()

        super.init()

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 20
    }

    var selectedScooter: Scooter? {
        guard let selectedScooterID else { return nil }
        return vehicles.first { $0.id == selectedScooterID }
    }

    var visibleCount: Int { visibleScooters.count }

    func count(for provider: ScooterProvider) -> Int {
        visibleProviderCounts[provider, default: 0]
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        requestLocationAccess()
        scheduleFetch(for: viewport.expanded(by: 0.25), debounce: false)
    }

    func becameActive() {
        guard let lastUpdated else {
            refresh()
            return
        }
        if Date().timeIntervalSince(lastUpdated) > 60 {
            refresh()
        }
    }

    func updateViewport(_ region: MKCoordinateRegion) {
        let nextViewport = GeoBounds(region: region)
        viewport = nextViewport
        clearSelectionIfHidden()

        guard queryBounds?.contains(nextViewport) != true else { return }
        scheduleFetch(for: nextViewport.expanded(by: 0.25), debounce: true)
    }

    func refresh() {
        scheduleFetch(for: viewport.expanded(by: 0.25), debounce: false)
    }

    func toggle(provider: ScooterProvider) {
        selectedProvider = selectedProvider == provider ? nil : provider
        clearSelectionIfHidden()
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

    func selectScooter(_ id: String?) {
        selectedScooterID = id
    }

    private func passesBatteryFilter(_ scooter: Scooter) -> Bool {
        minimumBattery == 0 || (scooter.battery.map(Double.init) ?? -1) >= minimumBattery
    }

    private func rebuildVisibleData() {
        var nextVisible: [Scooter] = []
        nextVisible.reserveCapacity(min(vehicles.count, 1_000))

        var nextCounts: [ScooterProvider: Int] = [:]
        nextCounts.reserveCapacity(ScooterProvider.allCases.count)

        for scooter in vehicles {
            guard viewport.contains(latitude: scooter.latitude, longitude: scooter.longitude),
                  passesBatteryFilter(scooter) else { continue }

            if let provider = scooter.providerInfo {
                nextCounts[provider, default: 0] += 1
            }

            if selectedProvider == nil || scooter.providerInfo == selectedProvider {
                nextVisible.append(scooter)
            }
        }

        visibleScooters = nextVisible
        visibleProviderCounts = nextCounts
    }

    private func clearSelectionIfHidden() {
        guard let selectedScooter else { return }
        let remainsVisible = viewport.contains(
            latitude: selectedScooter.latitude,
            longitude: selectedScooter.longitude
        ) && passesBatteryFilter(selectedScooter) &&
            (selectedProvider == nil || selectedScooter.providerInfo == selectedProvider)

        if !remainsVisible {
            selectedScooterID = nil
        }
    }

    private func scheduleFetch(for bounds: GeoBounds, debounce: Bool) {
        fetchTask?.cancel()

        let requestID = UUID()
        activeRequestID = requestID
        let origin = userLocation ?? Self.zurichCenter

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
                let response = try await api.scooters(origin: origin, bounds: bounds)
                guard !Task.isCancelled, activeRequestID == requestID else { return }
                vehicles = response.vehicles
                queryBounds = bounds
                distanceOrigin = origin
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
            }
        }
    }

    private func requestLocationAccess() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            isLocating = true
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            isLocating = true
            locationManager.startUpdatingLocation()
        case .denied, .restricted:
            isLocating = false
        @unknown default:
            isLocating = false
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            isLocating = true
            manager.startUpdatingLocation()
        case .denied, .restricted:
            isLocating = false
        case .notDetermined:
            break
        @unknown default:
            isLocating = false
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let nextLocation = GeoPoint(location.coordinate)
        let hadLocation = userLocation != nil
        userLocation = nextLocation
        isLocating = false

        if !hadLocation {
            focusToken += 1
            focusRequest = MapFocusRequest(point: nextLocation, token: focusToken)
            distanceOrigin = nextLocation
            refresh()
        } else if Self.distance(from: distanceOrigin, to: nextLocation) >= max(75, location.horizontalAccuracy) {
            distanceOrigin = nextLocation
            refresh()
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        isLocating = false
    }

    private static func distance(from start: GeoPoint, to end: GeoPoint) -> CLLocationDistance {
        CLLocation(latitude: start.latitude, longitude: start.longitude)
            .distance(from: CLLocation(latitude: end.latitude, longitude: end.longitude))
    }
}
