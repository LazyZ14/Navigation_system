import CoreLocation
import Foundation

@MainActor
final class LocationRecorder: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var isRecording = false
    @Published var sampleCount = 0
    @Published var recordingDuration: TimeInterval = 0
    @Published var lastLocationTime: Date?
    @Published var errorCount = 0
    @Published var statusMessage = "未开始录制"
    
    private let manager = CLLocationManager()
    private var session: GpsRecordingSession?
    private var fileHandle: FileHandle?
    private var startTime: Date?
    private var timer: Timer?
    private let fileManager = FileManager.default
    
    // App-specific directory for recordings
    private var recordingsDirectory: URL? {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("GPS_Recordings")
    }
    
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.pausesLocationUpdatesAutomatically = false
        
        // Create recordings directory if needed
        if let dir = recordingsDirectory {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }
    
    func startRecording() {
        guard !isRecording else { return }
        
        // Create new session
        session = GpsRecordingSession()
        startTime = Date()
        sampleCount = 0
        errorCount = 0
        
        // Open file for writing
        if let session = session, let dir = recordingsDirectory {
            let filename = "\(session.sessionID).jsonl"
            let fileURL = dir.appendingPathComponent(filename)
            
            // Create initial metadata JSON
            let metadata: [String: Any] = [
                "type": "recording_session",
                "session_id": session.sessionID,
                "start_time": ISO8601DateFormatter().string(from: session.startTime),
                "device_model": session.deviceModel,
                "os_version": session.osVersion
            ]
            
            if let metadataData = try? JSONSerialization.data(withJSONObject: metadata),
               let metadataLine = String(data: metadataData, encoding: .utf8) {
                // Write metadata as first line
                try? metadataLine.write(to: fileURL, atomically: true, encoding: .utf8)
            }
            
            // Open file handle for appending
            fileHandle = try? FileHandle(forWritingTo: fileURL)
            fileHandle?.seekToEndOfFile()
        }
        
        isRecording = true
        statusMessage = "正在请求定位权限"
        
        // Start location updates
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.startUpdatingLocation()
            statusMessage = "录制中"
            
            // Start duration timer
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    self?.updateDuration()
                }
            }
        }
    }
    
    func stopRecording() {
        guard isRecording else { return }
        
        manager.stopUpdatingLocation()
        isRecording = false
        timer?.invalidate()
        timer = nil
        
        // Update session end time
        if var session = session {
            session.endTime = Date()
            self.session = session
            
            // Write end metadata
            if let dir = recordingsDirectory {
                let filename = "\(session.sessionID).jsonl"
                let fileURL = dir.appendingPathComponent(filename)
                
                let endMetadata: [String: Any] = [
                    "type": "recording_end",
                    "session_id": session.sessionID,
                    "end_time": ISO8601DateFormatter().string(from: session.endTime ?? Date()),
                    "sample_count": sampleCount
                ]
                
                if let metadataData = try? JSONSerialization.data(withJSONObject: endMetadata),
                   let metadataLine = String(data: metadataData, encoding: .utf8) {
                    try? "\n\(metadataLine)".write(to: fileURL, atomically: true, encoding: .utf8)
                }
            }
        }
        
        // Close file handle
        fileHandle?.closeFile()
        fileHandle = nil
        
        statusMessage = "已保存 \(sampleCount) 个样本"
    }
    
    func getRecordingFiles() -> [URL] {
        guard let dir = recordingsDirectory else { return [] }
        return (try? fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
            .filter { $0.pathExtension == "jsonl" }
            .sorted(by: { $0.creationDate ?? Date.distantPast > $1.creationDate ?? Date.distantPast }) ?? []
    }
    
    func deleteRecording(at url: URL) {
        try? fileManager.removeItem(at: url)
    }
    
    // MARK: - CLLocationManagerDelegate
    
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if isRecording && (manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways) {
                manager.startUpdatingLocation()
                statusMessage = "录制中"
            } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                statusMessage = "定位权限未授予"
                stopRecording()
            }
        }
    }
    
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            guard isRecording, let location = locations.last else { return }
            
            let now = Date()
            let locationAge = now.timeIntervalSince(location.timestamp)
            
            // Filter out stale locations (>10s old)
            guard locationAge <= 10 else {
                errorCount += 1
                return
            }
            
            // Create GPS fix payload
            let payload: [String: Any?] = [
                "type": "gps_fix",
                "lat": location.coordinate.latitude,
                "lon": location.coordinate.longitude,
                "timestamp": ISO8601DateFormatter().string(from: location.timestamp),
                "received_at": ISO8601DateFormatter().string(from: now),
                "accuracy_m": location.horizontalAccuracy,
                "speed_mps": location.speed >= 0 ? location.speed : nil,
                "heading_deg": location.course >= 0 ? location.course : nil,
                "altitude_m": location.altitude,
                "location_age_s": locationAge
            ]
            
            // Write to file incrementally
            if let data = try? JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 }),
               let line = String(data: data, encoding: .utf8) {
                do {
                    try fileHandle?.write(contentsOf: (line + "\n").data(using: .utf8)!)
                    sampleCount += 1
                    lastLocationTime = now
                    statusMessage = "录制中 · \(sampleCount) 样本"
                } catch {
                    errorCount += 1
                    statusMessage = "写入失败"
                }
            }
        }
    }
    
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            errorCount += 1
            statusMessage = "定位错误：\(error.localizedDescription)"
        }
    }
    
    // MARK: - Private
    
    private func updateDuration() {
        if let startTime = startTime {
            recordingDuration = Date().timeIntervalSince(startTime)
        }
    }
}
