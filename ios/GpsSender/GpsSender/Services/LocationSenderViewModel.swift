import Combine
import CoreLocation
import Foundation

@MainActor
final class LocationSenderViewModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var configuration = SenderConfiguration()
    @Published var isSending = false
    @Published var status = "未开始"
    @Published var latestLocation = "尚无定位"

    private let manager = CLLocationManager()
    private let transport = GpsTransport()
    private var queue = RealtimeSendQueue()
    private var stream: StreamSession?
    private var lastNetworkStart = Date.distantPast
    private let defaults = UserDefaults.standard
    private let keychainService = "com.navigation-system.GpsSender"

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 2
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
        manager.stopUpdatingLocation()
        queue = RealtimeSendQueue()
        stream = nil
        isSending = false
        status = "已停止；下次开始将使用新的 stream"
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if isSending && manager.authorizationStatus == .authorizedWhenInUse {
            manager.startUpdatingLocation(); status = "正在发送"
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            status = "定位权限未授予"
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isSending, let location = locations.last, let stream else { return }
        let now = Date()
        guard now.timeIntervalSince(location.timestamp) <= 10,
              location.timestamp.timeIntervalSince(now) <= 5,
              let payload = GpsFixPayload(location: location, deviceID: configuration.deviceID, stream: stream, sequence: stream.nextSequence()) else { return }
        latestLocation = String(format: "%.6f, %.6f（±%.1fm）", payload.lat, payload.lon, payload.accuracyM)
        queue.enqueue(PendingGpsFix(payload: payload), now: now)
        sendLatestIfAllowed()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { status = "定位错误：\(error.localizedDescription)" }

    private func sendLatestIfAllowed() {
        let now = Date()
        guard now.timeIntervalSince(lastNetworkStart) >= 0.5, let pending = queue.newest(now: now) else { return }
        lastNetworkStart = now
        Task {
            do {
                try await transport.send(pending.payload, configuration: configuration)
                queue.remove(sequence: pending.sequence)
                status = "已发送 #\(pending.sequence)"
            } catch {
                switch queue.registerFailure(sequence: pending.sequence, now: Date()) {
                case .retry(let delay):
                    status = "网络失败，短暂重试"
                    try? await Task.sleep(for: .seconds(delay))
                    sendLatestIfAllowed()
                case .drop:
                    status = "报文已丢弃，等待最新定位"
                }
            }
        }
    }
}
