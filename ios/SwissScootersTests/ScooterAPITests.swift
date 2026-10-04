import Foundation
import MapKit
import XCTest
@testable import SwissScooters

final class ScooterAPITests: XCTestCase {
    func testParkingIsDecodedSeparatelyFromVehiclesAndLegacyResponsesStillWork() async throws {
        let data = Data(#"{"vehicles":[],"clusters":[],"providers":{},"parking":[{"id":"dott:bay","provider":"dott","name":"Place test","lat":45.75,"lng":4.85,"mandatory":true}],"meta":{"partial":false,"stale":false,"failedSources":[],"sources":{},"generatedAt":"2026-09-08T12:00:00Z","truncated":false,"totalVehicles":0,"mode":"vehicles","zoom":16,"parkingStatus":"fresh"}}"#.utf8)
        let response = try await makeAPI(responseStatus: 200, data: data).scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
        XCTAssertEqual(response.parking.count, 1)
        XCTAssertTrue(response.parking[0].mandatory)
        XCTAssertEqual(response.parking[0].coordinate.latitude, 45.75)
        XCTAssertEqual(response.meta?.parkingStatus, "fresh")
        XCTAssertTrue(response.vehicles.isEmpty)
        let legacy = try await makeAPI(responseStatus: 200, data: emptyResponseData).scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
        XCTAssertTrue(legacy.parking.isEmpty)
    }

    func testSuccessfulResponseIsDecoded() async throws {
        let api = makeAPI(responseStatus: 200, data: emptyResponseData)

        let response = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)

        XCTAssertTrue(response.vehicles.isEmpty)
    }

    func testRequestSendsBoundsZoomAndFilterWithoutASeparateUserLocation() async throws {
        let session = StubNetworkSession(mode: .response(
            statusCode: 200,
            data: emptyResponseData
        ))
        let api = ScooterAPI(baseURL: ScooterAPI.productionBaseURL, session: session)

        _ = try await api.scooters(bounds: bounds, zoom: 12, minimumBattery: 55)

        let request = await session.lastRequest
        let components = URLComponents(
            url: try XCTUnwrap(request?.url),
            resolvingAgainstBaseURL: false
        )
        let names = Set(components?.queryItems?.map(\.name) ?? [])
        XCTAssertEqual(names, Set(["south", "west", "north", "east", "zoom", "minBattery"]))
        let values = Dictionary(uniqueKeysWithValues: components?.queryItems?.compactMap { item in
            item.value.map { (item.name, $0) }
        } ?? [])
        XCTAssertEqual(values["zoom"], "12")
        XCTAssertEqual(values["minBattery"], "55")
    }

    func testRequestsToTheServerLeaveNothingOnDisk() async throws {
        // Left to themselves, both clients use a session without a URL cache:
        // the bounds in a request are the rider's position after Near me.
        let scooterSession = await ScooterAPI().session as? URLSession
        let addressSession = await AddressSearchAPI().session as? URLSession
        for session in [scooterSession, addressSession] {
            let session = try XCTUnwrap(session)
            XCTAssertFalse(session === URLSession.shared)
            XCTAssertNil(session.configuration.urlCache)
            XCTAssertEqual(session.configuration.requestCachePolicy, .reloadIgnoringLocalCacheData)
        }
    }

    func testResponseHealthMetadataIsDecoded() async throws {
        let data = Data(#"{"vehicles":[],"clusters":[],"providers":{},"meta":{"partial":true,"stale":true,"failedSources":["national"],"sources":{"national":"failed","hopp":"fresh"},"generatedAt":"2026-08-05T12:00:00.000Z","truncated":true,"totalVehicles":6200,"mode":"vehicles","zoom":null}}"#.utf8)
        let api = makeAPI(responseStatus: 200, data: data)

        let response = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)

        XCTAssertTrue(response.meta?.partial == true)
        XCTAssertTrue(response.meta?.stale == true)
        XCTAssertEqual(response.meta?.failedSources, ["national"])
        XCTAssertTrue(response.meta?.truncated == true)
        XCTAssertEqual(response.meta?.totalVehicles, 6_200)
    }

