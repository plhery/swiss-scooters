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
        XCTAssertFalse(scooter.formattedDistance(
            from: GeoPoint(latitude: 47.3769, longitude: 8.5417)
        ).isEmpty)
    }

    func testRangeFormattingOnlyExistsWhenRangeIsProvided() throws {
        XCTAssertNotNil(try makeScooter(rangeMeters: 1_500).formattedRange)
        XCTAssertNil(try makeScooter(rangeMeters: nil).formattedRange)
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
