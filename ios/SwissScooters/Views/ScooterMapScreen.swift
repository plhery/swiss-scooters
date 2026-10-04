import SwiftUI
import UIKit

struct ScooterMapScreen: View {
    @State private var model: ScooterMapModel
    @State private var searchIsExpanded = false
    @State private var filtersPresented = false
    @State private var settingsPresented = false
    @State private var dockHeight: CGFloat = 128
    @State private var searchBarHeight: CGFloat = 62
    @State private var locateButtonHeight: CGFloat = 52
    @State private var topChromeFrame = CGRect.null
    @State private var bottomChromeTop: CGFloat?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// Tests hand in a model with the state they want to see.
    init(model: ScooterMapModel = ScooterMapModel()) {
        _model = State(initialValue: model)
    }

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
                    bottomChromeTop: bottomChromeTop,
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
                        .onGeometryChange(for: CGFloat.self) { geometry in
                            geometry.size.height
                        } action: { height in
                            if !searchIsExpanded { searchBarHeight = height }
                        }

                        if !searchIsExpanded, hasTopNotices {
                            // With large text a banner and a card can be taller than
                            // the room above the locate button; then they scroll.
                            HeightLimit(maximum: topNoticesHeightLimit(in: proxy)) {
                                ViewThatFits(in: .vertical) {
                                    VStack(spacing: 8) { topNotices }
                                    ScrollView(.vertical) {
                                        VStack(spacing: 8) { topNotices }
                                            .padding(.horizontal, 12)
                                    }
                                    // Room for the shadows at the sides.
                                    .padding(.horizontal, -12)
                                }
                            }
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
                            .onGeometryChange(for: CGRect.self) { geometry in
                                geometry.frame(in: .global)
                            } action: { frame in
                                locateButtonHeight = frame.height
                                // The map centres a scooter in what this button and the dock leave visible.
                                bottomChromeTop = frame.minY
                            }
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
                                // With large text a notice under the search bar needs room too.
                                - (dynamicTypeSize.isAccessibilitySize && hasTopNotices ? 120 : 0)
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
            ScooterSettingsSheet(model: model)
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

    private var hasTopNotices: Bool {
        firstLoadFailure != nil || model.locationIssue != nil
    }

    /// The room between the search bar and the locate button above the dock.
    private func topNoticesHeightLimit(in proxy: GeometryProxy) -> CGFloat {
        let dockAndGap = dockHeight + max(proxy.safeAreaInsets.bottom, 8) + 10
        let room = proxy.size.height - 8 - searchBarHeight - 8 - 8 - locateButtonHeight - dockAndGap
        // Never less than a banner, or the title of a card.
        return max(64, room)
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
