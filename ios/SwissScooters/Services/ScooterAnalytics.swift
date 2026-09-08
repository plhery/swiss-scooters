import Foundation
import UIKit

/// First-party Umami events. No advertising IDs, coordinates, addresses, or vehicle IDs.
@MainActor
final class ScooterAnalytics {
    static let shared = ScooterAnalytics()
    static let disabledKey = "analytics-disabled"
    static let website = "6e60b4ab-b4ee-4785-9699-a7f32127b358"
    static let endpoint = URL(string: "https://u.plhery.com/api/send")!
    private var cache: String?
    private var disabledByServer = false
    private var pending = 0
    private var previous: Task<Void, Never>?
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        return URLSession(configuration: configuration)
    }()

    private var enabled: Bool {
        guard !UserDefaults.standard.bool(forKey: Self.disabledKey), !disabledByServer,
              ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil,
              ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] != "1" else { return false }
        #if targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-analytics-smoke-test")
        #else
        return true
        #endif
    }

    static func payload(_ name: String?, provider: String? = nil, value: Int? = nil,
                        result: String? = nil, target: String? = nil, screen: String = "/") -> [String: Any] {
        var payload: [String: Any] = [
            "website": website, "hostname": "scooters.plhery.com",
            "url": ["/", "/filters", "/settings"].contains(screen) ? screen : "/",
            "title": "Scooters", "referrer": "", "tag": "ios",
            "language": Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        ]
        if let name {
            var data: [String: Any] = ["platform": "ios"]
            for (key, entry) in [("provider", provider), ("result", result), ("target", target)] {
                if let entry, entry.range(of: "^[a-zA-Z0-9_-]{1,40}$", options: .regularExpression) != nil {
                    data[key] = entry
                }
            }
            if let value { data["value"] = value }
            payload["name"] = name
            payload["data"] = data
        }
        return payload
    }

    func track(_ name: String? = nil, provider: String? = nil, value: Int? = nil,
               result: String? = nil, target: String? = nil, screen: String = "/") {
        guard enabled, pending < 30 else { return }
        let payload = Self.payload(name, provider: provider, value: value, result: result, target: target, screen: screen)
        guard let body = try? JSONSerialization.data(withJSONObject: ["type": "event", "payload": payload]) else { return }
        pending += 1
        let predecessor = previous
        previous = Task { [self] in
            await predecessor?.value
            defer { pending -= 1 }
            guard enabled else { return }
            var request = URLRequest(url: Self.endpoint)
            request.httpMethod = "POST"
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let os = UIDevice.current.systemVersion.replacingOccurrences(of: ".", with: "_")
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
            request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS \(os) like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Scooters/\(version)", forHTTPHeaderField: "User-Agent")
            if let cache { request.setValue(cache, forHTTPHeaderField: "x-umami-cache") }
            do {
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
                      let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
                cache = result["cache"] as? String
                disabledByServer = result["disabled"] as? Bool == true
            } catch { /* Best effort: never block a rider or retain an offline history. */ }
        }
    }
}