    func testHTTPStatusIsPreserved() async {
        let api = makeAPI(responseStatus: 503)

        do {
            _ = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
            XCTFail("Expected an HTTP status error")
        } catch let error as ScooterAPIError {
            guard case .httpStatus(503) = error else {
                return XCTFail("Expected HTTP 503, got \(error)")
            }
            XCTAssertEqual(error.loadFailure, .unavailable)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testOfflineErrorIsToldApart() async {
        let api = makeAPI(urlError: .notConnectedToInternet)

        do {
            _ = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
            XCTFail("Expected an offline error")
        } catch let error as ScooterAPIError {
            guard case .offline = error else {
                return XCTFail("Expected offline, got \(error)")
            }
            XCTAssertEqual(error.loadFailure, .offline)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTimeoutIsToldApart() async {
        let api = makeAPI(urlError: .timedOut)

        do {
            _ = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
            XCTFail("Expected a timeout error")
        } catch let error as ScooterAPIError {
            guard case .timedOut = error else {
                return XCTFail("Expected timedOut, got \(error)")
            }
            XCTAssertEqual(error.loadFailure, .timeout)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testInvalidJSONIsToldApart() async {
        let api = makeAPI(responseStatus: 200, data: Data("{}".utf8))

        do {
            _ = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
            XCTFail("Expected a decoding error")
        } catch let error as ScooterAPIError {
            guard case .invalidData = error else {
                return XCTFail("Expected invalidData, got \(error)")
            }
            XCTAssertEqual(error.loadFailure, .failed)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testLoadFailureReasonIsDerivedFromTheAPIError() async {
        let expectations: [(ScooterAPIError, ScooterLoadFailure)] = [
            (.offline, .offline),
            (.timedOut, .timeout),
            (.httpStatus(429), .busy),
            (.httpStatus(500), .unavailable),
            (.httpStatus(503), .unavailable),
            (.httpStatus(599), .unavailable),
            (.httpStatus(404), .failed),
            (.invalidURL, .failed),
            (.invalidResponse, .failed),
            (.invalidData(URLError(.cannotParseResponse)), .failed),
            (.network(URLError(.cannotFindHost)), .failed)
        ]
        for (error, failure) in expectations {
            XCTAssertEqual(error.loadFailure, failure, "\(error)")
            XCTAssertEqual(ScooterLoadFailure(error), failure, "\(error)")
        }
        XCTAssertEqual(ScooterLoadFailure(URLError(.badURL)), .failed)
        XCTAssertEqual(Set(ScooterLoadFailure.allCases.map(\.message)).count, 5)

        // The reason survives the trip through the real client.
        for (api, failure) in [
            (makeAPI(urlError: .notConnectedToInternet), ScooterLoadFailure.offline),
            (makeAPI(urlError: .networkConnectionLost), .offline),
            (makeAPI(urlError: .timedOut), .timeout),
            (makeAPI(responseStatus: 429), .busy),
            (makeAPI(responseStatus: 502), .unavailable),
            (makeAPI(responseStatus: 200, data: Data("{}".utf8)), .failed)
        ] {
            do {
                _ = try await api.scooters(bounds: bounds, zoom: 16, minimumBattery: 0)
                XCTFail("Expected a \(failure) failure")
            } catch {
                XCTAssertEqual(ScooterLoadFailure(error), failure)
            }
        }
    }

    private var origin: GeoPoint {
        GeoPoint(latitude: 47.3769, longitude: 8.5417)
    }

    private var bounds: GeoBounds {
        GeoBounds(region: MKCoordinateRegion(
            center: origin.coordinate,
            latitudinalMeters: 1_000,
            longitudinalMeters: 1_000
        ))
    }

    private var emptyResponseData: Data {
        Data(#"{"vehicles":[],"clusters":[],"providers":{},"meta":{"partial":false,"stale":false,"failedSources":[],"sources":{"national":"fresh","hopp":"fresh"},"generatedAt":"2026-08-05T12:00:00.000Z","truncated":false,"totalVehicles":0,"mode":"vehicles","zoom":null}}"#.utf8)
    }

    private func makeAPI(responseStatus: Int, data: Data = Data()) -> ScooterAPI {
        ScooterAPI(
            baseURL: ScooterAPI.productionBaseURL,
            session: StubNetworkSession(mode: .response(statusCode: responseStatus, data: data))
        )
    }

    private func makeAPI(urlError: URLError.Code) -> ScooterAPI {
        ScooterAPI(
            baseURL: ScooterAPI.productionBaseURL,
            session: StubNetworkSession(mode: .urlError(urlError))
        )
    }
}

final class AddressSearchAPITests: XCTestCase {
    func testSwissGeocoderResponseIsDecodedAndRequestIsLocalized() async throws {
        let data = Data(#"[{"lat":47.3762772,"lng":8.5280816,"display_name":"114, Ankerstrasse, Zurich, Switzerland"}]"#.utf8)
        let session = StubAddressSearchSession(data: data)
        let api = AddressSearchAPI(
            baseURL: URL(string: "https://example.com")!,
            session: session
        )

        let results = try await api.search(query: "Ankerstrasse 114", language: "de")

        XCTAssertEqual(results, [AddressSearchResult(
            latitude: 47.3762772,
            longitude: 8.5280816,
            displayName: "114, Ankerstrasse, Zurich, Switzerland"
        )])

        let request = await session.lastRequest
        let components = URLComponents(url: try XCTUnwrap(request?.url), resolvingAgainstBaseURL: false)
        XCTAssertEqual(components?.path, "/api/geocode")
        XCTAssertNil(components?.query)
        XCTAssertEqual(request?.httpMethod, "POST")
        XCTAssertEqual(request?.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(request?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json, ["q": "Ankerstrasse 114", "lang": "de"])
    }

    func testTitleSubtitleAndCoverageAreDecodedWhenTheAPISendsThem() throws {
        let data = Data(#"""
        [
          {"lat": 47.3695, "lng": 8.5389, "display_name": "Paradeplatz 2 8001 Zürich",
           "title": "Paradeplatz 2", "subtitle": "8001 Zürich", "covered": true},
          {"lat": 46.7741, "lng": 8.1558, "display_name": "Paradeplatz (OW) - Lungern",
           "title": "Paradeplatz", "subtitle": "Lungern OW", "covered": false},
          {"lat": 47.3782, "lng": 8.5402, "display_name": "Zürich HB",
           "title": "Zürich HB", "subtitle": "", "covered": true}
        ]
        """#.utf8)

        let results = try JSONDecoder().decode([AddressSearchResult].self, from: data)

        XCTAssertEqual(results.map(\.title), ["Paradeplatz 2", "Paradeplatz", "Zürich HB"])
        XCTAssertEqual(results.map(\.subtitle), ["8001 Zürich", "Lungern OW", ""])
        XCTAssertEqual(results.map(\.isCovered), [true, false, true])
        XCTAssertEqual(results[1].displayName, "Paradeplatz (OW) - Lungern")
        XCTAssertEqual(results[1].destination, MapDestination(
            title: "Paradeplatz",
            subtitle: "Lungern OW",
            point: GeoPoint(latitude: 46.7741, longitude: 8.1558)
        ))
        // A chosen place keeps the search's answer about scooter data.
        XCTAssertEqual(results.map(\.destination.isCovered), [true, false, true])
        XCTAssertEqual(Set(results.map(\.id)).count, 3)
    }

    func testOlderResponsesFallBackToLabelSplittingAndBundledCoverage() throws {
        let data = Data(#"""
        [
          {"lat": 47.3695, "lng": 8.5389, "display_name": "Paradeplatz 2 8001 Zürich"},
          {"lat": 46.7741, "lng": 8.1558, "display_name": "Lungern", "title": "", "covered": null},
          {"lat": 47.3762772, "lng": 8.5280816, "display_name": "114, Ankerstrasse, Zurich, Switzerland",
           "title": 12, "subtitle": "ignored without a title"}
        ]
        """#.utf8)

        let results = try JSONDecoder().decode([AddressSearchResult].self, from: data)

        XCTAssertEqual(results.map(\.title), ["Paradeplatz 2", "Lungern", "Ankerstrasse 114"])
        XCTAssertEqual(results.map(\.subtitle), ["8001 Zürich", "", "Zurich, Switzerland"])
        // Without `covered`, the service areas bundled with the app decide.
        XCTAssertEqual(results.map(\.isCovered), [true, false, true])

        let examples: [(String, String, String)] = [
            ("Bahnhofstrasse 1 8001 Zürich", "Bahnhofstrasse 1", "8001 Zürich"),
            ("Rue du Rhône 10 1204 Genève", "Rue du Rhône 10", "1204 Genève"),
            ("Via Nassa 5, 6900 Lugano", "Via Nassa 5", "6900 Lugano"),
            ("114, Ankerstrasse, Zurich, Switzerland", "Ankerstrasse 114", "Zurich, Switzerland"),
            ("Zürich HB", "Zürich HB", ""),
            ("8001 Zürich", "8001 Zürich", ""),
            ("  Bahnhofstrasse 1, CH-8001 Zürich  ", "Bahnhofstrasse 1", "CH-8001 Zürich")
        ]
        for (label, title, subtitle) in examples {
            let lines = AddressSearchResult.lines(fromDisplayName: label)
            XCTAssertEqual(lines.title, title, label)
            XCTAssertEqual(lines.subtitle, subtitle, label)

            // A search result without its own title shows the same two lines.
            let result = AddressSearchResult(latitude: 47.3769, longitude: 8.5417, displayName: label)
            XCTAssertEqual(result.title, title, label)
            XCTAssertEqual(result.subtitle, subtitle, label)
        }
    }
}

@MainActor
final class AddressSearchModelTests: XCTestCase {
    private let zurich = AddressSearchResult(
        latitude: 47.3690, longitude: 8.5390, displayName: "Paradeplatz (ZH) - Zürich",
        title: "Paradeplatz", subtitle: "Zürich ZH", isCovered: true
    )
    private let lungern = AddressSearchResult(
        latitude: 46.7741, longitude: 8.1558, displayName: "Paradeplatz (OW) - Lungern",
        title: "Paradeplatz", subtitle: "Lungern OW", isCovered: false
    )

    func testSearchStartsAtTwoCharactersAndReturnChoosesTheFirstPlace() async {
        let api = StubAddressSearchClient(answers: [.places([zurich, lungern])])
        let model = SwissAddressSearchModel(api: api, debounce: .zero)
        XCTAssertEqual(model.status, .idle)
        XCTAssertNil(model.firstResult)

        // One character keeps the suggestions on screen and asks nothing.
        model.query = "P"
        XCTAssertEqual(model.status, .idle)

        model.query = " Paradeplatz "
        XCTAssertEqual(model.status, .searching)
        let found = await waitUntil { model.status != .searching }
        XCTAssertTrue(found)
        XCTAssertEqual(model.status, .results([zurich, lungern]))
        XCTAssertEqual(model.firstResult, zurich)
        let queries = await api.queries
        XCTAssertEqual(queries, ["Paradeplatz"])

        // The chosen place carries its two lines and whether it has scooter data.
        let unserved = model.select(lungern)
        XCTAssertEqual(unserved.title, "Paradeplatz")
        XCTAssertEqual(unserved.subtitle, "Lungern OW")
        XCTAssertFalse(unserved.isCovered)
        XCTAssertTrue(model.select(zurich).isCovered)
    }

    func testNothingFoundAndAFailedSearchAreToldApartAndTryAgainSearchesAgain() async {
        let api = StubAddressSearchClient(answers: [.places([]), .failure, .places([zurich])])
        let model = SwissAddressSearchModel(api: api, debounce: .zero)

        model.query = "Xyzzy"
        var settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        XCTAssertEqual(model.status, .noResults)
        XCTAssertNil(model.firstResult)

        model.query = "Zürich"
        settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        XCTAssertEqual(model.status, .failed)

        // Try again repeats the search for the text in the field.
        model.retry()
        XCTAssertEqual(model.status, .searching)
        settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        XCTAssertEqual(model.status, .results([zurich]))
        let queries = await api.queries
        XCTAssertEqual(queries, ["Xyzzy", "Zürich", "Zürich"])
    }

    func testClearingTheFieldBringsTheSuggestionsBackAndDropsALateAnswer() async {
        let api = StubAddressSearchClient(answers: [.places([zurich])], delay: .milliseconds(60))
        let model = SwissAddressSearchModel(api: api, debounce: .zero)

        model.query = "Paradeplatz"
        XCTAssertEqual(model.status, .searching)
        model.clear()
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(model.status, .idle)

        // The answer to the cleared text arrives later and changes nothing.
        try? await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(model.status, .idle)
    }

    func testEverySearchAsksForPlacesInTheLanguageOnScreen() async {
        let api = StubAddressSearchClient(answers: [.failure, .places([zurich]), .places([lungern])])
        let model = SwissAddressSearchModel(api: api, debounce: .zero, language: "fr")

        model.query = "Paradeplatz"
        var settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        model.retry()
        settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        model.query = "Lungern"
        settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)

        // The first search, the one after "Try again" and the next text all carry it.
        let languages = await api.languages
        XCTAssertEqual(languages, ["fr", "fr", "fr"])
    }

    func testSearchLanguageIsTheOneTheAppIsShownIn() async {
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["de"]), "de")
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["fr", "en"]), "fr")
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["it-CH"]), "it")
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["en-GB"]), "en")
        // Anything the search does not answer in is asked for in English.
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["es"]), "en")
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: ["Base"]), "en")
        XCTAssertEqual(SwissAddressSearchModel.searchLanguage(localizations: []), "en")

        // Left to itself, the model sends the language this run of the app is shown in.
        let shownIn = Bundle.main.preferredLocalizations.first ?? ""
        XCTAssertTrue(["en", "de", "fr", "it"].contains(shownIn), shownIn)
        let api = StubAddressSearchClient(answers: [.places([zurich])])
        let model = SwissAddressSearchModel(api: api, debounce: .zero)
        model.query = "Paradeplatz"
        let settled = await waitUntil { model.status != .searching }
        XCTAssertTrue(settled)
        let languages = await api.languages
        XCTAssertEqual(languages, [shownIn])
    }

    private func waitUntil(_ condition: () -> Bool) async -> Bool {
        for _ in 0 ..< 200 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }
}

private actor StubAddressSearchClient: AddressSearchAPIClient {
    enum Answer: Sendable {
        case places([AddressSearchResult])
        case failure
    }

    private var answers: [Answer]
    private let delay: Duration
    private(set) var queries: [String] = []
    private(set) var languages: [String] = []

    init(answers: [Answer], delay: Duration = .zero) {
        self.answers = answers
        self.delay = delay
    }

    func search(query: String, language: String) async throws -> [AddressSearchResult] {
        queries.append(query)
        languages.append(language)
        let answer = answers.isEmpty ? Answer.places([]) : answers.removeFirst()
        try await Task.sleep(for: delay)
        switch answer {
        case let .places(places): return places
        case .failure: throw URLError(.notConnectedToInternet)
        }
    }
}

private actor StubNetworkSession: ScooterNetworkSession {
    enum Mode: Sendable {
        case response(statusCode: Int, data: Data)
        case urlError(URLError.Code)
    }

    let mode: Mode
    private(set) var lastRequest: URLRequest?

    init(mode: Mode) {
        self.mode = mode
    }

    func scooterData(for request: URLRequest) async throws -> (Data, URLResponse) {
        lastRequest = request
        switch mode {
        case let .response(statusCode, data):
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (data, response)
        case let .urlError(code):
            throw URLError(code)
        }
    }
}

private actor StubAddressSearchSession: AddressSearchNetworkSession {
    let data: Data
    private(set) var lastRequest: URLRequest?

    init(data: Data) {
        self.data = data
    }

    func addressData(for request: URLRequest) async throws -> (Data, URLResponse) {
        lastRequest = request
        return (
            data,
            HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
        )
    }
}

@MainActor
final class ScooterAnalyticsTests: XCTestCase {
    func testPayloadExcludesSensitiveValuesAndPersistentIdentity() {
        let payload = ScooterAnalytics.payload("rental_open", provider: "lime", value: 10,
            result: "47.123,8.456", target: "private address", screen: "/?lat=47.123")
        XCTAssertEqual(payload["url"] as? String, "/")
        XCTAssertEqual(payload["referrer"] as? String, "")
        XCTAssertEqual(payload["tag"] as? String, "ios")
        XCTAssertNil(payload["id"])
        let data = payload["data"] as? [String: Any]
        XCTAssertEqual(data?["provider"] as? String, "lime")
        XCTAssertEqual(data?["platform"] as? String, "ios")
        XCTAssertNil(data?["result"])
        XCTAssertNil(data?["target"])
    }

    func testScreenViewDoesNotBecomeNamedEvent() {
        let payload = ScooterAnalytics.payload(nil, screen: "/settings")
        XCTAssertEqual(payload["url"] as? String, "/settings")
        XCTAssertNil(payload["name"])
        XCTAssertNil(payload["data"])
    }
}
