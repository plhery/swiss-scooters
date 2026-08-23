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
    private struct SearchRequest: Encodable {
        let q: String
        let lang: String
    }

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
        var request = URLRequest(url: baseURL.appending(path: "api/geocode"))
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(SearchRequest(q: query, lang: language))
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

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
