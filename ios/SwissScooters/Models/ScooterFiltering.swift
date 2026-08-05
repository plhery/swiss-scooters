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
        selectedProvider: ScooterProvider?
    ) -> [Scooter] {
        vehicles.filter { scooter in
            passesBattery(scooter, minimumBattery: minimumBattery) &&
                (selectedProvider == nil || scooter.providerInfo == selectedProvider)
        }
    }

    static func visibleSummary(
        for vehicles: [Scooter],
        viewport: GeoBounds,
        minimumBattery: Double,
        selectedProvider: ScooterProvider?
    ) -> VisibleScooterSummary {
        var visibleCount = 0
        var providerCounts: [ScooterProvider: Int] = [:]
        providerCounts.reserveCapacity(ScooterProvider.allCases.count)

        for scooter in vehicles {
            guard viewport.contains(latitude: scooter.latitude, longitude: scooter.longitude),
                  passesBattery(scooter, minimumBattery: minimumBattery) else { continue }

            if let provider = scooter.providerInfo {
                providerCounts[provider, default: 0] += 1
            }
            if selectedProvider == nil || scooter.providerInfo == selectedProvider {
                visibleCount += 1
            }
        }

        return VisibleScooterSummary(count: visibleCount, providerCounts: providerCounts)
    }
}
