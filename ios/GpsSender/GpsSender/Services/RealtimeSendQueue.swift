import Foundation

struct PendingGpsFix: Equatable {
    var payload: GpsFixPayload
    var attempts = 0

    init(payload: GpsFixPayload) { self.payload = payload }
    init(sequence: Int, timestamp: Date) {
        self.payload = GpsFixPayload(deviceID: "test", streamID: UUID(), sequence: sequence, lat: 0, lon: 0, accuracyM: 1, timestamp: timestamp)
    }

    var sequence: Int { payload.sequence }
    var timestamp: Date { payload.timestamp }
}

enum RetryDecision: Equatable { case retry(after: TimeInterval), drop }

struct RealtimeSendQueue {
    private(set) var pending: [PendingGpsFix] = []
    let capacity: Int
    let maxAge: TimeInterval = 10
    let maxAttempts = 3

    init(capacity: Int = 20) { self.capacity = capacity }
    var pendingSequences: [Int] { pending.map(\.sequence) }

    mutating func enqueue(_ fix: PendingGpsFix, now: Date) {
        discardExpired(now: now)
        guard now.timeIntervalSince(fix.timestamp) <= maxAge else { return }
        pending.append(fix)
        while pending.count > capacity { pending.removeFirst() }
    }

    mutating func newest(now: Date) -> PendingGpsFix? {
        discardExpired(now: now)
        return pending.last
    }

    /// Discard all items with sequence strictly less than the given value.
    /// Call this after successfully sending a newer sequence to prevent re-sending stale data.
    mutating func discardOlder(than sequence: Int) {
        pending.removeAll { $0.sequence < sequence }
    }

    mutating func remove(sequence: Int) { pending.removeAll { $0.sequence == sequence } }

    mutating func registerFailure(sequence: Int, now: Date, error: TransportError) -> RetryDecision {
        discardExpired(now: now)
        
        // Protocol errors should never be retried
        switch error {
        case .unauthorized, .conflict, .unprocessable:
            pending.removeAll { $0.sequence == sequence }
            return .drop
        case .networkTimeout:
            // Network timeout: bounded retry with backoff
            guard let index = pending.lastIndex(where: { $0.sequence == sequence }) else { return .drop }
            pending[index].attempts += 1
            guard pending[index].attempts <= maxAttempts else { pending.remove(at: index); return .drop }
            let delays: [TimeInterval] = [0.5, 1.0, 2.0]
            let delay = pending[index].attempts <= delays.count ? delays[pending[index].attempts - 1] : delays.last!
            return .retry(after: delay)
        case .other(let code):
            // Other HTTP errors: treat as transient, retry with backoff
            guard let index = pending.lastIndex(where: { $0.sequence == sequence }) else { return .drop }
            pending[index].attempts += 1
            guard pending[index].attempts <= maxAttempts else { pending.remove(at: index); return .drop }
            let delays: [TimeInterval] = [0.5, 1.0, 2.0]
            let delay = pending[index].attempts <= delays.count ? delays[pending[index].attempts - 1] : delays.last!
            return .retry(after: delay)
        case .invalidEndpoint:
            return .drop
        }
    }

    private mutating func discardExpired(now: Date) {
        pending.removeAll { now.timeIntervalSince($0.timestamp) > maxAge }
    }
}
