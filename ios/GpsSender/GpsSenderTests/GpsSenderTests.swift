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
    
    func testQueueReturnsNewestPendingFixAfterRateLimitWindow() {
        var queue = RealtimeSendQueue(capacity: 20)
        let baseTime = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue sequence 0
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: baseTime), now: baseTime)
        
        // Simulate rate limit: try to get newest immediately (should return seq 0)
        XCTAssertEqual(queue.newest(now: baseTime)?.sequence, 0)
        
        // Remove sequence 0 after "sending"
        queue.remove(sequence: 0)
        
        // Enqueue sequence 1 shortly after
        let later = baseTime.addingTimeInterval(0.1)
        queue.enqueue(PendingGpsFix(sequence: 1, timestamp: later), now: later)
        
        // Should still have sequence 1 available for next send
        XCTAssertEqual(queue.newest(now: later)?.sequence, 1)
    }
    
    func testQueueHandlesMultipleRapidEnqueues() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Rapidly enqueue multiple fixes
        for i in 0..<5 {
            queue.enqueue(PendingGpsFix(sequence: i, timestamp: now.addingTimeInterval(Double(i) * 0.01)), now: now)
        }
        
        // Should keep all 5 (under capacity)
        XCTAssertEqual(queue.pending.count, 5)
        
        // Newest should be sequence 4
        XCTAssertEqual(queue.newest(now: now)?.sequence, 4)
        
        // After removing newest, next newest should be sequence 3
        queue.remove(sequence: 4)
        XCTAssertEqual(queue.newest(now: now)?.sequence, 3)
    }
}
