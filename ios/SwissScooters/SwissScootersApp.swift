import SwiftUI

@main
struct SwissScootersApp: App {
    init() {
        // Earlier versions asked for scooters through the shared session, whose
        // cache kept the map bounds of each request on disk. Nothing uses it now.
        URLCache.shared.removeAllCachedResponses()
    }

    var body: some Scene {
        WindowGroup {
            ScooterMapScreen()
                .tint(.blue)
        }
    }
}
