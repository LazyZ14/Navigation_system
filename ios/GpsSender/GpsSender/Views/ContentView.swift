import SwiftUI

struct ContentView: View {
    @StateObject private var model = LocationSenderViewModel()

    var body: some View {
        NavigationStack {
            Form {
                Section("连接设置") {
                    TextField("Mac 主机或局域网 IP", text: $model.configuration.host).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("端口", text: $model.configuration.port).keyboardType(.numberPad)
                    TextField("设备 ID", text: $model.configuration.deviceID).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("设备令牌", text: $model.configuration.token)
                }
                Section("状态") {
                    Text(model.status)
                    Text(model.latestLocation).font(.footnote).textSelection(.enabled)
                }
                Section {
                    Button(model.isSending ? "停止发送" : "开始发送") { model.isSending ? model.stop() : model.start() }
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(model.isSending ? .red : .blue)
                }
            }
            .navigationTitle("GPS Sender")
        }
    }
}
