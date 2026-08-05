import Foundation
import Observation
import SwiftUI

struct SwissAddressSearch: View {
    @State private var searchModel = SwissAddressSearchModel()
    @FocusState private var fieldIsFocused: Bool
    let onSelect: (MapDestination) -> Void
    let onClear: () -> Void

    var body: some View {
        @Bindable var searchModel = searchModel

        VStack(alignment: .leading, spacing: 9) {
            Label("Address search", systemImage: "magnifyingglass")
                .font(.subheadline.weight(.medium))

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
                        .accessibilityLabel(String(localized: "Searching addresses…"))
                } else if !searchModel.query.isEmpty {
                    Button {
                        searchModel.clear()
                        onClear()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(localized: "Clear address search"))
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(
                .quaternary.opacity(0.55),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )

            if !searchModel.suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(searchModel.suggestions) { suggestion in
                        Button {
                            select(suggestion)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "mappin.and.ellipse")
                                    .foregroundStyle(.blue)
                                    .frame(width: 22)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(suggestion.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .lineLimit(1)
                                    if !suggestion.subtitle.isEmpty {
                                        Text(suggestion.subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }

                                Spacer(minLength: 0)
                            }
                            .contentShape(Rectangle())
                            .padding(.horizontal, 11)
                            .frame(minHeight: 48)
                        }
                        .buttonStyle(.plain)

                        if suggestion.id != searchModel.suggestions.last?.id {
                            Divider()
                                .padding(.leading, 43)
                        }
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

            Link(
                "Address data © swisstopo",
                destination: URL(string: "https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api")!
            )
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
        .onChange(of: searchModel.query) { _, _ in
            onClear()
        }
        .onDisappear {
            searchModel.cancel()
        }
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
