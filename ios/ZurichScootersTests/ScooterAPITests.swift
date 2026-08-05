import Foundation
import MapKit
import XCTest
@testable import ZurichScooters

final class ScooterAPITests: XCTestCase {
    func testSuccessfulResponseIsDecoded() async throws {
        let api = makeAPI(responseStatus: 200, data: Data(#"{"vehicles":[]}"#.utf8))

        let response = try await api.scooters(origin: origin, bounds: bounds)

        XCTAssertTrue(response.vehicles.isEmpty)
    }

    func testPartialResponseMetadataIsDecoded() async throws {
        let data = Data(#"{"vehicles":[],"meta":{"partial":true,"failedSources":["national"]}}"#.utf8)
        let api = makeAPI(responseStatus: 200, data: data)

        let response = try await api.scooters(origin: origin, bounds: bounds)

        XCTAssertTrue(response.meta?.partial == true)
        XCTAssertEqual(response.meta?.failedSources, ["national"])
    }

    func testHTTPStatusIsPreserved() async {
        let api = makeAPI(responseStatus: 503)

        do {
            _ = try await api.scooters(origin: origin, bounds: bounds)
            XCTFail("Expected an HTTP status error")
        } catch let error as ScooterAPIError {
            XCTAssertEqual(error.statusCode, 503)
            XCTAssertEqual(
                error.localizedDescription,
                "The scooter service is temporarily unavailable (HTTP 503)."
            )
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
            XCTAssertEqual(
                error.localizedDescription,
                "You appear to be offline. Check your connection and try again."
            )
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
            XCTAssertEqual(
                error.localizedDescription,
                "The scooter service took too long to respond. Please try again."
            )
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
            XCTAssertEqual(error.localizedDescription, "The scooter data could not be read.")
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
