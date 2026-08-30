import SwiftUI

@main
struct SwissScootersApp: App {
    var body: some Scene {
        WindowGroup {
            ScooterMapScreen()
                .tint(.blue)
        }
    }
}
