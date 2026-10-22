import Foundation

struct SenderConfiguration: Equatable {
    var host = ""
    var port = "8000"
    var deviceID = ""
    var token = ""

    var endpoint: URL? { URL(string: "http://\(host):\(port)/api/gps/fixes") }
}

enum TransportError: Error {
    case invalidEndpoint
    case unauthorized          // 401
    case conflict              // 409
    case unprocessable         // 422
    case networkTimeout        // URLError timeout
    case other(Int)            // other HTTP errors
}

struct GpsTransport {
    func send(_ payload: GpsFixPayload, configuration: SenderConfiguration) async throws {
        guard let url = configuration.endpoint else { throw TransportError.invalidEndpoint }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder.gpsEncoder.encode(payload)
        
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw TransportError.other(-1)
            }
            
            switch httpResponse.statusCode {
            case 200...299:
                return
            case 401:
                throw TransportError.unauthorized
            case 409:
                throw TransportError.conflict
            case 422:
                throw TransportError.unprocessable
            default:
                throw TransportError.other(httpResponse.statusCode)
            }
        } catch let error as URLError where error.code == .timedOut {
            throw TransportError.networkTimeout
        } catch let error as TransportError {
            throw error
        } catch {
            throw TransportError.other(-1)
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
