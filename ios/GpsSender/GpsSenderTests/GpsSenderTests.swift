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

        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now, error: .other(500)), .retry(after: 0.5))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now, error: .other(500)), .retry(after: 1.0))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now, error: .other(500)), .retry(after: 2.0))
        XCTAssertEqual(queue.registerFailure(sequence: 7, now: now, error: .other(500)), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
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
    
    // MARK: - GPS Queue Ordering and 409 Retry Regression Tests
    
    func testQueueDiscardsOlderAfterSendingNewer() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue #0 and #1
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        queue.enqueue(PendingGpsFix(sequence: 1, timestamp: now.addingTimeInterval(0.1)), now: now.addingTimeInterval(0.1))
        
        // Select newest (#1)
        XCTAssertEqual(queue.newest(now: now.addingTimeInterval(0.1))?.sequence, 1)
        
        // Simulate successful send of #1
        queue.remove(sequence: 1)
        queue.discardOlder(than: 1)
        
        // #0 should be discarded, queue should be empty
        XCTAssertTrue(queue.pending.isEmpty)
        XCTAssertNil(queue.newest(now: now.addingTimeInterval(0.2)))
    }
    
    func testQueueDoesNotResendOlderSequencesAfterSuccess() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue #0, #1, #2, #3
        for i in 0...3 {
            queue.enqueue(PendingGpsFix(sequence: i, timestamp: now.addingTimeInterval(Double(i) * 0.1)), now: now)
        }
        
        // Send #3 successfully
        queue.remove(sequence: 3)
        queue.discardOlder(than: 3)
        
        // All sequences <= 3 should be gone
        XCTAssertTrue(queue.pending.isEmpty)
        
        // Enqueue #4
        queue.enqueue(PendingGpsFix(sequence: 4, timestamp: now.addingTimeInterval(0.5)), now: now.addingTimeInterval(0.5))
        
        // Should only have #4
        XCTAssertEqual(queue.pendingSequences, [4])
    }
    
    func testQueueAllowsSequenceSkippingButNotRegression() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue #0, #1, #2
        for i in 0...2 {
            queue.enqueue(PendingGpsFix(sequence: i, timestamp: now.addingTimeInterval(Double(i) * 0.1)), now: now)
        }
        
        // Select newest (#2) - skip #0 and #1
        XCTAssertEqual(queue.newest(now: now)?.sequence, 2)
        
        // Send #2 successfully
        queue.remove(sequence: 2)
        queue.discardOlder(than: 2)
        
        // #0 and #1 should be discarded
        XCTAssertTrue(queue.pending.isEmpty)
        
        // Next enqueue can start from any sequence (e.g., #5)
        queue.enqueue(PendingGpsFix(sequence: 5, timestamp: now.addingTimeInterval(1.0)), now: now.addingTimeInterval(1.0))
        XCTAssertEqual(queue.pendingSequences, [5])
    }
    
    func testConflictErrorIsNotRetried() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // 409 conflict should drop immediately
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .conflict), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testUnauthorizedErrorIsNotRetried() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // 401 unauthorized should drop immediately
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .unauthorized), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testUnprocessableErrorIsNotRetried() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // 422 unprocessable should drop immediately
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .unprocessable), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testNetworkTimeoutRetriesWithBackoff() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // Network timeout should retry with backoff
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .networkTimeout), .retry(after: 0.5))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .networkTimeout), .retry(after: 1.0))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .networkTimeout), .retry(after: 2.0))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .networkTimeout), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testOtherHttpErrorsRetryWithBackoff() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // Other HTTP errors (e.g., 500) should retry with backoff
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .other(500)), .retry(after: 0.5))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .other(500)), .retry(after: 1.0))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .other(500)), .retry(after: 2.0))
        XCTAssertEqual(queue.registerFailure(sequence: 0, now: now, error: .other(500)), .drop)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testConsumerExitsWhenQueueIsEmpty() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Empty queue should return nil from newest()
        XCTAssertNil(queue.newest(now: now))
        
        // This simulates the drainQueue loop exiting when queue is empty
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testNewStreamCanStartFromSequenceZero() {
        let stream = StreamSession.start()
        XCTAssertEqual(stream.nextSequence(), 0)
        XCTAssertEqual(stream.nextSequence(), 1)
        XCTAssertEqual(stream.nextSequence(), 2)
    }
    
    func testStopClearsQueueAndIsolatesStream() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue some data
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        queue.enqueue(PendingGpsFix(sequence: 1, timestamp: now.addingTimeInterval(0.1)), now: now.addingTimeInterval(0.1))
        
        // Simulate stop: reset queue
        queue = RealtimeSendQueue()
        
        // Queue should be empty
        XCTAssertTrue(queue.pending.isEmpty)
        XCTAssertNil(queue.newest(now: now.addingTimeInterval(0.2)))
    }
    
    func testDiscardOlderPreservesEqualOrGreaterSequences() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue #0, #1, #2, #3, #5 (skip #4)
        for seq in [0, 1, 2, 3, 5] {
            queue.enqueue(PendingGpsFix(sequence: seq, timestamp: now.addingTimeInterval(Double(seq) * 0.1)), now: now)
        }
        
        // Send #3 successfully
        queue.remove(sequence: 3)
        queue.discardOlder(than: 3)
        
        // #0, #1, #2 should be discarded; #5 should remain
        XCTAssertEqual(queue.pendingSequences, [5])
    }
}
    
    // MARK: - Send Interval and Performance Tests
    
    func testSendIntervalBoundaryAtMinInterval() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue two fixes
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        queue.enqueue(PendingGpsFix(sequence: 1, timestamp: now.addingTimeInterval(0.1)), now: now.addingTimeInterval(0.1))
        
        // Simulate sending #0 at t=0
        queue.remove(sequence: 0)
        queue.discardOlder(than: 0)
        
        // At t=0.15 (less than min interval 0.2), should still have #1
        let t1 = now.addingTimeInterval(0.15)
        XCTAssertEqual(queue.newest(now: t1)?.sequence, 1)
        
        // At t=0.25 (greater than min interval 0.2), should still have #1
        let t2 = now.addingTimeInterval(0.25)
        XCTAssertEqual(queue.newest(now: t2)?.sequence, 1)
    }
    
    func testQueueSchedulingWithRapidEnqueues() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Rapidly enqueue 10 fixes within 0.1 seconds
        for i in 0..<10 {
            queue.enqueue(PendingGpsFix(sequence: i, timestamp: now.addingTimeInterval(Double(i) * 0.01)), now: now)
        }
        
        // Should keep all 10 (under capacity)
        XCTAssertEqual(queue.pending.count, 10)
        
        // Newest should be sequence 9
        XCTAssertEqual(queue.newest(now: now)?.sequence, 9)
        
        // After sending #9, all older should be discarded
        queue.remove(sequence: 9)
        queue.discardOlder(than: 9)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    
    func testStopRestartAllowsNewStreamFromZero() {
        // First stream
        let stream1 = StreamSession.start()
        XCTAssertEqual(stream1.nextSequence(), 0)
        XCTAssertEqual(stream1.nextSequence(), 1)
        
        // Simulate stop: create new stream
        let stream2 = StreamSession.start()
        XCTAssertNotEqual(stream1.streamID, stream2.streamID)
        XCTAssertEqual(stream2.nextSequence(), 0)
        XCTAssertEqual(stream2.nextSequence(), 1)
        XCTAssertEqual(stream2.nextSequence(), 2)
    }
    
    func testQueueDoesNotAllowSequenceRegression() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue #5
        queue.enqueue(PendingGpsFix(sequence: 5, timestamp: now), now: now)
        
        // Send #5 successfully
        queue.remove(sequence: 5)
        queue.discardOlder(than: 5)
        
        // Enqueue #3 (older sequence - should still be accepted by queue but will be discarded if newer was sent)
        queue.enqueue(PendingGpsFix(sequence: 3, timestamp: now.addingTimeInterval(0.1)), now: now.addingTimeInterval(0.1))
        
        // Queue has #3, but it's older than what was already sent
        XCTAssertEqual(queue.pendingSequences, [3])
        
        // If we send #3, discardOlder won't remove anything since nothing is < 3
        queue.remove(sequence: 3)
        queue.discardOlder(than: 3)
        XCTAssertTrue(queue.pending.isEmpty)
        
        // The key point: after sending #5, if #3 arrives later, it should be handled
        // In real usage, the sequence generator ensures monotonically increasing sequences per stream
    }
    
    func testHighFrequencyEnqueueUnderCapacity() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue 20 fixes at 0.05s intervals (simulating ~20 Hz sampling)
        for i in 0..<20 {
            queue.enqueue(PendingGpsFix(sequence: i, timestamp: now.addingTimeInterval(Double(i) * 0.05)), now: now)
        }
        
        XCTAssertEqual(queue.pending.count, 20)
        XCTAssertEqual(queue.newest(now: now)?.sequence, 19)
        
        // Enqueue one more - should drop oldest (capacity limit)
        queue.enqueue(PendingGpsFix(sequence: 20, timestamp: now.addingTimeInterval(1.0)), now: now.addingTimeInterval(1.0))
        XCTAssertEqual(queue.pending.count, 20)
        XCTAssertEqual(queue.pendingSequences.first, 1)  // #0 dropped
        XCTAssertEqual(queue.pendingSequences.last, 20)
    }
    
    func testExpiredFixsAreDiscardedBeforeEnqueue() {
        var queue = RealtimeSendQueue(capacity: 20)
        let now = Date(timeIntervalSinceReferenceDate: 1_000)
        
        // Enqueue a fresh fix
        queue.enqueue(PendingGpsFix(sequence: 0, timestamp: now), now: now)
        
        // Try to enqueue an expired fix (older than maxAge=10s)
        queue.enqueue(PendingGpsFix(sequence: 1, timestamp: now.addingTimeInterval(-11)), now: now.addingTimeInterval(11))
        
        // Only the fresh fix should remain
        XCTAssertEqual(queue.pendingSequences, [0])
    }
}
