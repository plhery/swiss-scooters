import Foundation
import XCTest
@testable import SwissScooters

final class ScooterModelsTests: XCTestCase {
    func testFrenchPonyScooterKeepsItsProviderEuroPricingAndRentalLink() throws {
        let data = Data(#"""
        {
          "provider": "pony",
          "lat": 47.4784,
          "lng": -0.5632,
          "battery": 75,
          "range_m": 32620,
          "vehicle_id": "pony_fr_angers:vehicle-1",
          "deep_link": null,
          "rental_uris": {
            "ios": "https://getapony.com/app/scan",
            "android": "https://getapony.com/app/scan",
            "web": null
          },
          "pricing": {
            "currency": "EUR",
            "unlock_fee_minor_units": 100,
            "minute_fee_minor_units": 26
          },
          "distance_m": null
        }
        """#.utf8)
        let scooter = try JSONDecoder().decode(ScooterVehiclePayload.self, from: data).model
        XCTAssertEqual(scooter.providerInfo, .pony)
        XCTAssertEqual(scooter.coordinate.latitude, 47.4784)
        XCTAssertEqual(scooter.coordinate.longitude, -0.5632)
        XCTAssertEqual(scooter.pricing?.currency, "EUR")
        XCTAssertEqual(scooter.rentalURL?.absoluteString, "https://getapony.com/app/scan")
    }

    func testDecodingAndStableProviderIdentity() throws {
        let data = Data(#"""
        {
          "vehicles": [{
            "provider": "lime",
            "lat": 47.3769,
            "lng": 8.5417,
            "battery": 82,
            "range_m": 12345,
            "vehicle_id": "abc-123",
            "deep_link": "https://lime.bike/vehicle/abc-123",
            "rental_uris": {
              "ios": "limebike://vehicle/abc-123",
              "android": "https://lime.bike/vehicle/abc-123?platform=android",
              "web": "https://lime.bike/vehicle/abc-123"
            },
            "pricing": {
              "currency": "CHF",
              "unlock_fee_minor_units": 100,
              "minute_fee_minor_units": 42
            },
            "distance_m": 250.5
          }],
          "clusters": [],
          "providers": {"lime": 1},
          "meta": {
            "partial": false,
            "stale": false,
            "failedSources": [],
            "sources": {"national": "fresh", "hopp": "fresh"},
            "generatedAt": "2026-08-05T12:00:00.000Z",
            "truncated": false,
            "totalVehicles": 1,
            "mode": "vehicles",
            "zoom": null
          }
        }
        """#.utf8)

        let response = try JSONDecoder().decode(ScooterAPIResponsePayload.self, from: data).model
        let scooter = try XCTUnwrap(response.vehicles.first)

        XCTAssertEqual(scooter.id, "lime:abc-123")
        XCTAssertEqual(scooter.providerInfo, .lime)
        XCTAssertEqual(scooter.battery, 82)
        XCTAssertEqual(scooter.rangeMeters, 12_345)
        XCTAssertEqual(scooter.deepLink, "https://lime.bike/vehicle/abc-123")
        XCTAssertEqual(scooter.rentalURL?.absoluteString, "limebike://vehicle/abc-123")
        XCTAssertEqual(
            scooter.pricing,
            ScooterRidePricing(
                currency: "CHF",
                unlockFeeMinorUnits: 100,
                minuteFeeMinorUnits: 42
            )
        )
    }

    func testCoordinateIdentityIsUsedWhenVehicleIDIsMissing() throws {
        let scooter = try makeScooter(provider: "bird", latitude: 47.1, longitude: 8.2, vehicleID: nil)
        XCTAssertEqual(scooter.id, "bird:47.1:8.2")
    }

    func testVehiclePricingIsOptionalAndMalformedPricingIsDiscarded() throws {
        let missingPricingData = Data(#"""
        {
          "provider": "bird",
          "lat": 47.1,
          "lng": 8.2,
          "battery": null,
          "range_m": null,
          "vehicle_id": "without-pricing",
          "deep_link": null,
          "distance_m": null
        }
        """#.utf8)
        let malformedPricingData = Data(#"""
        {
          "provider": "lime",
          "lat": 47.1,
          "lng": 8.2,
          "battery": null,
          "range_m": null,
          "vehicle_id": "bad-pricing",
          "deep_link": null,
          "pricing": {
            "currency": "CHF",
            "unlock_fee_minor_units": -1,
            "minute_fee_minor_units": 42
          },
          "distance_m": null
        }
        """#.utf8)

        let missingPricing = try JSONDecoder()
            .decode(ScooterVehiclePayload.self, from: missingPricingData)
            .model
        let malformedPricing = try JSONDecoder()
            .decode(ScooterVehiclePayload.self, from: malformedPricingData)
            .model

        XCTAssertNil(missingPricing.pricing)
        XCTAssertNil(malformedPricing.pricing)
    }

    func testDistanceUsesCoordinatesRatherThanServerDistance() throws {
        let scooter = try makeScooter(
            provider: "bolt",
            latitude: 47.3779,
            longitude: 8.5417,
            vehicleID: "nearby",
            serverDistance: 50_000
        )

        let distance = scooter.distance(from: GeoPoint(latitude: 47.3769, longitude: 8.5417))

        XCTAssertEqual(distance, 111.2, accuracy: 1.5)
        XCTAssertEqual(
            plainSpaces(scooter.formattedDistance(from: GeoPoint(latitude: 47.3769, longitude: 8.5417))),
            "\(Int(distance.rounded())) m"
        )
    }

    func testRangeFormattingOnlyExistsWhenRangeIsProvided() throws {
        XCTAssertNotNil(try makeScooter(rangeMeters: 1_500).formattedRange)
        XCTAssertNil(try makeScooter(rangeMeters: nil).formattedRange)
    }

    /// The same scooter reads the same on the web and here: whole metres below a
    /// kilometre, then kilometres with at most one decimal. No rounding to 50 m.
    func testLengthsAreWrittenAsOnTheWeb() throws {
        let decimal = Locale.current.decimalSeparator ?? "."
        let expectations = [
            (51, "51 m"), (320, "320 m"), (337, "337 m"), (951, "951 m"),
            (1_000, "1 km"), (1_250, "1\(decimal)3 km"), (1_449, "1\(decimal)4 km"),
            (12_400, "12\(decimal)4 km"), (24_000, "24 km")
        ]
        for (meters, text) in expectations {
            let range = try XCTUnwrap(makeScooter(rangeMeters: meters).formattedRange)
            XCTAssertEqual(plainSpaces(range), text, "\(meters) m")
            // A line never breaks between the number and its unit.
            XCTAssertFalse(range.contains(" "), range)
        }
    }

    private func plainSpaces(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ")
    }

    func testMapZoomRoundsUpAtTheServerClusteringBoundary() {
        XCTAssertEqual(ScooterClusteringPolicy.apiZoom(for: 15), 15)
        XCTAssertEqual(ScooterClusteringPolicy.apiZoom(for: 15.01), 16)
        XCTAssertTrue(ScooterClusteringPolicy.representationsMatch(16, 18))
        XCTAssertFalse(ScooterClusteringPolicy.representationsMatch(14, 15))
    }

    func testRentalLinkPolicyUsesTheIOSLinkAndNeverTheAndroidLink() {
        let rentalURIs = ScooterRentalURIs(
            ios: "https://go.ridedott.com/vehicles/1?platform=ios",
            android: "https://go.ridedott.com/vehicles/1?platform=android",
            web: nil
        )

        let url = ScooterRentalLinkPolicy.rentalURL(
            provider: "dott",
            rentalURIs: rentalURIs,
            legacyLink: nil
        )

        XCTAssertEqual(
            url?.absoluteString,
            "https://go.ridedott.com/vehicles/1?platform=ios"
        )
        XCTAssertFalse(url?.absoluteString.contains("platform=android") == true)
    }

    func testRentalLinkPolicyRejectsUnsafeAndCrossProviderURLs() {
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "lime",
            value: "javascript:alert(1)"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "lime",
            value: "bolt://action/rent"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "hopp",
            value: "https://app.hopp.bike.example.com/launch/1"
        ))
        XCTAssertNil(ScooterRentalLinkPolicy.safeURL(
            provider: "hopp",
            value: "https://user@app.hopp.bike/launch/1"
        ))
    }

    func testRideEstimateDurationPolicyAcceptsOnlyMenuDurations() {
        XCTAssertEqual(RideEstimateDuration.allowedMinutes, [5, 10, 15, 20, 30])
        XCTAssertEqual(RideEstimateDuration.defaultMinutes, 10)

        for duration in RideEstimateDuration.allowedMinutes {
            XCTAssertEqual(RideEstimateDuration.normalized(duration), duration)
        }
        XCTAssertEqual(RideEstimateDuration.normalized(0), 10)
        XCTAssertEqual(RideEstimateDuration.normalized(12), 10)
        XCTAssertEqual(RideEstimateDuration.normalized(-5), 10)
    }

    func testRidePriceEstimateUsesExactMinorUnitArithmetic() {
        let quote = RidePriceEstimator.quote(
            pricing: ScooterRidePricing(
                currency: "CHF",
                unlockFeeMinorUnits: 95,
                minuteFeeMinorUnits: 41
            ),
            durationMinutes: 30
        )

        XCTAssertEqual(quote.currency, "CHF")
        XCTAssertEqual(quote.durationMinutes, 30)
        XCTAssertEqual(quote.grossMinorUnits, 1_325)
        XCTAssertEqual(quote.totalMinorUnits, 1_325)
        XCTAssertEqual(quote.chargedUnlockFeeMinorUnits, 95)
        XCTAssertEqual(quote.billedMinutes, 30)
        XCTAssertEqual(quote.freeMinutesApplied, 0)
        XCTAssertFalse(quote.passApplied)
    }

    func testActivePassCanRemoveOnlyTheUnlockFee() {
        let quote = RidePriceEstimator.quote(
            pricing: standardPricing,
            durationMinutes: 10,
            pass: ProviderRidePass(enabled: true, freeUnlock: true)
        )

        XCTAssertEqual(quote.grossMinorUnits, 520)
        XCTAssertEqual(quote.totalMinorUnits, 420)
        XCTAssertEqual(quote.chargedUnlockFeeMinorUnits, 0)
        XCTAssertEqual(quote.billedMinutes, 10)
        XCTAssertEqual(quote.freeMinutesApplied, 0)
        XCTAssertTrue(quote.passApplied)
    }

    func testActivePassSubtractsFreeMinutesWithoutGoingBelowZero() {
        let partialQuote = RidePriceEstimator.quote(
            pricing: standardPricing,
            durationMinutes: 10,
            pass: ProviderRidePass(enabled: true, freeMinutes: 4)
        )
        let fullyCoveredQuote = RidePriceEstimator.quote(
            pricing: standardPricing,
            durationMinutes: 10,
            pass: ProviderRidePass(enabled: true, freeUnlock: true, freeMinutes: 30)
        )

        XCTAssertEqual(partialQuote.totalMinorUnits, 352)
        XCTAssertEqual(partialQuote.chargedUnlockFeeMinorUnits, 100)
        XCTAssertEqual(partialQuote.billedMinutes, 6)
        XCTAssertEqual(partialQuote.freeMinutesApplied, 4)
        XCTAssertTrue(partialQuote.passApplied)
        XCTAssertEqual(fullyCoveredQuote.totalMinorUnits, 0)
        XCTAssertEqual(fullyCoveredQuote.chargedUnlockFeeMinorUnits, 0)
        XCTAssertEqual(fullyCoveredQuote.billedMinutes, 0)
        XCTAssertEqual(fullyCoveredQuote.freeMinutesApplied, 10)
        XCTAssertTrue(fullyCoveredQuote.passApplied)
    }

    func testDisabledPassDoesNotAffectEstimate() {
        let quote = RidePriceEstimator.quote(
            pricing: standardPricing,
            durationMinutes: 10,
            pass: ProviderRidePass(
                enabled: false,
                freeUnlock: true,
                freeMinutes: 10
            )
        )

        XCTAssertEqual(quote.totalMinorUnits, 520)
        XCTAssertEqual(quote.billedMinutes, 10)
        XCTAssertFalse(quote.passApplied)
    }

    func testPassExpiryIncludesTheWholeLocalExpiryDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Europe/Zurich"))
        let expiryDate = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 30,
            hour: 8
        )))
        let pass = ProviderRidePass(
            enabled: true,
            freeUnlock: true,
            freeMinutes: 10,
            expiryDate: expiryDate
        )
        let finalMinute = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 30,
            hour: 23,
            minute: 59
        )))
        let nextDay = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026,
            month: 8,
            day: 31
        )))

        XCTAssertTrue(pass.isActive(on: finalMinute, calendar: calendar))
        XCTAssertFalse(pass.isActive(on: nextDay, calendar: calendar))
        XCTAssertEqual(
            RidePriceEstimator.quote(
                pricing: standardPricing,
                durationMinutes: 10,
                pass: pass,
                now: finalMinute,
                calendar: calendar
            ).totalMinorUnits,
            0
        )
        XCTAssertEqual(
            RidePriceEstimator.quote(
                pricing: standardPricing,
                durationMinutes: 10,
                pass: pass,
                now: nextDay,
                calendar: calendar
            ).totalMinorUnits,
            520
        )
    }

    func testEnabledPassWithoutExpiryDoesNotExpire() {
        let pass = ProviderRidePass(enabled: true, freeMinutes: 5)
        XCTAssertTrue(pass.isActive(on: .distantFuture))
    }

    func testPassInitializerClampsNegativeFreeMinutes() {
        let pass = ProviderRidePass(enabled: true, freeMinutes: -12)
        let quote = RidePriceEstimator.quote(
            pricing: standardPricing,
            durationMinutes: 10,
            pass: pass
        )

        XCTAssertEqual(pass.freeMinutes, 0)
        XCTAssertEqual(quote.totalMinorUnits, 520)
        XCTAssertFalse(quote.passApplied)
    }

    func testProviderRidePassCodableRoundTripPreservesExpiry() throws {
        let expiryDate = Date(timeIntervalSince1970: 1_788_044_400)
        let pass = ProviderRidePass(
            enabled: true,
            freeUnlock: true,
            freeMinutes: 25,
            expiryDate: expiryDate
        )

        let data = try JSONEncoder().encode(pass)
        let decoded = try JSONDecoder().decode(ProviderRidePass.self, from: data)

        XCTAssertEqual(decoded, pass)
    }

    func testRidePriceEstimateSaturatesInsteadOfOverflowing() {
        let quote = RidePriceEstimator.quote(
            pricing: ScooterRidePricing(
                currency: "CHF",
                unlockFeeMinorUnits: Int.max,
                minuteFeeMinorUnits: Int.max
            ),
            durationMinutes: 30
        )

        XCTAssertEqual(quote.grossMinorUnits, Int.max)
        XCTAssertEqual(quote.totalMinorUnits, Int.max)
        XCTAssertFalse(quote.passApplied)
    }

    private var standardPricing: ScooterRidePricing {
        ScooterRidePricing(
            currency: "CHF",
            unlockFeeMinorUnits: 100,
            minuteFeeMinorUnits: 42
        )
    }

    private func makeScooter(
        provider: String = "lime",
        latitude: Double = 47.3769,
        longitude: Double = 8.5417,
        rangeMeters: Int? = 1_000,
        vehicleID: String? = "vehicle",
        serverDistance: Double = 100
    ) throws -> Scooter {
        Scooter(
            provider: provider,
            latitude: latitude,
            longitude: longitude,
            battery: 75,
            rangeMeters: rangeMeters,
            vehicleID: vehicleID,
            deepLink: nil,
            rentalURIs: nil,
            distanceMeters: serverDistance
        )
    }
}

// Freshness, provider health and the dock.
extension ScooterModelsTests {
    func testBatteryLevelIsGoodFromFiftyLowFromTwentyAndCriticalBelow() throws {
        let levels: [(Int, ScooterBatteryLevel)] = [
            (100, .good), (50, .good), (49, .low), (20, .low), (19, .critical), (0, .critical)
        ]
        for (percent, level) in levels {
            XCTAssertEqual(ScooterBatteryLevel(percent: percent), level, "\(percent)%")
        }

        XCTAssertEqual(try makeScooter().batteryLevel, .good)
        let unknown = Scooter(provider: "lime", latitude: 47.3769, longitude: 8.5417, battery: nil,
            rangeMeters: nil, vehicleID: "unknown", deepLink: nil, rentalURIs: nil, distanceMeters: nil)
        XCTAssertNil(unknown.batteryLevel)
    }

    func testRefreshIsDueAfterTheIntervalOrFiveSecondsBeforeExpiry() {
        let loaded = Date(timeIntervalSince1970: 1_790_000_000)

        // A normal response: the interval comes first.
        XCTAssertEqual(
            ScooterRefreshPolicy.standard.refreshDue(
                lastSuccess: loaded, refreshAfter: 60, expiresAt: loaded.addingTimeInterval(300)
            ),
            loaded.addingTimeInterval(60)
        )
        // A healthy response can arrive with seconds left: refresh before it expires.
        XCTAssertEqual(
            ScooterRefreshPolicy.standard.refreshDue(
                lastSuccess: loaded, refreshAfter: 60, expiresAt: loaded.addingTimeInterval(20)
            ),
            loaded.addingTimeInterval(15)
        )
        // City totals refresh hourly.
        XCTAssertEqual(
            ScooterRefreshPolicy.standard.refreshDue(
                lastSuccess: loaded, refreshAfter: 3_600, expiresAt: loaded.addingTimeInterval(3 * 3_600)
            ),
            loaded.addingTimeInterval(3_600)
        )
        // Nothing has loaded yet: a refresh is always due.
        XCTAssertLessThan(
            ScooterRefreshPolicy.standard.refreshDue(lastSuccess: nil, refreshAfter: 60, expiresAt: nil),
            loaded
        )
    }

    func testAutomaticAttemptsAreNeverCloserThanTenSeconds() {
        let loaded = Date(timeIntervalSince1970: 1_790_000_000)
        func nextAttempt(expiresIn: TimeInterval, lastAttemptAfter: TimeInterval) -> TimeInterval {
            ScooterRefreshPolicy.standard.nextAttempt(
                lastSuccess: loaded,
                refreshAfter: 60,
                expiresAt: loaded.addingTimeInterval(expiresIn),
                lastAttempt: loaded.addingTimeInterval(lastAttemptAfter)
            ).timeIntervalSince(loaded)
        }

        XCTAssertEqual(nextAttempt(expiresIn: 300, lastAttemptAfter: 0), 60)
        // Seconds from expiry on arrival: still ten seconds after the attempt.
        XCTAssertEqual(nextAttempt(expiresIn: 8, lastAttemptAfter: 0), 10)
        // A refresh that failed at 60 s is tried again at 70 s.
        XCTAssertEqual(nextAttempt(expiresIn: 300, lastAttemptAfter: 60), 70)
        XCTAssertEqual(ScooterRefreshPolicy.standard.minimumAttemptGap, 10)
        XCTAssertEqual(ScooterRefreshPolicy.standard.expiryLead, 5)
        XCTAssertEqual(ScooterRefreshPolicy.standard.defaultRefreshAfter, 60)

        let firstAttempt = loaded
        XCTAssertEqual(
            ScooterRefreshPolicy.standard.nextAttempt(
                lastSuccess: nil, refreshAfter: 60, expiresAt: nil, lastAttempt: firstAttempt
            ),
            firstAttempt.addingTimeInterval(10)
        )
    }

    func testFailedSourcesBecomeDownProvidersOperatingInTheViewport() {
        let failedSources = ["voi_zurich", "Bird_Basel", "velospot", "pony_fr_angers", "city-overview"]
        let health = ScooterProviderHealth(
            failedSources: failedSources,
            operating: [.bolt, .bird, .voi, .publibike],
            inView: []
        )

        XCTAssertEqual(health.downProviders, [.bird, .voi, .publibike])
        XCTAssertTrue(health.hasUnknownFailures)

        // A provider whose scooters are in view is sharing data, whatever feed of its failed.
        let partlyInView = ScooterProviderHealth(
            failedSources: failedSources,
            operating: [.bolt, .bird, .voi, .publibike],
            inView: [.voi, .bolt]
        )
        XCTAssertEqual(partlyInView.downProviders, [.bird, .publibike])

        XCTAssertEqual(
            ScooterProviderHealth(failedSources: [], operating: ScooterProvider.allCases, inView: []),
            .healthy
        )
        // A source prefix does not hide the provider behind it.
        XCTAssertEqual(ScooterProviderHealth.provider(forSource: "france:dott_fr_lyon"), .dott)
        XCTAssertNil(ScooterProviderHealth.provider(forSource: "national"))
    }

    func testDockNoticesNameProvidersThenTruncationThenParking() {
        let metadata = ScooterResponseMetadata(
            partial: true, failedSources: ["bird_zurich"], truncated: true,
            totalVehicles: 5_412, parkingStatus: "partial"
        )
        let oneDown = ScooterProviderHealth(downProviders: [.bird], hasUnknownFailures: true)

        XCTAssertEqual(
            ScooterDockNotice.notices(health: oneDown, metadata: metadata, shownCount: 2_000),
            [.providersDown([.bird]), .truncated(shown: 2_000, total: 5_412), .parkingUnavailable]
        )
        XCTAssertEqual(
            ScooterDockNotice.notices(
                health: ScooterProviderHealth(downProviders: [], hasUnknownFailures: true),
                metadata: ScooterResponseMetadata(partial: true, failedSources: ["city-overview"], parkingStatus: "stale"),
                shownCount: 0
            ),
            [.someProvidersDown, .parkingOutOfDate]
        )
        XCTAssertTrue(ScooterDockNotice.notices(
            health: .healthy,
            metadata: ScooterResponseMetadata(partial: false, failedSources: [], parkingStatus: "fresh"),
            shownCount: 12
        ).isEmpty)

        let one = ScooterDockNotice.providersDown([.bird]).text
        let two = ScooterDockNotice.providersDown([.bird, .dott]).text
        let many = ScooterDockNotice.providersDown([.bird, .dott, .lime]).text
        XCTAssertTrue(one.contains("Bird"))
        XCTAssertTrue(two.contains("Bird") && two.contains("Dott"))
        XCTAssertTrue(many.contains("3"))
        XCTAssertFalse(many.contains("Bird"))
        XCTAssertEqual(Set([one, two, many, ScooterDockNotice.someProvidersDown.text]).count, 4)

        let truncated = ScooterDockNotice.truncated(shown: 2_000, total: 5_412).text
        XCTAssertTrue(truncated.contains(2_000.formatted()))
        XCTAssertTrue(truncated.contains(5_412.formatted()))
        XCTAssertNotEqual(
            ScooterDockNotice.parkingUnavailable.text,
            ScooterDockNotice.parkingOutOfDate.text
        )
    }

    func testDockStatusPrefersFailureThenDelayThenCityTotalsThenAge() {
        let updated = Date(timeIntervalSince1970: 1_790_000_000)
        func summary(
            failure: ScooterLoadFailure? = nil,
            overview: Bool = false,
            delayed: Bool = false
        ) -> ScooterDockSummary {
            ScooterDockSummary(
                count: 22, countContext: .nearby, lastUpdated: updated, refreshFailure: failure,
                isOverview: overview, isDelayed: delayed, notices: [], hint: nil, chips: []
            )
        }
        func status(after seconds: TimeInterval) -> ScooterDockStatus {
            summary().status(at: updated.addingTimeInterval(seconds))
        }

        XCTAssertEqual(status(after: 0), .live)
        XCTAssertEqual(status(after: 89), .live)
        XCTAssertEqual(status(after: 90), .updatedMinutesAgo(1))
        XCTAssertEqual(status(after: 150), .updatedMinutesAgo(2))
        XCTAssertEqual(status(after: 3_599), .updatedMinutesAgo(59))
        XCTAssertEqual(status(after: 3_600), .updatedAt(updated))
        // A clock that runs behind the server still reads as live.
        XCTAssertEqual(status(after: -30), .live)

        let later = updated.addingTimeInterval(600)
        XCTAssertEqual(summary(delayed: true).status(at: later), .delayed(showing: updated))
        XCTAssertEqual(summary(overview: true).status(at: later), .cityTotals)
        XCTAssertEqual(summary(overview: true, delayed: true).status(at: later), .delayed(showing: updated))
        XCTAssertEqual(
            summary(failure: .offline, overview: true, delayed: true).status(at: later),
            .offline(showing: updated)
        )
        for failure in ScooterLoadFailure.allCases where failure != .offline {
            XCTAssertEqual(summary(failure: failure).status(at: later), .refreshFailed(showing: updated))
        }
        XCTAssertTrue(summary(failure: .busy).showsTryAgain)
        XCTAssertFalse(summary().showsTryAgain)
    }

    func testDockStatusTextCarriesTheTimeOrTheMinutes() {
        let updated = Date(timeIntervalSince1970: 1_790_000_000)
        let time = ScooterDockStatus.clockTime(updated)

        XCTAssertFalse(time.isEmpty)
        for status in [
            ScooterDockStatus.refreshFailed(showing: updated),
            .offline(showing: updated),
            .delayed(showing: updated),
            .updatedAt(updated)
        ] {
            XCTAssertTrue(status.text.contains(time), status.text)
        }
        XCTAssertTrue(ScooterDockStatus.updatedMinutesAgo(7).text.contains("7"))
        XCTAssertEqual(ScooterDockStatus.live.text, String(localized: "Live"))
        XCTAssertEqual(ScooterDockStatus.cityTotals.text, String(localized: "City totals · refreshed hourly"))

        XCTAssertTrue(ScooterDockStatus.live.isLive)
        XCTAssertFalse(ScooterDockStatus.updatedMinutesAgo(2).isLive)
        XCTAssertTrue(ScooterDockStatus.refreshFailed(showing: updated).isWarning)
        XCTAssertTrue(ScooterDockStatus.offline(showing: updated).isWarning)
        XCTAssertFalse(ScooterDockStatus.delayed(showing: updated).isWarning)

        let body = ScooterDockStatus.outOfDateBody(.offline, lastUpdate: updated)
        XCTAssertTrue(body.contains(time))
        XCTAssertTrue(body.hasSuffix(ScooterLoadFailure.offline.message))
    }

    func testCountLabelsHaveSingularAndPluralFormsForBothContexts() {
        XCTAssertEqual(ScooterCountContext.nearby.label(for: 1), String(localized: "scooter nearby"))
        XCTAssertEqual(ScooterCountContext.nearby.label(for: 22), String(localized: "scooters nearby"))
        XCTAssertEqual(ScooterCountContext.nearby.label(for: 0), String(localized: "scooters nearby"))
        XCTAssertEqual(ScooterCountContext.onThisMap.label(for: 1), String(localized: "scooter on this map"))
        XCTAssertEqual(ScooterCountContext.onThisMap.label(for: 2), String(localized: "scooters on this map"))
        XCTAssertNotEqual(ScooterDockHint.tapCity.text, ScooterDockHint.emptyArea.text)

        // French counts nothing in the singular: "0 trottinette à proximité".
        XCTAssertEqual([0, 1, 2].map { ScooterPlural.isSingular($0, language: "fr") }, [true, true, false])
        for language in ["en", "de", "it"] {
            XCTAssertEqual(
                [0, 1, 2].map { ScooterPlural.isSingular($0, language: language) },
                [false, true, false],
                language
            )
        }
        XCTAssertEqual(
            ScooterCountContext.nearby.label(for: 0, language: "fr"),
            String(localized: "scooter nearby")
        )
        XCTAssertEqual(
            ScooterCountContext.onThisMap.label(for: 0, language: "fr"),
            String(localized: "scooter on this map")
        )
        XCTAssertEqual(
            ScooterCountContext.onThisMap.label(for: 2, language: "fr"),
            String(localized: "scooters on this map")
        )
        XCTAssertTrue(["en", "de", "fr", "it"].contains(ScooterPlural.language))
    }

    func testPercentagesAndTheShownStateReadAsOnTheWeb() throws {
        for language in ["en", "de", "fr", "it"] {
            let strings = try XCTUnwrap(
                Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:))
            )
            // "82%" and "Akku ab 60%", like the presets "60%+" beside them.
            XCTAssertEqual(strings.localizedString(forKey: "%lld%%", value: nil, table: nil), "%lld%%", language)
            let summary = strings.localizedString(forKey: "battery %lld%% or more", value: nil, table: nil)
            XCTAssertTrue(summary.contains("%lld%%"), "\(language): \(summary)")
            XCTAssertFalse(summary.contains(" %%"), "\(language): \(summary)")
        }
        let german = try XCTUnwrap(Bundle.main.path(forResource: "de", ofType: "lproj").flatMap(Bundle.init(path:)))
        XCTAssertEqual(german.localizedString(forKey: "Shown", value: nil, table: nil), "Eingeblendet")
        XCTAssertEqual(german.localizedString(forKey: "Hidden", value: nil, table: nil), "Ausgeblendet")
    }

    func testFrenchAndItalianNameTheOperatorWithOneWordAndFrenchShowsNothingInTheSingular() throws {
        func strings(_ language: String) throws -> Bundle {
            try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:)))
        }
        let french = try strings("fr")
        let italian = try strings("it")
        let pricing = "Pricing can vary. Confirm the final price and pass eligibility in the provider app before riding."

        XCTAssertEqual(french.localizedString(forKey: "Show 0 scooters", value: nil, table: nil), "Afficher 0 trottinette")
        XCTAssertEqual(italian.localizedString(forKey: "Show 0 scooters", value: nil, table: nil), "Mostra 0 monopattini")
        XCTAssertTrue(french.localizedString(forKey: pricing, value: nil, table: nil).contains("l’app de l’opérateur"))
        XCTAssertTrue(italian.localizedString(forKey: pricing, value: nil, table: nil).contains("nell’app dell’operatore"))
    }

    func testClosestCityLabelsShowWholeKilometres() throws {
        let lungern = GeoPoint(latitude: 46.7741, longitude: 8.1558)
        let closest = ScooterCityCatalog.nearest(to: lungern, count: 3)

        XCTAssertEqual(closest.map(\.city.name), ["Zug", "Bern", "Grenchen"])
        let zug = try XCTUnwrap(closest.first)
        XCTAssertTrue(zug.formattedDistance.contains("52"), zug.formattedDistance)
        XCTAssertFalse(zug.formattedDistance.contains("52."), zug.formattedDistance)
        XCTAssertTrue(zug.label.hasPrefix("Zug"))
        XCTAssertTrue(zug.label.hasSuffix(zug.formattedDistance))
        XCTAssertFalse(ScooterCityCatalog.contains(lungern))

        let place = zug.city.destination
        XCTAssertEqual(place.title, "Zug")
        XCTAssertEqual(place.point, zug.city.center)
        XCTAssertEqual(place.kind, .city)
        XCTAssertFalse(place.subtitle.isEmpty)
        XCTAssertNotEqual(place.subtitle, "CH")
    }

    func testParkingBayCardNamesTheProviderAndTheRule() {
        let mandatory = ScooterParking(id: "dott:bay", provider: "dott", name: "Rue Faidherbe",
            latitude: 50.6365, longitude: 3.0635, mandatory: true)
        let optional = ScooterParking(id: "lime:bay", provider: "lime", name: "Place",
            latitude: 50.6365, longitude: 3.0635, mandatory: false)

        XCTAssertEqual(mandatory.providerInfo, .dott)
        XCTAssertTrue(mandatory.bayTitle.contains("Dott"))
        XCTAssertTrue(mandatory.footnote.contains("Dott"))
        XCTAssertNotEqual(mandatory.bayTitle, mandatory.footnote)
        XCTAssertEqual(mandatory.notice, String(localized: "You must park in a bay in this zone."))
        XCTAssertEqual(optional.notice, String(localized: "Designated scooter parking."))
    }

    func testLocationCardsOfferTheActionsThatCanHelp() {
        XCTAssertNotNil(ScooterLocationIssue.denied.title)
        XCTAssertTrue(ScooterLocationIssue.denied.canOpenSettings)
        XCTAssertTrue(ScooterLocationIssue.denied.canSearchPlace)
        XCTAssertFalse(ScooterLocationIssue.denied.canRetry)

        XCTAssertNil(ScooterLocationIssue.restricted.title)
        XCTAssertFalse(ScooterLocationIssue.restricted.canOpenSettings)
        XCTAssertTrue(ScooterLocationIssue.restricted.canSearchPlace)

        XCTAssertNil(ScooterLocationIssue.notFound.title)
        XCTAssertTrue(ScooterLocationIssue.notFound.canRetry)
        XCTAssertFalse(ScooterLocationIssue.notFound.canSearchPlace)

        let messages = [ScooterLocationIssue.denied, .restricted, .notFound].map(\.message)
        XCTAssertEqual(Set(messages).count, 3)
    }

    func testSearchBarStatesHaveTheirOwnLines() {
        let place = MapDestination(title: "Zürich HB", point: GeoPoint(latitude: 47.3782, longitude: 8.5402))

        XCTAssertNil(ScooterSearchBarState.empty.subtitle)
        XCTAssertNil(ScooterSearchBarState.locating.subtitle)
        XCTAssertEqual(ScooterSearchBarState.place(place).title, "Zürich HB")
        XCTAssertNotNil(ScooterSearchBarState.place(place).subtitle)
        XCTAssertTrue(ScooterSearchBarState.place(place).accessibilityLabel.contains("Zürich HB"))
        XCTAssertEqual(place.subtitle, "")
        XCTAssertEqual(place.kind, .address)
    }

    func testSearchBarPromisesScootersOnlyWhereThereIsScooterData() throws {
        let zurich = MapDestination(title: "Zürich HB", point: GeoPoint(latitude: 47.3782, longitude: 8.5402))
        let lungern = MapDestination(title: "Paradeplatz", point: GeoPoint(latitude: 46.7741, longitude: 8.1558))
        let neutral = String(localized: "Tap to search a city or address")

        // The service areas bundled with the app decide when the search did not say.
        XCTAssertTrue(zurich.isCovered)
        XCTAssertFalse(lungern.isCovered)

        let served = ScooterSearchBarState.place(zurich)
        XCTAssertEqual(served.subtitle, String(localized: "Scooters near this place"))
        XCTAssertNotEqual(served.subtitle, neutral)

        // Where no operator shares data the bar keeps to the neutral line, also for VoiceOver.
        let unserved = ScooterSearchBarState.place(lungern)
        XCTAssertEqual(unserved.subtitle, neutral)
        XCTAssertEqual(unserved.accessibilityLabel, "Paradeplatz. \(neutral)")
        XCTAssertEqual(
            served.accessibilityLabel,
            String(format: String(localized: "Showing scooters near %@. Search another place."), "Zürich HB")
        )

        // The search's own answer wins over the bundled areas, and a covered city is always served.
        let reportedUnserved = MapDestination(title: "Zürich HB", point: zurich.point, isCovered: false)
        XCTAssertEqual(ScooterSearchBarState.place(reportedUnserved).subtitle, neutral)
        let city = try XCTUnwrap(ScooterCityCatalog.cities.first)
        XCTAssertTrue(city.destination.isCovered)
    }
}
