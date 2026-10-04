import Foundation
import Observation
import SwiftUI
import UIKit

/// The search bar at the top of the map. Collapsed, it says what the map is
/// based on: nothing yet, your location, a searched place, or a location on
/// its way. Tapped, it opens into the search panel.
struct ScooterSearchIsland: View {
    let state: ScooterSearchBarState
    @Binding var isSearching: Bool
    let hasActiveFilters: Bool
    /// Places chosen during this session, newest first.
    var recentPlaces: [MapDestination] = []
    /// The covered cities nearest to the map centre.
    var nearbyCities: [ScooterCity] = []
    /// Where the open panel has to end when no keyboard is up, in global coordinates.
    var bottomLimit: CGFloat = .infinity
    let onSelect: (MapDestination) -> Void
    var onChooseCity: (ScooterCity) -> Void = { _ in }
    let onClear: () -> Void
    let onUseCurrentLocation: () -> Void
    let onShowFilters: () -> Void
    let onShowSettings: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 0) {
            if isSearching {
                ScooterSearchPanel(
                    recentPlaces: recentPlaces,
                    nearbyCities: nearbyCities,
                    bottomLimit: bottomLimit,
                    onSelect: { destination in
                        onSelect(destination)
                        setSearching(false)
                    },
                    onChooseCity: { city in
                        onChooseCity(city)
                        setSearching(false)
                    },
                    onUseCurrentLocation: {
                        onUseCurrentLocation()
                        setSearching(false)
                    },
                    onCancel: { setSearching(false) }
                )
            } else {
                collapsedBar
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, isSearching ? 10 : 6)
        .frame(maxWidth: 560)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.clear)
                .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .onTapGesture { }
                .accessibilityHidden(true)
        }
        .chromeGlass(
            in: RoundedRectangle(cornerRadius: 24, style: .continuous),
            isInteractive: !isSearching
        )
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        .animation(
            reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.88),
            value: isSearching
        )
    }

    private var collapsedBar: some View {
        HStack(spacing: 2) {
            Button {
                setSearching(true)
            } label: {
                HStack(spacing: 10) {
                    barIndicator
                        .accessibilityHidden(true)
                    barText
                    Spacer(minLength: 4)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(
                maxWidth: .infinity,
                minHeight: usesAccessibilityLayout ? 60 : 50
            )
            .accessibilityLabel(state.accessibilityLabel)

            if case .place = state {
                Button {
                    ScooterAnalytics.shared.track("search_clear")
                    onClear()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Clear place"))
            }

            Button(action: onShowFilters) {
                Image(systemName: hasActiveFilters
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle")
                    .font(.system(size: 20, weight: .semibold))
                    // Idle, it is as dark as the Settings icon beside it; the
                    // layered blue is kept for filters that are active.
                    .symbolRenderingMode(hasActiveFilters ? .hierarchical : .monochrome)
                    .foregroundStyle(hasActiveFilters ? ScooterPalette.actionText : Color.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                hasActiveFilters
                    ? String(localized: "Filters, active")
                    : String(localized: "Filters")
            )

            Button(action: onShowSettings) {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Settings"))
        }
    }

    /// What leads the bar: a search icon, a tile for your location or the
    /// place, or a spinner while locating.
    @ViewBuilder
    private var barIndicator: some View {
        switch state {
        case .empty:
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(ScooterPalette.secondaryText)
                .frame(width: 34, height: 34)
        case .nearYou:
            SearchSymbolTile(systemImage: "location.fill")
        case .place:
            SearchSymbolTile(systemImage: "mappin.and.ellipse")
        case .locating:
            ProgressView()
                .controlSize(.small)
                .frame(width: 34, height: 34)
        }
    }

    private var barText: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(state.title)
                // With nothing chosen the bar reads like an empty search field.
                .font(.subheadline.weight(state == .empty ? .medium : .semibold))
                .foregroundStyle(state == .empty ? ScooterPalette.secondaryText : Color.primary)
                .lineLimit(usesAccessibilityLayout ? 2 : 1)
                // A long place name is cut short. The bar's own sentences shrink
                // further instead: "Recherche de votre position…" on a narrow phone.
                .minimumScaleFactor(showsPlace ? 0.9 : 0.8)
            if let subtitle = state.subtitle, !usesAccessibilityLayout {
                // Beside the clear button the line is too long for narrow
                // phones and for Italian, so it may take a second line.
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(ScooterPalette.secondaryText)
                    .lineLimit(2)
            }
        }
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .layoutPriority(1)
    }

    private var showsPlace: Bool {
        if case .place = state { return true }
        return false
    }

    private var usesAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize
    }

    private func setSearching(_ searching: Bool) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.88)) {
            isSearching = searching
        }
    }
}

