import Foundation

protocol ScooterAPIClient: Sendable {
    func scooters(origin: GeoPoint, bounds: GeoBounds) async throws -> ScooterResponse
}

protocol ScooterNetworkSession: Sendable {
    func scooterData(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: ScooterNetworkSession {
    func scooterData(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

actor ScooterAPI: ScooterAPIClient {
    static let productionBaseURL = URL(string: "https://swiss-scooters.plhery.com")!

    private let baseURL: URL
    private let session: any ScooterNetworkSession

    init(
        baseURL: URL = productionBaseURL,
        session: any ScooterNetworkSession = URLSession.shared
    ) {
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

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.scooterData(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            switch error.code {
            case .cancelled:
                throw CancellationError()
            case .notConnectedToInternet,
                 .networkConnectionLost,
                 .dataNotAllowed,
                 .internationalRoamingOff:
                throw ScooterAPIError.offline
            case .timedOut:
                throw ScooterAPIError.timedOut
            default:
                throw ScooterAPIError.network(error)
            }
        } catch {
            throw ScooterAPIError.network(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ScooterAPIError.invalidResponse
        }
        guard (200 ... 299).contains(httpResponse.statusCode) else {
            throw ScooterAPIError.httpStatus(httpResponse.statusCode)
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
    case offline
    case timedOut
    case invalidResponse
    case httpStatus(Int)
    case invalidData(Error)
    case network(Error)

    var statusCode: Int? {
        guard case let .httpStatus(statusCode) = self else { return nil }
        return statusCode
    }

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            String(localized: "The scooter service URL is invalid.")
        case .offline:
            String(localized: "You appear to be offline. Check your connection and try again.")
        case .timedOut:
            String(localized: "The scooter service took too long to respond. Please try again.")
        case .invalidResponse:
            String(localized: "The scooter service returned an invalid response.")
        case let .httpStatus(statusCode) where statusCode == 429:
            String(localized: "The scooter service is receiving too many requests (HTTP 429). Please try again shortly.")
        case let .httpStatus(statusCode) where (500 ... 599).contains(statusCode):
            String(format: String(localized: "The scooter service is temporarily unavailable (HTTP %lld)."), statusCode)
        case let .httpStatus(statusCode):
            String(format: String(localized: "The scooter request failed (HTTP %lld)."), statusCode)
        case .invalidData:
            String(localized: "The scooter data could not be read.")
        case let .network(error):
            String(
                format: String(localized: "A network error prevented the scooter update: %@"),
                error.localizedDescription
            )
        }
    }
}
