import Foundation

struct SenderConfiguration: Equatable {
    var host = ""
    var port = "8000"
    var deviceID = ""
    var token = ""

    var endpoint: URL? { URL(string: "http://\(host):\(port)/api/gps/fixes") }
}

enum TransportError: Error { case invalidEndpoint, rejected(Int) }

struct GpsTransport {
    func send(_ payload: GpsFixPayload, configuration: SenderConfiguration) async throws {
        guard let url = configuration.endpoint else { throw TransportError.invalidEndpoint }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder.gpsEncoder.encode(payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else {
            throw TransportError.rejected((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
}

extension JSONEncoder {
    static let gpsEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()
}
