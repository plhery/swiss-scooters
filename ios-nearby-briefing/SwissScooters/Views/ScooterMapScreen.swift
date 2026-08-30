import SwiftUI
import UIKit

struct ScooterMapScreen: View {
    @State private var model = ScooterMapModel()
    @State private var nearbyListPresented = false
    @State private var searchIsExpanded = false
    @State private var filtersPresented = false
    @State private var settingsPresented = false
    @State private var collapsedDockHeight: CGFloat = 174
    @State private var showLocationIntro = true
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        GeometryReader { proxy in
            ZStack {
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

                VStack(spacing: 8) {
                    OriginSearchIsland(
                        title: model.activeOriginTitle ?? String(localized: "Choose an origin"),
                        isSearching: $searchIsExpanded,
                        hasActiveFilters: model.hasActiveFilters,
                        onSelect: { destination in
                            showLocationIntro = false
                            model.focusOnAddress(destination)
                        },
                        onClear: model.clearAddressSearch,
                        onUseCurrentLocation: {
                            showLocationIntro = false
                            model.focusOnUser()
                        },
                        onShowFilters: {
                            searchIsExpanded = false
                            filtersPresented = true
                        },
                        onShowSettings: {
                            searchIsExpanded = false
                            settingsPresented = true
                        }
                    )

                    statusBanner

                    Spacer(minLength: 0)
                }
                .padding(.top, max(proxy.safeAreaInsets.top + 8, 8))
                .padding(.horizontal, 12)

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
                        collapsedDockHeight + max(proxy.safeAreaInsets.bottom, 8) + 10
                    )
                }
                .opacity(searchIsExpanded ? 0 : 1)
                .scaleEffect(searchIsExpanded ? 0.92 : 1, anchor: .bottomTrailing)
                .allowsHitTesting(!searchIsExpanded)
                .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: searchIsExpanded)

                if showLocationIntro,
                   model.userLocation == nil,
                   model.searchedDestination == nil,
                   !searchIsExpanded {
                    VStack {
                        Spacer()
                        locationIntroCard
                            .padding(.horizontal, 16)
                            .padding(
                                .bottom,
                                collapsedDockHeight + max(proxy.safeAreaInsets.bottom, 8) + 18
                            )
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                VStack {
                    Spacer()
                    ScooterControlDock(
                        model: model,
                        isExpanded: $nearbyListPresented,
                        maximumBriefingHeight: max(
                            140,
                            proxy.size.height - (dynamicTypeSize.isAccessibilitySize ? 300 : 220)
                        ),
                        onCollapsedHeightChange: { collapsedDockHeight = $0 }
                    )
                    .padding(.horizontal, 10)
                    .padding(.bottom, max(proxy.safeAreaInsets.bottom, 8))
                }
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
        .onChange(of: searchIsExpanded) { _, expanded in
            if expanded {
                showLocationIntro = false
            }
        }
        .sheet(isPresented: $nearbyListPresented) {
            NearbyScooterListSheet(model: model)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $filtersPresented) {
            ScooterFilterSheet(model: model)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $settingsPresented) {
            ScooterSettingsSheet(
                model: model,
                onUseCurrentLocation: {
                    showLocationIntro = false
                    model.focusOnUser()
                }
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sensoryFeedback(.selection, trigger: model.selectedScooterID)
    }

    @ViewBuilder
    private var statusBanner: some View {
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
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
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
