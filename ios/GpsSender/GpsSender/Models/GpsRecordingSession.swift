import Foundation

struct GpsRecordingSession: Codable {
    let sessionID: String
    let startTime: Date
    var endTime: Date?
    let deviceModel: String
    let osVersion: String
    
    init() {
        self.sessionID = UUID().uuidString
        self.startTime = Date()
        self.deviceModel = UIDevice.current.model
        self.osVersion = "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
    }
}
