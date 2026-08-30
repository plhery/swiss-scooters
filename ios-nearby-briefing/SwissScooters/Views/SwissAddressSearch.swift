import Foundation
import Observation
import SwiftUI
import UIKit

struct SwissAddressSearch: View {
    @State private var searchModel = SwissAddressSearchModel()
    @FocusState private var fieldIsFocused: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let onSelect: (MapDestination) -> Void
    let onClear: () -> Void
    let compact: Bool
    let autofocus: Bool

    init(
        compact: Bool = false,
        autofocus: Bool = false,
        onSelect: @escaping (MapDestination) -> Void,
        onClear: @escaping () -> Void
    ) {
        self.compact = compact
        self.autofocus = autofocus
        self.onSelect = onSelect
        self.onClear = onClear
    }

    var body: some View {
        @Bindable var searchModel = searchModel

        VStack(alignment: .leading, spacing: compact ? 6 : 9) {
            if !compact {
                Label("Address search", systemImage: "magnifyingglass")
                    .font(.subheadline.weight(.medium))
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)

                TextField("Search a Swiss address", text: $searchModel.query)
                    .focused($fieldIsFocused)
                    .textContentType(.fullStreetAddress)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.search)
                    .onSubmit(selectFirstSuggestion)

                if searchModel.isSearching {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 44, height: 44)
                        .accessibilityLabel(String(localized: "Searching addresses…"))
                } else if !searchModel.query.isEmpty {
                    Button {
                        searchModel.clear()
                        onClear()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(localized: "Clear address search"))
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(minHeight: 44)
            .background(
                .quaternary.opacity(0.55),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )

            if !searchModel.suggestions.isEmpty {
                Group {
                    if usesAccessibilityLayout {
                        ScrollView {
                            suggestionRows
                        }
                        .frame(maxHeight: 300)
                        .scrollBounceBehavior(.basedOnSize)
                    } else {
                        suggestionRows
                    }
                }
                .background(
                    .quaternary.opacity(0.42),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            } else if let statusMessage = searchModel.statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 2)
            }
        }
        .onDisappear {
            searchModel.cancel()
        }
        .task {
            guard autofocus else { return }
            await Task.yield()
            fieldIsFocused = true
        }
        .onChange(of: searchOutcomeSignature) { _, _ in
            announceSearchOutcome()
        }
    }

    private var suggestionRows: some View {
        VStack(spacing: 0) {
            ForEach(searchModel.suggestions) { suggestion in
                Button {
                    select(suggestion)
                } label: {
                    HStack(
                        alignment: usesAccessibilityLayout ? .top : .center,
                        spacing: 10
                    ) {
                        Image(systemName: "mappin.and.ellipse")
                            .foregroundStyle(.blue)
                            .frame(width: 22)
                            .padding(.top, usesAccessibilityLayout ? 3 : 0)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(suggestion.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(usesAccessibilityLayout ? nil : 1)
                                .fixedSize(horizontal: false, vertical: usesAccessibilityLayout)
                            if !suggestion.subtitle.isEmpty {
                                Text(suggestion.subtitle)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(usesAccessibilityLayout ? nil : 1)
                                    .fixedSize(horizontal: false, vertical: usesAccessibilityLayout)
                            }
                        }

                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                    .padding(.horizontal, 11)
                    .padding(.vertical, usesAccessibilityLayout ? 8 : 0)
                    .frame(minHeight: 48)
                }
                .buttonStyle(.plain)

                if suggestion.id != searchModel.suggestions.last?.id {
                    Divider()
                        .padding(.leading, 43)
                }
            }
        }
    }

    private var usesAccessibilityLayout: Bool {
        dynamicTypeSize.isAccessibilitySize
    }

    private var searchOutcomeSignature: String {
        let suggestionIDs = searchModel.suggestions.map(\.id).joined(separator: "|")
        return "\(searchModel.isSearching)|\(searchModel.statusMessage ?? "")|\(suggestionIDs)"
    }

    private func announceSearchOutcome() {
        guard UIAccessibility.isVoiceOverRunning,
              !searchModel.isSearching else { return }

        let message: String
        if let statusMessage = searchModel.statusMessage {
            message = statusMessage
        } else if searchModel.suggestions.count == 1 {
            message = String(localized: "One address suggestion")
        } else if !searchModel.suggestions.isEmpty {
            message = String(
                format: String(localized: "%lld address suggestions"),
                Int64(searchModel.suggestions.count)
            )
        } else {
            return
        }

        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func selectFirstSuggestion() {
        guard let suggestion = searchModel.suggestions.first else { return }
        select(suggestion)
    }

    private func select(_ suggestion: SwissAddressSuggestion) {
        let destination = searchModel.select(suggestion)
        fieldIsFocused = false
        onSelect(destination)
    }
}

struct OriginSearchIsland: View {
    let title: String
    @Binding var isSearching: Bool
    let hasActiveFilters: Bool
    let onSelect: (MapDestination) -> Void
    let onClear: () -> Void
    let onUseCurrentLocation: () -> Void
    let onShowFilters: () -> Void
    let onShowSettings: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: isSearching ? 10 : 0) {
            if isSearching {
                HStack(
                    alignment: usesAccessibilityLayout ? .firstTextBaseline : .center,
                    spacing: 10
                ) {
                    if !usesAccessibilityLayout {
                        Image(systemName: "location.magnifyingglass")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.blue)
                            .frame(width: 30, height: 30)
                            .accessibilityHidden(true)
                    }

                    Text("Search nearby")
                        .font(.headline)
                        .lineLimit(usesAccessibilityLayout ? 2 : 1)
                        .fixedSize(horizontal: false, vertical: usesAccessibilityLayout)

                    Spacer(minLength: 8)

                    Button("Done") {
                        setSearching(false)
                    }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                    .frame(minHeight: 44)
                    .fixedSize(horizontal: true, vertical: false)
                }

                SwissAddressSearch(
                    compact: true,
                    autofocus: true,
                    onSelect: { destination in
                        onSelect(destination)
                        setSearching(false)
                    },
                    onClear: onClear
                )

                Group {
                    if usesAccessibilityLayout {
                        VStack(spacing: 8) {
                            expandedActions
                        }
                    } else {
                        HStack(spacing: 8) {
                            expandedActions
                        }
                    }
                }
                .font(.subheadline.weight(.semibold))
                .controlSize(.large)
            } else {
                HStack(spacing: 2) {
                    Button {
                        setSearching(true)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "location.circle.fill")
                                .font(.system(size: 25, weight: .semibold))
                                .symbolRenderingMode(.hierarchical)
                                .foregroundStyle(.blue)
                                .accessibilityHidden(true)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(usesAccessibilityLayout ? 2 : 1)
                                    .fixedSize(
                                        horizontal: false,
                                        vertical: usesAccessibilityLayout
                                    )
                                if !usesAccessibilityLayout {
                                    Text("Search or change origin")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .layoutPriority(1)

                            Spacer(minLength: 4)

                            if !usesAccessibilityLayout {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: usesAccessibilityLayout ? 60 : 50
                    )
                    .accessibilityLabel(
                        String(
                            format: String(localized: "Origin: %@. Search or change origin."),
                            title
                        )
                    )

                    Button(action: onShowFilters) {
                        Image(systemName: hasActiveFilters
                            ? "line.3.horizontal.decrease.circle.fill"
                            : "line.3.horizontal.decrease.circle")
                            .font(.system(size: 20, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(hasActiveFilters ? .blue : .primary)
                            .frame(width: 44, height: 44)
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
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(localized: "More options"))
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, isSearching ? 10 : 6)
        .frame(maxWidth: 560)
        .glassEffect(
            .regular.interactive(!isSearching),
            in: RoundedRectangle(cornerRadius: 24, style: .continuous)
        )
        .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        .animation(
            reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.88),
            value: isSearching
        )
    }

    @ViewBuilder
    private var expandedActions: some View {
        Button {
            onUseCurrentLocation()
            setSearching(false)
        } label: {
            Label("Use current location", systemImage: "location.fill")
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)

        Button(action: onShowFilters) {
            Label("Filters", systemImage: "line.3.horizontal.decrease")
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
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

struct SwissAddressSuggestion: Identifiable {
    let result: AddressSearchResult

    var id: String { result.id }

    var title: String {
        result.displayName
            .split(separator: ",", maxSplits: 2)
            .prefix(2)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: ", ")
    }

    var subtitle: String {
        let components = result.displayName.split(separator: ",", maxSplits: 2)
        guard components.count == 3 else { return "" }
        return components[2].trimmingCharacters(in: .whitespaces)
    }
}

@MainActor
@Observable
final class SwissAddressSearchModel {
    var query = "" {
        didSet { scheduleSearch() }
    }
    private(set) var suggestions: [SwissAddressSuggestion] = []
    private(set) var isSearching = false
    private(set) var statusMessage: String?

    @ObservationIgnored private let api: any AddressSearchAPIClient
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var ignoresQueryChanges = false

    init(api: any AddressSearchAPIClient = AddressSearchAPI()) {
        self.api = api
    }

    func clear() {
        cancel()
        ignoresQueryChanges = true
        query = ""
        ignoresQueryChanges = false
        suggestions = []
        isSearching = false
        statusMessage = nil
    }

    func cancel() {
        searchTask?.cancel()
        searchTask = nil
        isSearching = false
    }

    func select(_ suggestion: SwissAddressSuggestion) -> MapDestination {
        cancel()
        ignoresQueryChanges = true
        query = suggestion.result.displayName
        ignoresQueryChanges = false
        suggestions = []
        isSearching = false
        statusMessage = nil
        return MapDestination(
            title: suggestion.title,
            point: GeoPoint(
                latitude: suggestion.result.latitude,
                longitude: suggestion.result.longitude
            )
        )
    }

    private func scheduleSearch() {
        guard !ignoresQueryChanges else { return }
        searchTask?.cancel()
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        suggestions = []
        statusMessage = nil

        guard trimmedQuery.count >= 2 else {
            isSearching = false
            searchTask = nil
            return
        }

        isSearching = true
        let language = Self.searchLanguage
        searchTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(350))
                guard let self else { return }
                let results = try await api.search(query: trimmedQuery, language: language)
                try Task.checkCancellation()
                guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmedQuery else {
                    return
                }
                suggestions = results.map(SwissAddressSuggestion.init)
                statusMessage = suggestions.isEmpty
                    ? String(localized: "No Swiss addresses found.")
                    : nil
                isSearching = false
                searchTask = nil
            } catch is CancellationError {
                return
            } catch {
                guard let self, !Task.isCancelled else { return }
                suggestions = []
                isSearching = false
                statusMessage = String(localized: "Address search is unavailable. Try again.")
                searchTask = nil
            }
        }
    }

    private static var searchLanguage: String {
        let language = Locale.current.language.languageCode?.identifier ?? "en"
        return ["de", "fr", "it", "en"].contains(language) ? language : "en"
    }
}
