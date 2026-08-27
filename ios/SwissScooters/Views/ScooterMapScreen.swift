import SwiftUI
import UIKit

struct ScooterMapScreen: View {
    @State private var model = ScooterMapModel()
    @State private var controlsExpanded = false
    @State private var collapsedDockHeight: CGFloat = 145
    @State private var showLocationIntro = true
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                ScooterMapView(
                    scooters: model.mapScooters,
                    scooterRevision: model.mapScootersRevision,
                    clusters: model.mapClusters,
                    clusterRevision: model.mapClustersRevision,
                    usesServerClusters: model.responseMetadata?.mode == "clusters",
                    mapStyle: model.mapStyle,
                    showsUserLocation: model.userLocation != nil,
                    focusRequest: model.focusRequest,
                    destination: model.searchedDestination,
                    selectedScooterID: model.selectedScooterID,
                    onRegionChange: model.updateViewport,
                    onSelectionChange: handleSelection
                )
                .ignoresSafeArea()

                statusOverlay(safeAreaTop: proxy.safeAreaInsets.top)

                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        FloatingMapControls(
                            model: model,
                            onLocationIntent: { showLocationIntro = false }
                        )
                    }
                    .padding(.trailing, 12)
                    .padding(
                        .bottom,
                        collapsedDockHeight + max(proxy.safeAreaInsets.bottom, 8) + 8
                    )
                }
                .opacity(controlsExpanded ? 0 : 1)
                .scaleEffect(controlsExpanded ? 0.92 : 1, anchor: .bottomTrailing)
                .allowsHitTesting(!controlsExpanded)
                .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: controlsExpanded)

                if showLocationIntro && model.userLocation == nil && model.searchedDestination == nil {
                    VStack {
                        Spacer()
                        locationIntroCard
                            .padding(.horizontal, 16)
                            .padding(
                                .bottom,
                                collapsedDockHeight + max(proxy.safeAreaInsets.bottom, 8) + 16
                            )
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                ScooterControlDock(
                    model: model,
                    isExpanded: $controlsExpanded,
                    onCollapsedHeightChange: { collapsedDockHeight = $0 }
                )
                    .padding(.horizontal, 10)
                    .padding(.bottom, max(proxy.safeAreaInsets.bottom, 8))
            }
        }
        .background(Color(.systemBackground))
        .task { model.start() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    return
                }
                model.autoRefreshIfNeeded()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                model.becameActive()
            }
        }
        .onChange(of: controlsExpanded) { _, expanded in
            if expanded {
                showLocationIntro = false
            }
        }
        .sensoryFeedback(.selection, trigger: model.selectedScooterID)
    }

    @ViewBuilder
    private func statusOverlay(safeAreaTop: CGFloat) -> some View {
        VStack {
            if let errorMessage = model.errorMessage {
                MapStatusBanner(
                    message: errorMessage,
                    style: .error,
                    actionTitle: String(localized: "Retry"),
                    action: model.refresh
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            } else if model.locationAuthorizationIssue == .denied {
                MapStatusBanner(
                    message: LocationAuthorizationIssue.denied.message,
                    style: .location,
                    actionTitle: String(localized: "Settings"),
                    action: openLocationSettings
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            } else if model.locationAuthorizationIssue == .restricted {
                MapStatusBanner(
                    message: LocationAuthorizationIssue.restricted.message,
                    style: .location,
                    actionTitle: nil,
                    action: nil
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            } else if model.isLocating {
                MapStatusBanner(
                    message: String(localized: "Finding your location…"),
                    style: .progress,
                    actionTitle: nil,
                    action: nil
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .padding(.top, max(safeAreaTop + 6, 12))
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: model.errorMessage)
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: model.locationAuthorizationIssue)
        .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: model.isLocating)
    }

    private var locationIntroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Find a scooter nearby")
                    .font(.headline)
                Text("Use your location for nearby distances, or search any Swiss address.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 8) {
                    locationIntroActions
                }
            } else {
                HStack(spacing: 8) {
                    locationIntroActions
                }
            }
        }
        .padding(16)
        .frame(maxWidth: 390, alignment: .leading)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 6)
    }

    @ViewBuilder
    private var locationIntroActions: some View {
        Button("Use my location") {
            showLocationIntro = false
            model.focusOnUser()
        }
        .buttonStyle(.glassProminent)
        .font(.caption.weight(.semibold))
        .frame(minHeight: 44)

        Button("Browse Switzerland") {
            showLocationIntro = false
            model.focusOnSwitzerland()
        }
        .buttonStyle(.glass)
        .font(.caption.weight(.semibold))
        .frame(minHeight: 44)
    }

    private func openLocationSettings() {
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settingsURL)
    }

    private func handleSelection(_ id: String?) {
        model.selectScooter(id)
    }
}

#if DEBUG
private struct ScooterMapScreenPreview: PreviewProvider {
    static var previews: some View {
        ScooterMapScreen()
    }
}
#endif
