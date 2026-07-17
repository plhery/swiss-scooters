import SwiftUI

@main
struct ZurichScootersApp: App {
    var body: some Scene {
        WindowGroup {
            ScooterMapScreen()
                .tint(.blue)
        }
    }
}
