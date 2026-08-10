import Foundation

struct VisibleScooterSummary: Equatable {
    let count: Int
    let providerCounts: [ScooterProvider: Int]
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
        var providerCounts: [ScooterProvider: Int] = [:]
        providerCounts.reserveCapacity(ScooterProvider.allCases.count)

        let allProvidersEnabled = enabledProviders == Set(ScooterProvider.allCases)
        for scooter in vehicles {
            guard viewport.contains(latitude: scooter.latitude, longitude: scooter.longitude),
                  passesBattery(scooter, minimumBattery: minimumBattery) else { continue }

            if let provider = scooter.providerInfo {
                providerCounts[provider, default: 0] += 1
            }
            if allProvidersEnabled || scooter.providerInfo.map(enabledProviders.contains) == true {
                visibleCount += 1
            }
        }

        return VisibleScooterSummary(count: visibleCount, providerCounts: providerCounts)
    }
}
