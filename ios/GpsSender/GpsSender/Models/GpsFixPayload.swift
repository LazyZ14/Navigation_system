import CoreLocation
import Foundation

final class StreamSession {
    let streamID = UUID()
    private var sequence = 0

    static func start() -> StreamSession { StreamSession() }

    func nextSequence() -> Int {
        defer { sequence += 1 }
        return sequence
    }
}

struct GpsFixPayload: Codable, Identifiable, Equatable {
    let schemaVersion = 1
    let deviceID: String
    let streamID: UUID
    let sequence: Int
    let lat: Double
    let lon: Double
    let accuracyM: Double
    let speedMps: Double?
    let headingDeg: Double?
    let timestamp: Date

    var id: String { "\(streamID.uuidString)-\(sequence)" }

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version", deviceID = "device_id", streamID = "stream_id"
        case sequence, lat, lon, accuracyM = "accuracy_m", speedMps = "speed_mps"
        case headingDeg = "heading_deg", timestamp
    }

    init?(location: CLLocation, deviceID: String, stream: StreamSession, sequence: Int) {
        guard location.horizontalAccuracy >= 0,
              location.coordinate.latitude.isFinite,
              location.coordinate.longitude.isFinite,
              (-90...90).contains(location.coordinate.latitude),
              (-180...180).contains(location.coordinate.longitude) else { return nil }
        self.deviceID = deviceID
        self.streamID = stream.streamID
        self.sequence = sequence
        self.lat = location.coordinate.latitude
        self.lon = location.coordinate.longitude
        self.accuracyM = location.horizontalAccuracy
        self.speedMps = location.speed >= 0 ? location.speed : nil
        self.headingDeg = location.course >= 0 && location.course < 360 ? location.course : nil
        self.timestamp = location.timestamp
    }

    init(deviceID: String, streamID: UUID, sequence: Int, lat: Double, lon: Double, accuracyM: Double, timestamp: Date) {
        self.deviceID = deviceID; self.streamID = streamID; self.sequence = sequence
        self.lat = lat; self.lon = lon; self.accuracyM = accuracyM; self.speedMps = nil; self.headingDeg = nil; self.timestamp = timestamp
    }
}
