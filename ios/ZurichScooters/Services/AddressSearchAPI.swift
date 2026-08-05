import Foundation

struct AddressSearchResult: Decodable, Equatable, Identifiable, Sendable {
    let latitude: Double
    let longitude: Double
    let displayName: String

    var id: String { "\(latitude):\(longitude):\(displayName)" }

    private enum CodingKeys: String, CodingKey {
        case latitude = "lat"
        case longitude = "lng"
        case displayName = "display_name"
    }
}

protocol AddressSearchAPIClient: Sendable {
    func search(query: String, language: String) async throws -> [AddressSearchResult]
}

protocol AddressSearchNetworkSession: Sendable {
    func addressData(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: AddressSearchNetworkSession {
    func addressData(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

actor AddressSearchAPI: AddressSearchAPIClient {
    private let baseURL: URL
    private let session: any AddressSearchNetworkSession

    init(
        baseURL: URL = ScooterAPI.productionBaseURL,
        session: any AddressSearchNetworkSession = URLSession.shared
    ) {
        self.baseURL = baseURL
        self.session = session
    }

    func search(query: String, language: String) async throws -> [AddressSearchResult] {
        var components = URLComponents(
            url: baseURL.appending(path: "api/geocode"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "lang", value: language)
        ]

        guard let url = components.url else {
            throw AddressSearchAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        request.cachePolicy = .returnCacheDataElseLoad
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.addressData(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200 ... 299).contains(httpResponse.statusCode) else {
            throw AddressSearchAPIError.invalidResponse
        }

        do {
            return try JSONDecoder().decode([AddressSearchResult].self, from: data)
        } catch {
            throw AddressSearchAPIError.invalidResponse
        }
    }
}

private enum AddressSearchAPIError: Error {
    case invalidResponse
}
