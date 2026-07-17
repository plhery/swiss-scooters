import Foundation

actor ScooterAPI {
    static let productionBaseURL = URL(string: "https://zurich-scooter.plhery.com")!

    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = productionBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func scooters(origin: GeoPoint, bounds: GeoBounds) async throws -> ScooterResponse {
        var components = URLComponents(
            url: baseURL.appending(path: "api/scooters"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "lat", value: String(origin.latitude)),
            URLQueryItem(name: "lng", value: String(origin.longitude)),
            URLQueryItem(name: "south", value: String(format: "%.5f", bounds.south)),
            URLQueryItem(name: "west", value: String(format: "%.5f", bounds.west)),
            URLQueryItem(name: "north", value: String(format: "%.5f", bounds.north)),
            URLQueryItem(name: "east", value: String(format: "%.5f", bounds.east))
        ]

        guard let url = components.url else {
            throw ScooterAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.cachePolicy = .reloadRevalidatingCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200 ... 299).contains(httpResponse.statusCode) else {
            throw ScooterAPIError.badResponse
        }

        do {
            return try JSONDecoder().decode(ScooterResponse.self, from: data)
        } catch {
            throw ScooterAPIError.invalidData(error)
        }
    }
}

enum ScooterAPIError: LocalizedError {
    case invalidURL
    case badResponse
    case invalidData(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "The scooter service URL is invalid."
        case .badResponse:
            "The scooter service didn’t respond."
        case .invalidData:
            "The scooter data could not be read."
        }
    }
}
