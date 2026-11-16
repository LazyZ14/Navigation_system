import base64
import pytest

from app.services.tencent_asr import TencentASR, ASRConfigurationError, AudioError


def test_sends_pcm_with_tencent_sentence_recognition_parameters():
    requests = []
    class Client:
        def SentenceRecognition(self, request):
            requests.append(request)
            return type("Response", (), {"Result": "导航去停车场"})()
    class Request:
        pass
    asr = TencentASR(client=Client(), request_factory=Request, convert=lambda _: b"pcm")
    assert asr.transcribe(b"browser recording") == "导航去停车场"
    request = requests[0]
    assert request.EngSerViceType == "16k_zh"
    assert request.VoiceFormat == "pcm"
    assert base64.b64decode(request.Data) == b"pcm"
    assert request.DataLen == 3


def test_missing_credentials_fails_without_cloud_request(monkeypatch):
    monkeypatch.delenv("TENCENT_SECRET_ID", raising=False)
    monkeypatch.delenv("TENCENT_SECRET_KEY", raising=False)
    with pytest.raises(ASRConfigurationError):
        TencentASR.from_environment()


@pytest.mark.parametrize("pcm", [b"", b"x" * (1_920_001)])
def test_rejects_empty_or_overlong_audio(pcm):
    asr = TencentASR(client=None, request_factory=None, convert=lambda _: pcm)
    with pytest.raises(AudioError):
        asr.transcribe(b"audio")


def test_audio_decoder_timeout_is_distinct(monkeypatch):
    import subprocess
    from app.services import tencent_asr
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("ffmpeg", 20)
    monkeypatch.setattr(tencent_asr.subprocess, "run", timeout)
    with pytest.raises(tencent_asr.ASRTimeout):
        tencent_asr.to_pcm(b"audio")


def test_cloud_timeout_is_distinct_even_if_sdk_wraps_it():
    import requests
    from app.services.tencent_asr import ASRTimeout
    class Client:
        def SentenceRecognition(self, _request):
            try:
                raise requests.exceptions.Timeout("timed out")
            except requests.exceptions.Timeout:
                raise RuntimeError("SDK wrapped network error")
    class Request:
        pass
    with pytest.raises(ASRTimeout):
        TencentASR(client=Client(), request_factory=Request, convert=lambda _: b"pcm").transcribe(b"audio")
