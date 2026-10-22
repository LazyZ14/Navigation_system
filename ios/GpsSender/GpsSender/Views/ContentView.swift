import SwiftUI

struct ContentView: View {
    @StateObject private var model = LocationSenderViewModel()
    @StateObject private var recorder = LocationRecorder()
    @State private var selectedMode: AppMode = .realtime
    
    enum AppMode {
        case realtime
        case offline
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section("工作模式") {
                    Picker("选择模式", selection: $selectedMode) {
                        Text("实时发送").tag(AppMode.realtime)
                        Text("离线录制").tag(AppMode.offline)
                    }
                    .pickerStyle(.segmented)
                }
                
                if selectedMode == .realtime {
                    realtimeSection
                } else {
                    offlineSection
                }
            }
            .navigationTitle("GPS Sender")
        }
    }
    
    // MARK: - Realtime Mode
    
    @ViewBuilder
    private var realtimeSection: some View {
        Section("连接设置") {
            TextField("Mac 主机或局域网 IP", text: $model.configuration.host).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("端口", text: $model.configuration.port).keyboardType(.numberPad)
            TextField("设备 ID", text: $model.configuration.deviceID).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("设备令牌", text: $model.configuration.token)
        }
        Section("状态") {
            Text(model.status)
            Text(model.latestLocation).font(.footnote).textSelection(.enabled)
            if model.isSending {
                HStack {
                    Text("平均采样间隔:").font(.footnote)
                    Spacer()
                    Text(String(format: "%.2fs", model.avgSampleInterval)).font(.footnote).monospaced()
                }
                HStack {
                    Text("平均发送间隔:").font(.footnote)
                    Spacer()
                    Text(String(format: "%.2fs", model.avgSendInterval)).font(.footnote).monospaced()
                }
                HStack {
                    Text("平均定位年龄:").font(.footnote)
                    Spacer()
                    Text(String(format: "%.2fs", model.avgLocationAge)).font(.footnote).monospaced()
                }
                HStack {
                    Text("平均 HTTP 延迟:").font(.footnote)
                    Spacer()
                    Text(String(format: "%.2fs", model.avgHttpLatency)).font(.footnote).monospaced()
                }
            }
        }
        Section {
            Button(model.isSending ? "停止发送" : "开始发送") { model.isSending ? model.stop() : model.start() }
                .frame(maxWidth: .infinity)
                .foregroundStyle(model.isSending ? .red : .blue)
        }
    }
    
    // MARK: - Offline Mode
    
    @ViewBuilder
    private var offlineSection: some View {
        Section("录制状态") {
            Text(recorder.statusMessage)
            HStack {
                Text("样本数:").font(.footnote)
                Spacer()
                Text("\(recorder.sampleCount)").font(.footnote).monospaced()
            }
            HStack {
                Text("录制时长:").font(.footnote)
                Spacer()
                Text(formatDuration(recorder.recordingDuration)).font(.footnote).monospaced()
            }
            if let lastTime = recorder.lastLocationTime {
                HStack {
                    Text("最近定位:").font(.footnote)
                    Spacer()
                    Text(lastTime, style: .time).font(.footnote)
                }
            }
            if recorder.errorCount > 0 {
                HStack {
                    Text("错误数:").font(.footnote).foregroundStyle(.red)
                    Spacer()
                    Text("\(recorder.errorCount)").font(.footnote).monospaced().foregroundStyle(.red)
                }
            }
        }
        
        Section {
            Button(recorder.isRecording ? "停止并保存" : "开始录制") {
                recorder.isRecording ? recorder.stopRecording() : recorder.startRecording()
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(recorder.isRecording ? .red : .green)
        }
        
        if !recorder.getRecordingFiles().isEmpty {
            Section("已保存的轨迹") {
                ForEach(recorder.getRecordingFiles(), id: \.self) { fileURL in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(fileURL.lastPathComponent).font(.footnote)
                            Text(formattedFileSize(fileURL), format: .byteCount(style: .file)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        ShareLink(item: fileURL) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        Button(role: .destructive) {
                            recorder.deleteRecording(at: fileURL)
                        } {
                            Image(systemName: "trash")
                        }
                    }
                }
            }
        }
    }
    
    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
    
    private func formattedFileSize(_ url: URL) -> Int64 {
        (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
    }
}
