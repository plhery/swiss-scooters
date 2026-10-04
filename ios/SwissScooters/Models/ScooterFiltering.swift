import Foundation

struct VisibleScooterSummary: Equatable {
    let count: Int
    let providerCounts: [ScooterProvider: Int]
    /// Scooters in the viewport before the battery and provider filters.
    let unfilteredCount: Int
}

enum ScooterFiltering {
    static func passesBattery(_ scooter: Scooter, minimumBattery: Double) -> Bool {
        minimumBattery == 0 || (scooter.battery.map(Double.init) ?? -1) >= minimumBattery
    }

    static func mapScooters(
        from vehicles: [Scooter],
        minimumBattery: Double,
        enabledProviders: Set<ScooterProvider>
    ) -> [Scooter] {
        let allProvidersEnabled = enabledProviders == Set(ScooterProvider.allCases)
        return vehicles.filter { scooter in
            passesBattery(scooter, minimumBattery: minimumBattery) &&
                (allProvidersEnabled || scooter.providerInfo.map(enabledProviders.contains) == true)
        }
    }

    static func visibleSummary(
        for vehicles: [Scooter],
        viewport: GeoBounds,
        minimumBattery: Double,
        enabledProviders: Set<ScooterProvider>
    ) -> VisibleScooterSummary {
        var visibleCount = 0
        var unfilteredCount = 0
        var providerCounts: [ScooterProvider: Int] = [:]
        providerCounts.reserveCapacity(ScooterProvider.allCases.count)

        let allProvidersEnabled = enabledProviders == Set(ScooterProvider.allCases)
        for scooter in vehicles {
            guard viewport.contains(latitude: scooter.latitude, longitude: scooter.longitude) else { continue }
            unfilteredCount += 1
            guard passesBattery(scooter, minimumBattery: minimumBattery) else { continue }

            if let provider = scooter.providerInfo {
                providerCounts[provider, default: 0] += 1
            }
            if allProvidersEnabled || scooter.providerInfo.map(enabledProviders.contains) == true {
                visibleCount += 1
            }
        }

        return VisibleScooterSummary(
            count: visibleCount,
            providerCounts: providerCounts,
            unfilteredCount: unfilteredCount
        )
    }

    /// The filter sheet's primary button: "Show 1 scooter", "Show 2'000 scooters".
    static func showResultsTitle(count: Int) -> String {
        if count == 1 { return String(localized: "Show 1 scooter") }
        return String(format: String(localized: "Show %lld scooters"), locale: .current, Int64(count))
    }
}

enum ScooterBatteryFilter {
    /// The only minimums offered: Any, 30%+, 60%+ and 80%+.
    static let presets = [0, 30, 60, 80]

    /// Stored values that are not a preset snap down (45 → 30, 95 → 80).
    static func snapped(_ value: Int) -> Int {
        presets.last { $0 <= value } ?? 0
    }

    static func label(for preset: Int) -> String {
        preset == 0 ? String(localized: "Any") : "\(preset)%+"
    }
}

/// One provider in the dock chips or in the filter sheet's provider list.
struct ScooterProviderEntry: Identifiable, Equatable, Sendable {
    let provider: ScooterProvider
    /// Scooters in view that pass the battery filter, whether or not the provider is shown.
    let count: Int
    /// Included by the provider filter: the check in the filter sheet.
    let isEnabled: Bool
    /// Highlighted in the dock, which only happens while a provider filter is active.
    let isSelected: Bool
    /// Not sharing data and none in view: dashed and never selected, with a
    /// warning icon in the dock and "Not sharing data right now" in the filter sheet.
    let isDown: Bool

    var id: String { provider.id }

    /// "Bird: not sharing data right now", the accessibility label of a down chip.
    var downLabel: String {
        String(format: String(localized: "%@: not sharing data right now"), provider.name)
    }
}

/// Why the filters leave nothing on the map, for the "hidden by your filters" card.
struct ScooterFilterSummary: Equatable, Sendable {
    /// Scooters here before filtering; nil when the response cannot tell,
    /// because the server already filtered by battery or cut the list short.
    let hiddenCount: Int?
    /// The providers the map is limited to; empty when every provider is shown.
    let providers: [ScooterProvider]
    /// The minimum battery in percent; nil for Any.
    let minimumBattery: Int?

    var title: String {
        guard let hiddenCount, hiddenCount > 0 else {
            return String(localized: "No scooters match your filters here")
        }
        if hiddenCount == 1 { return String(localized: "1 scooter hidden by your filters") }
        return String(
            format: String(localized: "%lld scooters hidden by your filters"),
            locale: .current,
            Int64(hiddenCount)
        )
    }

    /// "Lime only" and "battery 60% or more", whichever apply.
    var parts: [String] {
        var parts: [String] = []
        if !providers.isEmpty {
            parts.append(String(
                format: String(localized: "%@ only"),
                ListFormatter.localizedString(byJoining: providers.map(\.name))
            ))
        }
        if let minimumBattery {
            parts.append(String(
                format: String(localized: "battery %lld%% or more"),
                Int64(minimumBattery)
            ))
        }
        return parts
    }

    /// "Lime only · battery 60% or more"
    var body: String {
        let line = parts.joined(separator: " · ")
        // The battery part starts in lower case because it usually follows the providers.
        return line.prefix(1).localizedUppercase + line.dropFirst()
    }

    /// "Show all 26", or "Show all" when the count is unknown. The button resets the filters.
    var showAllTitle: String {
        guard let hiddenCount, hiddenCount > 0 else { return String(localized: "Show all") }
        return String(format: String(localized: "Show all %lld"), locale: .current, Int64(hiddenCount))
    }
}
