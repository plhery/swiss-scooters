import SwiftUI
import UIKit

struct ScooterMapScreen: View {
    @State private var model = ScooterMapModel()
    @State private var searchIsExpanded = false
    @State private var filtersPresented = false
    @State private var settingsPresented = false
    @State private var dockHeight: CGFloat = 128
    @State private var topChromeFrame = CGRect.null
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
                    interactionExclusionFrame: topChromeFrame,
                    onRegionChange: model.updateViewport,
                    onSelectionChange: model.selectScooter,
                    userHeading: model.userHeading,
                    showsMapCompass: !searchIsExpanded,
                    parking: model.mapParking,
                    selectedParkingID: model.selectedParkingID,
                    onParkingSelectionChange: model.selectParking
                )
                .ignoresSafeArea()

                VStack(spacing: 8) {
                    // The search bar and what sits under it shield the map
                    // from taps, and the compass stays clear of them.
                    VStack(spacing: 8) {
                        ScooterSearchIsland(
                            state: model.searchBarState,
                            isSearching: $searchIsExpanded,
                            hasActiveFilters: model.hasActiveFilters,
                            recentPlaces: model.recentPlaces,
                            nearbyCities: searchIsExpanded ? model.nearbyCities.map(\.city) : [],
                            bottomLimit: proxy.frame(in: .global).maxY,
                            onSelect: model.focusOnAddress,
                            onChooseCity: model.chooseCity,
                            onClear: model.clearAddressSearch,
                            onUseCurrentLocation: model.focusOnUser,
                            onShowFilters: {
                                searchIsExpanded = false
                                filtersPresented = true
                            },
                            onShowSettings: {
                                searchIsExpanded = false
                                settingsPresented = true
                            }
                        )

                        if !searchIsExpanded {
                            topNotices
                        }
                    }
                    .onGeometryChange(for: CGRect.self) { geometry in
                        geometry.frame(in: .global)
                    } action: { frame in
                        topChromeFrame = frame
                    }
                    .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: firstLoadFailure)
                    .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: model.locationIssue)

                    Spacer(minLength: 0)
                }
                .padding(.top, 8)
                .padding(.horizontal, 12)
                .zIndex(20)

                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        FloatingMapControls(model: model)
                    }
                    .padding(.trailing, 12)
                    .padding(
                        .bottom,
                        dockHeight + max(proxy.safeAreaInsets.bottom, 8) + 10
                    )
                }
                .opacity(searchIsExpanded ? 0 : 1)
                .scaleEffect(searchIsExpanded ? 0.92 : 1, anchor: .bottomTrailing)
                .allowsHitTesting(!searchIsExpanded)
                .accessibilityHidden(searchIsExpanded)
                .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: searchIsExpanded)

                VStack {
                    Spacer()
                    ScooterControlDock(
                        model: model,
                        maximumContentHeight: max(
                            160,
                            proxy.size.height - (dynamicTypeSize.isAccessibilitySize ? 300 : 220)
                        ),
                        onEditFilters: { filtersPresented = true },
                        onHeightChange: { dockHeight = $0 }
                    )
                    .padding(.horizontal, 10)
                    .padding(.bottom, max(proxy.safeAreaInsets.bottom, 8))
                }
                .opacity(searchIsExpanded ? 0 : 1)
                .scaleEffect(searchIsExpanded ? 0.96 : 1, anchor: .bottom)
                .allowsHitTesting(!searchIsExpanded)
                .accessibilityHidden(searchIsExpanded)
                .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: searchIsExpanded)
            }
        }
        // Keep the dock anchored to the screen while search dismisses. Otherwise
        // it fades back in within the keyboard's shrinking safe area and jumps.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .background(Color(.systemBackground))
        .task {
            ScooterAnalytics.shared.track()
            ScooterAnalytics.shared.track("app_open")
            model.start()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                ScooterAnalytics.shared.track("app_foreground")
                model.becameActive()
            } else {
                model.becameInactive()
            }
        }
        .onDisappear { model.becameInactive() }
        .onChange(of: searchIsExpanded) { _, expanded in
            ScooterAnalytics.shared.track(expanded ? "search_open" : "search_close")
        }
        .onChange(of: filtersPresented) { _, open in
            ScooterAnalytics.shared.track(open ? "filters_open" : "panel_close")
            if open { ScooterAnalytics.shared.track(screen: "/filters") }
        }
        .onChange(of: settingsPresented) { _, open in
            ScooterAnalytics.shared.track(open ? "settings_open" : "panel_close")
            if open { ScooterAnalytics.shared.track(screen: "/settings") }
        }
        .sheet(isPresented: $filtersPresented) {
            ScooterFilterSheet(model: model)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $settingsPresented) {
            ScooterSettingsSheet(model: model, onUseCurrentLocation: model.focusOnUser)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sensoryFeedback(.selection, trigger: model.selectedScooterID)
        .sensoryFeedback(.selection, trigger: model.selectedParkingID)
    }

    /// Only a first load that failed is reported under the search bar; later
    /// failures are the dock's to report, next to the data they concern.
    private var firstLoadFailure: ScooterLoadFailure? {
        guard case let .firstLoadFailed(failure) = model.loadIssue else { return nil }
        return failure
    }

    @ViewBuilder
    private var topNotices: some View {
        if let firstLoadFailure {
            MapStatusBanner(
                message: firstLoadFailure.message,
                actionTitle: String(localized: "Try again"),
                isBusy: model.isLoading,
                action: model.retryLoad
            )
            .transition(.move(edge: .top).combined(with: .opacity))
        }

        if let issue = model.locationIssue {
            LocationIssueCard(
                issue: issue,
                onOpenSettings: openLocationSettings,
                onSearchPlace: {
                    // Searching is the answer to the card, so it goes away.
                    model.dismissLocationIssue()
                    searchIsExpanded = true
                },
                onRetry: model.focusOnUser,
                onDismiss: model.dismissLocationIssue
            )
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func openLocationSettings() {
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settingsURL)
    }
}

#if DEBUG
private struct ScooterMapScreenPreview: PreviewProvider {
    static var previews: some View {
        ScooterMapScreen()
    }
}
#endif
