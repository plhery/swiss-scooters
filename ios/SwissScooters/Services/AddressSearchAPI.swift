import Foundation

struct AddressSearchResult: Decodable, Equatable, Identifiable, Sendable {
    let latitude: Double
    let longitude: Double
    let displayName: String
    let title: String
    /// May be empty; hide the second line when it is.
    let subtitle: String
    /// False when no operator serves this place: show the "No data" tag.
    let isCovered: Bool

    var id: String { "\(latitude):\(longitude):\(displayName)" }

    var destination: MapDestination {
        let point = GeoPoint(latitude: latitude, longitude: longitude)
        return MapDestination(
            title: title,
            subtitle: subtitle,
            point: point,
            // A typed city with scooter data shows the whole city, like its chip.
            kind: ScooterCityCatalog.city(centredAt: point) == nil ? .address : .city,
            isCovered: isCovered
        )
    }

    /// Responses without `title` or `covered` fall back to splitting
    /// `displayName` and to the bundled service areas.
    init(
        latitude: Double,
        longitude: Double,
        displayName: String,
        title: String? = nil,
        subtitle: String? = nil,
        isCovered: Bool? = nil
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.displayName = displayName

        let trimmedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmedTitle.isEmpty {
            let lines = Self.lines(fromDisplayName: displayName)
            self.title = lines.title
            self.subtitle = lines.subtitle
        } else {
            self.title = trimmedTitle
            self.subtitle = subtitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        }
        self.isCovered = isCovered
            ?? ScooterCityCatalog.contains(latitude: latitude, longitude: longitude)
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            latitude: try container.decode(Double.self, forKey: .latitude),
            longitude: try container.decode(Double.self, forKey: .longitude),
            displayName: try container.decode(String.self, forKey: .displayName),
            title: try? container.decodeIfPresent(String.self, forKey: .title),
            subtitle: try? container.decodeIfPresent(String.self, forKey: .subtitle),
            isCovered: try? container.decodeIfPresent(Bool.self, forKey: .isCovered)
        )
    }

    /// Splits a plain label such as "Bahnhofstrasse 1 8001 Zürich" into two lines.
    static func lines(fromDisplayName displayName: String) -> (title: String, subtitle: String) {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let components = name.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        if components.count > 1 {
            if components[0].range(of: #"^\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?$"#, options: .regularExpression) != nil {
                return ("\(components[1]) \(components[0])", components.dropFirst(2).joined(separator: ", "))
            }
            return (components[0], components.dropFirst().joined(separator: ", "))
        }

        // Swisstopo labels usually look like "Bahnhofstrasse 1 8001 Zürich".
        if let postalCode = name.range(of: #"\s+(?:CH-)?\d{4}\s+\p{L}"#, options: .regularExpression) {
            return (
                String(name[..<postalCode.lowerBound]),
                name[postalCode.lowerBound...].trimmingCharacters(in: .whitespaces)
            )
        }
        return (name, "")
    }

    private enum CodingKeys: String, CodingKey {
        case latitude = "lat"
        case longitude = "lng"
        case displayName = "display_name"
        case title
        case subtitle
        case isCovered = "covered"
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