/// The open search: the field first, with Cancel beside it. Under it, ways to
/// start while nothing is typed, and the places found from two characters on.
struct ScooterSearchPanel: View {
    @State private var searchModel: SwissAddressSearchModel
    @State private var contentTop: CGFloat = 0
    @State private var keyboardTop = CGFloat.infinity
    @FocusState private var fieldIsFocused: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let recentPlaces: [MapDestination]
    private let nearbyCities: [ScooterCity]
    private let bottomLimit: CGFloat
    private let autofocus: Bool
    private let onSelect: (MapDestination) -> Void
    private let onChooseCity: (ScooterCity) -> Void
    private let onUseCurrentLocation: () -> Void
    private let onCancel: () -> Void

    init(
        searchModel: SwissAddressSearchModel = SwissAddressSearchModel(),
        recentPlaces: [MapDestination] = [],
        nearbyCities: [ScooterCity] = [],
        bottomLimit: CGFloat = .infinity,
        autofocus: Bool = true,
        onSelect: @escaping (MapDestination) -> Void,
        onChooseCity: @escaping (ScooterCity) -> Void = { _ in },
        onUseCurrentLocation: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        _searchModel = State(initialValue: searchModel)
        self.recentPlaces = recentPlaces
        self.nearbyCities = nearbyCities
        self.bottomLimit = bottomLimit
        self.autofocus = autofocus
        self.onSelect = onSelect
        self.onChooseCity = onChooseCity
        self.onUseCurrentLocation = onUseCurrentLocation
        self.onCancel = onCancel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if dynamicTypeSize.isAccessibilitySize {
                // Large text leaves no room for the field beside Cancel.
                VStack(alignment: .trailing, spacing: 0) {
                    field
                    cancelButton
                }
            } else {
                HStack(spacing: 6) {
                    field
                    cancelButton
                }
            }

            // What does not fit above the keyboard scrolls.
            HeightLimit(maximum: maximumContentHeight) {
                ViewThatFits(in: .vertical) {
                    content
                    ScrollView(.vertical) {
                        content
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) { geometry in
                geometry.frame(in: .global).minY
            } action: { top in
                contentTop = top
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
        ) { notification in
            guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
                return
            }
            keyboardTop = frame.minY
        }
        .onDisappear {
            searchModel.cancel()
        }
        .task {
            guard autofocus else { return }
            await Task.yield()
            fieldIsFocused = true
        }
        .onChange(of: searchModel.status) { _, status in
            announce(status)
        }
    }

    private var cancelButton: some View {
        Button(action: onCancel) {
            Text("Cancel")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ScooterPalette.actionText)
                .padding(.horizontal, 6)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
    }

    private var field: some View {
        @Bindable var searchModel = searchModel

        return HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            TextField("City or address", text: $searchModel.query)
                .focused($fieldIsFocused)
                .textContentType(.fullStreetAddress)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit(chooseFirstResult)

            if !searchModel.query.isEmpty {
                Button {
                    searchModel.clear()
                    fieldIsFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Clear search"))
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, searchModel.query.isEmpty ? 12 : 0)
        .frame(minHeight: 46)
        .background(
            .quaternary.opacity(0.55),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    @ViewBuilder
    private var content: some View {
        switch searchModel.status {
        case .idle:
            suggestions
        case .searching:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
                Text("Searching…")
            }
            .searchStatusStyle()
        case let .results(results):
            resultRows(results)
        case .noResults:
            Text("No places found. Outside Switzerland, search by city.")
                .searchStatusStyle()
        case .failed:
            VStack(alignment: .leading, spacing: 0) {
                Text("Search isn’t available right now.")
                    .searchStatusStyle()

                Button(action: searchModel.retry) {
                    Text("Try again")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ScooterPalette.actionText)
                        .padding(.horizontal, 6)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Nothing typed yet: your location, the places of this session and the
    /// covered cities nearest to the map.
    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onUseCurrentLocation) {
                HStack(spacing: 11) {
                    SearchSymbolTile(systemImage: "location.fill")
                        .accessibilityHidden(true)
                    Text("Use my location")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ScooterPalette.actionText)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if !recentPlaces.isEmpty {
                sectionHeader("Recent")

                ForEach(recentPlaces) { place in
                    Button {
                        onSelect(place)
                    } label: {
                        SearchPlaceRow(
                            title: place.title,
                            subtitle: place.subtitle,
                            systemImage: "clock.arrow.circlepath",
                            isAccented: false,
                            showsNoData: !place.isCovered
                        )
                    }
                    .buttonStyle(.plain)

                    if place.id != recentPlaces.last?.id {
                        rowDivider
                    }
                }
            }

            if !nearbyCities.isEmpty {
                sectionHeader("Cities with scooters")

                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(nearbyCities) { city in
                        Button {
                            onChooseCity(city)
                        } label: {
                            Text(city.name)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14)
                                .frame(minHeight: 44)
                                .background(Color.primary.opacity(0.055), in: Capsule())
                                .overlay {
                                    Capsule().stroke(Color.secondary.opacity(0.16), lineWidth: 1)
                                }
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
            }
        }
    }

    private func resultRows(_ results: [AddressSearchResult]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(results) { result in
                // Return chooses the first place, so it is shown as chosen.
                let isFirst = result.id == results.first?.id

                Button {
                    choose(result)
                } label: {
                    SearchPlaceRow(
                        title: result.title,
                        subtitle: result.subtitle,
                        isAccented: result.isCovered,
                        showsNoData: !result.isCovered
                    )
                    .background(
                        isFirst ? ScooterPalette.actionText.opacity(0.08) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isFirst ? .isSelected : [])

                if result.id != results.last?.id {
                    rowDivider
                }
            }
        }
    }

    private func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(ScooterPalette.secondaryText)
            .padding(.horizontal, 6)
            .padding(.top, 12)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }

    private var rowDivider: some View {
        Divider()
            .padding(.leading, 51)
    }

    /// The panel ends above the keyboard, or at the bottom of the screen without one.
    private var maximumContentHeight: CGFloat {
        let limit = min(keyboardTop, bottomLimit)
        guard limit.isFinite else { return .infinity }
        return max(120, limit - contentTop - 20)
    }

    private func announce(_ status: SwissAddressSearchStatus) {
        guard UIAccessibility.isVoiceOverRunning else { return }

        let message: String
        switch status {
        case .idle, .searching:
            return
        case let .results(results) where results.count == 1:
            message = String(localized: "One address suggestion")
        case let .results(results):
            message = String(
                format: String(localized: "%lld address suggestions"),
                Int64(results.count)
            )
        case .noResults:
            message = String(localized: "No places found. Outside Switzerland, search by city.")
        case .failed:
            message = String(localized: "Search isn’t available right now.")
        }

        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func chooseFirstResult() {
        guard let result = searchModel.firstResult else { return }
        choose(result)
    }

    private func choose(_ result: AddressSearchResult) {
        let destination = searchModel.select(result)
        fieldIsFocused = false
        onSelect(destination)
    }
}

private extension View {
    /// "Searching…" and the sentences that stand in for results.
    func searchStatusStyle() -> some View {
        font(.subheadline)
            .foregroundStyle(ScooterPalette.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }
}

/// A place in the search panel: a result, or a place chosen earlier.
struct SearchPlaceRow: View {
    let title: String
    /// May be empty; the second line is left out then.
    let subtitle: String
    var systemImage = "mappin.and.ellipse"
    /// Blue for a place with scooter data, grey for one without and for recent places.
    var isAccented = true
    /// The neutral "No data" tag of a place no operator serves.
    var showsNoData = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 11) {
            SearchSymbolTile(systemImage: systemImage, isAccented: isAccented)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(usesAccessibilityLayout ? nil : 2)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(ScooterPalette.secondaryText)
                        .lineLimit(usesAccessibilityLayout ? nil : 2)
                }
                // Beside large text there is no room left for the tag.
                if showsNoData, usesAccessibilityLayout {
                    noDataTag
                }
            }
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)

            if showsNoData, !usesAccessibilityLayout {
                noDataTag
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var noDataTag: some View {
        Text("No data")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(ScooterPalette.secondaryText)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.primary.opacity(0.06), in: Capsule())
    }

    private var usesAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize
    }
}

/// The small rounded tile in front of the search bar's text and of a place row.
struct SearchSymbolTile: View {
    let systemImage: String
    /// Blue for your location and places with scooter data; grey otherwise.
    var isAccented = true

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(isAccented ? ScooterPalette.actionText : Color.secondary)
            .frame(width: 34, height: 34)
            .background(
                isAccented ? ScooterPalette.actionText.opacity(0.12) : Color.primary.opacity(0.06),
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
    }
}

/// What the open search shows under the field.
enum SwissAddressSearchStatus: Equatable, Sendable {
    /// Fewer than two characters typed: the panel shows its suggestions.
    case idle
    case searching
    /// Never empty. Return chooses the first place.
    case results([AddressSearchResult])
    case noResults
    /// The search could not be reached; "Try again" repeats it.
    case failed
}

@MainActor
@Observable
final class SwissAddressSearchModel {
    var query = "" {
        didSet { scheduleSearch(after: debounce) }
    }
    private(set) var status = SwissAddressSearchStatus.idle

    @ObservationIgnored private let api: any AddressSearchAPIClient
    @ObservationIgnored private let debounce: Duration
    /// Sent with every search, so country names come back in the language on screen.
    @ObservationIgnored private let language: String
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    init(
        api: any AddressSearchAPIClient = AddressSearchAPI(),
        debounce: Duration = .milliseconds(350),
        language: String = SwissAddressSearchModel.searchLanguage()
    ) {
        self.api = api
        self.debounce = debounce
        self.language = language
    }

    /// The place Return chooses.
    var firstResult: AddressSearchResult? {
        guard case let .results(results) = status else { return nil }
        return results.first
    }

    /// Empties the field, which brings the suggestions back.
    func clear() {
        query = ""
    }

    func cancel() {
        searchTask?.cancel()
        searchTask = nil
        if status == .searching { status = .idle }
    }

    /// "Try again" after a failed search: the same text, searched at once.
    func retry() {
        scheduleSearch(after: .zero)
    }

    func select(_ result: AddressSearchResult) -> MapDestination {
        cancel()
        return result.destination
    }

    private func scheduleSearch(after delay: Duration) {
        searchTask?.cancel()
        searchTask = nil
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)

        guard trimmedQuery.count >= 2 else {
            status = .idle
            return
        }

        status = .searching
        searchTask = Task { [weak self] in
            do {
                try await Task.sleep(for: delay)
                guard let self else { return }
                let results = try await api.search(query: trimmedQuery, language: language)
                try Task.checkCancellation()
                guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmedQuery else {
                    return
                }
                ScooterAnalytics.shared.track("search_results", value: results.count)
                status = results.isEmpty ? .noResults : .results(results)
                searchTask = nil
            } catch is CancellationError {
                return
            } catch {
                guard let self, !Task.isCancelled else { return }
                ScooterAnalytics.shared.track("search_error")
                status = .failed
                searchTask = nil
            }
        }
    }

    /// The language the app is shown in, as the address search takes it: "en",
    /// "de", "fr" or "it". `localizations` is the bundle's choice among the
    /// languages the app is translated into, which is where its strings come from.
    static func searchLanguage(
        localizations: [String] = Bundle.main.preferredLocalizations
    ) -> String {
        let language = localizations.first.flatMap { Locale(identifier: $0).language.languageCode?.identifier }
        return language.flatMap { ["de", "fr", "it"].contains($0) ? $0 : nil } ?? "en"
    }
}
