import Foundation
import MapKit
import XCTest
@testable import SwissScooters

final class ScooterAPITests: XCTestCase {
    func testSuccessfulResponseIsDecoded() async throws {
        let api = makeAPI(responseStatus: 200, data: Data(#"{"vehicles":[]}"#.utf8))

        let response = try await api.scooters(origin: origin, bounds: bounds)

        XCTAssertTrue(response.vehicles.isEmpty)
    }

    func testResponseHealthMetadataIsDecoded() async throws {
        let data = Data(#"{"vehicles":[],"meta":{"partial":true,"stale":true,"failedSources":["national"],"truncated":true,"totalVehicles":6200}}"#.utf8)
        let api = makeAPI(responseStatus: 200, data: data)

        let response = try await api.scooters(origin: origin, bounds: bounds)

        XCTAssertTrue(response.meta?.partial == true)
        XCTAssertTrue(response.meta?.stale == true)
        XCTAssertEqual(response.meta?.failedSources, ["national"])
        XCTAssertTrue(response.meta?.truncated == true)
        XCTAssertEqual(response.meta?.totalVehicles, 6_200)
    }

    func testHTTPStatusIsPreserved() async {
        let api = makeAPI(responseStatus: 503)

        do {
            _ = try await api.scooters(origin: origin, bounds: bounds)
            XCTFail("Expected an HTTP status error")
        } catch let error as ScooterAPIError {
            XCTAssertEqual(error.statusCode, 503)
            XCTAssertFalse(error.localizedDescription.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testOfflineErrorGetsActionableMessage() async {
        let api = makeAPI(urlError: .notConnectedToInternet)

        do {
            _ = try await api.scooters(origin: origin, bounds: bounds)
            XCTFail("Expected an offline error")
        } catch let error as ScooterAPIError {
            guard case .offline = error else {
                return XCTFail("Expected offline, got \(error)")
            }
            XCTAssertFalse(error.localizedDescription.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testTimeoutGetsSpecificMessage() async {
        let api = makeAPI(urlError: .timedOut)

        do {
            _ = try await api.scooters(origin: origin, bounds: bounds)
            XCTFail("Expected a timeout error")
        } catch let error as ScooterAPIError {
            guard case .timedOut = error else {
                return XCTFail("Expected timedOut, got \(error)")
            }
            XCTAssertFalse(error.localizedDescription.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testInvalidJSONGetsDataMessage() async {
        let api = makeAPI(responseStatus: 200, data: Data("{}".utf8))

        do {
            _ = try await api.scooters(origin: origin, bounds: bounds)
            XCTFail("Expected a decoding error")
        } catch let error as ScooterAPIError {
            guard case .invalidData = error else {
                return XCTFail("Expected invalidData, got \(error)")
            }
            XCTAssertFalse(error.localizedDescription.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
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
        XCTAssertEqual(
            Dictionary(uniqueKeysWithValues: components?.queryItems?.compactMap { item in
                item.value.map { (item.name, $0) }
            } ?? []),
            ["q": "Ankerstrasse 114", "lang": "de"]
        )
    }
}

private actor StubNetworkSession: ScooterNetworkSession {
    enum Mode: Sendable {
        case response(statusCode: Int, data: Data)
        case urlError(URLError.Code)
    }

    let mode: Mode

    init(mode: Mode) {
        self.mode = mode
    }

    func scooterData(for request: URLRequest) async throws -> (Data, URLResponse) {
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
