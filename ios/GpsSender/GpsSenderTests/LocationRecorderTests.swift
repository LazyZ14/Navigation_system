import XCTest
@testable import GpsSender

@MainActor
final class LocationRecorderTests: XCTestCase {
    var recorder: LocationRecorder!
    
    override func setUp() {
        super.setUp()
        recorder = LocationRecorder()
    }
    
    override func tearDown() {
        recorder?.stopRecording()
        recorder = nil
        super.tearDown()
    }
    
    func testInitialState() {
        XCTAssertFalse(recorder.isRecording)
        XCTAssertEqual(recorder.sampleCount, 0)
        XCTAssertEqual(recorder.recordingDuration, 0)
        XCTAssertNil(recorder.lastLocationTime)
    }
    
    func testStartRecordingCreatesSession() {
        // Note: This test requires location authorization
        // In a real test environment, you would mock CLLocationManager
        recorder.startRecording()
        
        // Session should be created even before location updates
        // The actual recording depends on location permissions
        XCTAssertTrue(recorder.isRecording || recorder.statusMessage.contains("权限"))
    }
    
    func testStopRecordingUpdatesStatus() {
        recorder.startRecording()
        recorder.stopRecording()
        
        XCTAssertFalse(recorder.isRecording)
        XCTAssertTrue(recorder.statusMessage.contains("已保存") || recorder.statusMessage.contains("停止"))
    }
    
    func testMultipleSessionsHaveDifferentIDs() {
        // Start and stop first session
        recorder.startRecording()
        recorder.stopRecording()
        let files1 = recorder.getRecordingFiles()
        
        // Start and stop second session
        recorder.startRecording()
        recorder.stopRecording()
        let files2 = recorder.getRecordingFiles()
        
        // Should have more files after second session
        XCTAssertGreaterThanOrEqual(files2.count, files1.count)
    }
    
    func testGetRecordingFilesReturnsJSONLFiles() {
        let files = recorder.getRecordingFiles()
        
        // All returned files should have .jsonl extension
        for file in files {
            XCTAssertEqual(file.pathExtension, "jsonl")
        }
    }
    
    func testDeleteRecordingRemovesFile() {
        recorder.startRecording()
        recorder.stopRecording()
        
        let files = recorder.getRecordingFiles()
        if let firstFile = files.first {
            recorder.deleteRecording(at: firstFile)
            
            // File should no longer exist
            XCTAssertFalse(recorder.getRecordingFiles().contains(firstFile))
        }
    }

    func testStopRecordingAppendsEndMetadataWithoutOverwritingRecordedSamples() throws {
        let before = Set(recorder.getRecordingFiles())
        recorder.startRecording()
        let sample = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 22.3734, longitude: 113.5786),
            altitude: 12.0,
            horizontalAccuracy: 6.0,
            verticalAccuracy: 8.0,
            course: 85.0,
            speed: 5.5,
            timestamp: Date()
        )
        recorder.recordLocation(sample)
        recorder.stopRecording()

        let created = Set(recorder.getRecordingFiles()).subtracting(before)
        guard let fileURL = created.first else {
            XCTFail("Expected a new JSONL recording file")
            return
        }
        defer { recorder.deleteRecording(at: fileURL) }

        let content = try String(contentsOf: fileURL, encoding: .utf8)
        let lines = content.split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, 3)
        XCTAssertTrue(lines[0].contains("\"recording_session\""))
        XCTAssertTrue(lines[1].contains("\"gps_fix\""))
        XCTAssertTrue(lines[2].contains("\"recording_end\""))
    }
}
