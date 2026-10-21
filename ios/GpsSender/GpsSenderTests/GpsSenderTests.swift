import CoreLocation
import XCTest
@testable import GpsSender

final class GpsSenderTests: XCTestCase {
    func testNewStreamStartsAtSequenceZeroAndRestartChangesStream() {
        let first = StreamSession.start()
        let second = StreamSession.start()

        XCTAssertEqual(first.nextSequence(), 0)
        XCTAssertEqual(first.nextSequence(), 1)
        XCTAssertNotEqual(first.streamID, second.streamID)
        XCTAssertEqual(second.nextSequence(), 0)
    }

    func testInvalidCoreLocationSpeedAndCourseBecomeNil() {
        let location = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 39.9042, longitude: 116.4074),
            altitude: 0,
            horizontalAccuracy: 8,
            verticalAccuracy: -1,
            course: -1,
            speed: -1,
            timestamp: Date()
        )

        let payload = GpsFixPayload(location: location, deviceID: "ios-test", stream: StreamSession.start(), sequence: 0)

        XCTAssertNil(payload?.speedMps)
        XCTAssertNil(payload?.headingDeg)
    }

    func testQueueKeepsNewestTwentyAndDropsExpiredFixes() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)

        for sequence in 0...20 {
            queue.enqueue(PendingGpsFix(sequence: sequence, timestamp: now), now: now)
        }
        queue.enqueue(PendingGpsFix(sequence: 99, timestamp: now.addingTimeInterval(-11)), now: now)

        XCTAssertEqual(queue.pendingSequences, Array(1...20))
    }

    func testRetryRetainsFreshFixButDropsItAfterMaximumAttempts() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 7, timestamp: now), now: now)

        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now), .retry(after: 0.5))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now), .retry(after: 1.0))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now), .retry(after: 2.0))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now), .drop)
        XCTAssertTrue(queue.pendingSequences.isEmpty)
    }
}
