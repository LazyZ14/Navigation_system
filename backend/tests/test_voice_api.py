from fastapi.testclient import TestClient
import pytest

from app.main import app


def test_invalid_audio_is_reported():
    response = TestClient(app).post("/api/voice/transcribe", content=b"", headers={"origin": "http://localhost:15173"})
    assert response.status_code == 400



def test_asr_failure_is_safe(monkeypatch):
    from app.api import voice
    def fail(_audio):
        raise RuntimeError("failed")
    monkeypatch.setattr(voice, "transcribe_audio", fail)
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert response.status_code == 503
    assert response.json()["detail"] == "asr_unavailable_or_failed"



def test_missing_credentials_gives_configuration_error(monkeypatch):
    monkeypatch.delenv("TENCENT_SECRET_ID", raising=False)
    monkeypatch.delenv("TENCENT_SECRET_KEY", raising=False)
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert response.status_code == 503
    assert response.json()["detail"] == "asr_not_configured"



def test_no_speech_is_distinct(monkeypatch):
    from app.api import voice
    monkeypatch.setattr(voice, "transcribe_audio", lambda _: "")
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert response.status_code == 422



def test_asr_timeout_is_distinct(monkeypatch):
    from app.api import voice
    from app.services.tencent_asr import ASRTimeout
    def timeout(_):
        raise ASRTimeout()
    monkeypatch.setattr(voice, "transcribe_audio", timeout)
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert response.status_code == 504
    assert response.json()["detail"] == "asr_timeout"



def test_untrusted_browser_origin_never_calls_cloud(monkeypatch):
    from app.api import voice
    calls = []
    monkeypatch.setattr(voice, "transcribe_audio", lambda data: calls.append(data) or "result")
    result = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"origin": "https://evil.example", "content-type": "audio/webm"})
    assert result.status_code == 403
    assert calls == []



def test_missing_origin_never_calls_cloud(monkeypatch):
    from app.api import voice
    calls = []
    monkeypatch.setattr(voice, "transcribe_audio", lambda data: calls.append(data) or "result")
    result = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm"})
    assert result.status_code == 403
    assert calls == []



def test_oversized_audio_never_calls_cloud(monkeypatch):
    from app.api import voice
    calls = []
    monkeypatch.setattr(voice, "transcribe_audio", lambda data: calls.append(data) or "result")
    result = TestClient(app).post("/api/voice/transcribe", content=b"x" * 3_000_001, headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert result.status_code == 413
    assert calls == []



def test_unsupported_audio_media_type_never_calls_cloud(monkeypatch):
    from app.api import voice
    calls = []
    monkeypatch.setattr(voice, "transcribe_audio", lambda data: calls.append(data) or "result")
    result = TestClient(app).post("/api/voice/transcribe", content=b"audio", headers={"content-type": "text/plain", "origin": "http://localhost:15173"})
    assert result.status_code == 415
    assert calls == []



@pytest.mark.asyncio
async def test_asr_concurrency_is_bounded(monkeypatch):
    import asyncio
    import threading
    import httpx
    from app.api import voice

    release = threading.Event()
    started = []
    def blocked(_data):
        started.append(1)
        release.wait(timeout=5)
        return "识别成功"
    monkeypatch.setattr(voice, "transcribe_audio", blocked)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        tasks = [asyncio.create_task(client.post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})) for _ in range(2)]
        try:
            for _ in range(100):
                if len(started) == 2:
                    break
                await asyncio.sleep(0.01)
            assert len(started) == 2
            response = await client.post("/api/voice/transcribe", content=b"audio", headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
            assert response.status_code == 429
        finally:
            release.set()
            await asyncio.gather(*tasks)



@pytest.mark.asyncio
async def test_slow_audio_upload_times_out_before_cloud(monkeypatch):
    import asyncio
    import httpx
    from app.api import voice
    calls = []
    monkeypatch.setattr(voice, "VOICE_UPLOAD_TIMEOUT_S", 0.01, raising=False)
    monkeypatch.setattr(voice, "transcribe_audio", lambda data: calls.append(data) or "result")
    async def stream():
        yield b"audio"
        await asyncio.sleep(0.1)
        yield b"more"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/voice/transcribe", content=stream(), headers={"content-type": "audio/webm", "origin": "http://localhost:15173"})
    assert response.status_code == 408
    assert calls == []
