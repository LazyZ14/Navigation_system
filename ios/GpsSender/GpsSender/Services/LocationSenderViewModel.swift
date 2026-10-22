import Combine
import CoreLocation
import Foundation

@MainActor
final class LocationSenderViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var configuration = SenderConfiguration()
    @Published var isSending = false
    @Published var status = "未开始"
    @Published var latestLocation = "尚无定位"
    
    // Diagnostic state
    @Published var lastLocationCallbackTime: Date?
    @Published var lastEnqueueTime: Date?
    @Published var lastSendSuccessTime: Date?
    @Published var pendingCount: Int = 0
    @Published var lastHttpStatusCode: Int?

    private let manager = CLLocationManager()
    private let transport = GpsTransport()
    private var queue = RealtimeSendQueue()
    private var stream: StreamSession?
    private var lastNetworkStart = Date.distantPast
    private var lastLocationUpdate = Date.distantPast
    private var lastSendTime = Date.distantPast
    private var sendTask: Task<Void, Never>?
    private let defaults = UserDefaults.standard
    private let keychainService = "com.navigation-system.GpsSender"

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 2
        manager.pausesLocationUpdatesAutomatically = false
        configuration.host = defaults.string(forKey: "gpsHost") ?? ""
        configuration.port = defaults.string(forKey: "gpsPort") ?? "8000"
        configuration.deviceID = defaults.string(forKey: "gpsDeviceID") ?? "ios-\(UUID().uuidString)"
        configuration.token = KeychainStore.read(service: keychainService, account: "device-token") ?? ""
        defaults.set(configuration.deviceID, forKey: "gpsDeviceID")
    }

    func saveConfiguration() {
        defaults.set(configuration.host, forKey: "gpsHost")
        defaults.set(configuration.port, forKey: "gpsPort")
        KeychainStore.save(configuration.token, service: keychainService, account: "device-token")
    }

    func start() {
        saveConfiguration()
        guard !configuration.host.isEmpty, !configuration.token.isEmpty else { status = "请填写主机地址和设备令牌"; return }
        stream = .start()
        queue = RealtimeSendQueue()
        isSending = true
        status = "正在请求前台定位权限"
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse { manager.startUpdatingLocation(); status = "正在发送" }
    }

    func stop() {
        // Cancel any active send task
        sendTask?.cancel()
        sendTask = nil
        
        manager.stopUpdatingLocation()
        queue = RealtimeSendQueue()
        stream = nil
        isSending = false
        status = "已停止；下次开始将使用新的 stream"
        print("[GPS-DEBUG] Stopped sending, cancelled send task")
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        print("[GPS-DEBUG] Authorization changed: \(manager.authorizationStatus.rawValue)")
        if isSending && manager.authorizationStatus == .authorizedWhenInUse {
            print("[GPS-DEBUG] Starting location updates")
            manager.startUpdatingLocation()
            status = "正在发送"
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            print("[GPS-DEBUG] Location authorization denied or restricted")
            status = "定位权限未授予"
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isSending, let location = locations.last, let stream else { return }
        let now = Date()
        lastLocationUpdate = now
        lastLocationCallbackTime = now
        
        print("[GPS-DEBUG] Location update: lat=\(location.coordinate.latitude), lon=\(location.coordinate.longitude), timestamp=\(location.timestamp), age=\(now.timeIntervalSince(location.timestamp))s")
        
        guard now.timeIntervalSince(location.timestamp) <= 10,
              location.timestamp.timeIntervalSince(now) <= 5,
              let payload = GpsFixPayload(location: location, deviceID: configuration.deviceID, stream: stream, sequence: stream.nextSequence()) else {
            print("[GPS-DEBUG] Location rejected: stale or invalid")
            return
        }
        
        latestLocation = String(format: "%.6f, %.6f（±%.1fm）", payload.lat, payload.lon, payload.accuracyM)
        print("[GPS-DEBUG] Enqueued fix: sequence=\(payload.sequence)")
        lastEnqueueTime = now
        
        queue.enqueue(PendingGpsFix(payload: payload), now: now)
        pendingCount = queue.pending.count
        scheduleSendIfIdle()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[GPS-DEBUG] Location error: \(error.localizedDescription)")
        status = "定位错误：\(error.localizedDescription)"
    }
    
    private func scheduleSendIfIdle() {
        // Only start a new send task if none is currently active
        guard sendTask == nil || sendTask?.isCancelled == true else {
            print("[GPS-DEBUG] Send task already active, queue will be drained by existing consumer")
            return
        }
        
        // Start a new consumer task
        sendTask = Task { [weak self] in
            guard let self = self else { return }
            await self.drainQueue()
        }
    }
    
    @MainActor
    private func drainQueue() async {
        while !Task.isCancelled {
            let now = Date()
            
            // Check if there's anything to send
            guard let pending = queue.newest(now: now) else {
                print("[GPS-DEBUG] Queue empty, stopping consumer")
                break
            }
            
            // Enforce rate limit by waiting if needed
            let timeSinceLastSend = now.timeIntervalSince(lastNetworkStart)
            if timeSinceLastSend < 0.5 {
                let waitTime = 0.5 - timeSinceLastSend
                print("[GPS-DEBUG] Rate limit active, waiting \(String(format: "%.2f", waitTime))s before sending sequence=\(pending.sequence)")
                try? await Task.sleep(for: .seconds(waitTime))
                
                // Re-check cancellation after waiting
                if Task.isCancelled { break }
                
                // Re-fetch newest in case it changed during wait
                guard let latestPending = queue.newest(now: Date()) else { continue }
                await sendFix(latestPending)
            } else {
                await sendFix(pending)
            }
        }
        
        // Mark task as completed
        sendTask = nil
    }
    
    @MainActor
    private func sendFix(_ pending: PendingGpsFix) async {
        let now = Date()
        print("[GPS-DEBUG] Sending: sequence=\(pending.sequence), age=\(now.timeIntervalSince(pending.timestamp))s")
        lastNetworkStart = now
        lastSendTime = now
        
        do {
            try await transport.send(pending.payload, configuration: configuration)
            // Successfully sent: remove this sequence and discard all older ones
            queue.remove(sequence: pending.sequence)
            queue.discardOlder(than: pending.sequence)
            pendingCount = queue.pending.count
            lastSendSuccessTime = now
            status = "已发送 #\(pending.sequence)"
            print("[GPS-DEBUG] Send success: sequence=\(pending.sequence)")
        } catch let error as TransportError {
            // Capture status code for diagnostics
            switch error {
            case .unauthorized:
                lastHttpStatusCode = 401
            case .conflict:
                lastHttpStatusCode = 409
            case .unprocessable:
                lastHttpStatusCode = 422
            case .other(let code):
                lastHttpStatusCode = code
            case .networkTimeout, .invalidEndpoint:
                lastHttpStatusCode = nil
            }
            
            print("[GPS-DEBUG] Send failed: sequence=\(pending.sequence), error=\(error)")
            switch queue.registerFailure(sequence: pending.sequence, now: Date(), error: error) {
            case .retry(let delay):
                status = "网络失败，短暂重试"
                try? await Task.sleep(for: .seconds(delay))
                // Retry will happen naturally as drainQueue loops
            case .drop:
                status = "报文已丢弃，等待最新定位"
                print("[GPS-DEBUG] Fix dropped after max retries or protocol error")
            }
        } catch {
            // Unexpected error type
            print("[GPS-DEBUG] Send failed with unexpected error: sequence=\(pending.sequence), error=\(error)")
            status = "未知错误"
        }
    }
}
