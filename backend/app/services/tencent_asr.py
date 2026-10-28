"""Tencent sentence recognition for audio recorded by the browser."""
import base64
import os
import subprocess
from uuid import uuid4


class ASRConfigurationError(Exception):
    pass


class AudioError(Exception):
    pass


def to_pcm(audio: bytes) -> bytes:
    try:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", "pipe:0", "-t", "61", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
            input=audio, capture_output=True, timeout=20, check=True,
        )
        return result.stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise AudioError("audio conversion failed") from exc


class TencentASR:
    def __init__(self, client, request_factory, convert=to_pcm):
        self.client = client
        self.request_factory = request_factory
        self.convert = convert

    @classmethod
    def from_environment(cls):
        secret_id = os.getenv("TENCENT_SECRET_ID")
        secret_key = os.getenv("TENCENT_SECRET_KEY")
        if not secret_id or not secret_key:
            raise ASRConfigurationError("Tencent credentials are not configured")
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.asr.v20190614 import asr_client, models

        http = HttpProfile()
        http.endpoint = "asr.tencentcloudapi.com"
        http.reqTimeout = 20
        profile = ClientProfile()
        profile.httpProfile = http
        client = asr_client.AsrClient(credential.Credential(secret_id, secret_key), os.getenv("TENCENT_REGION", "ap-guangzhou"), profile)
        return cls(client, models.SentenceRecognitionRequest)

    def transcribe(self, audio: bytes) -> str:
        pcm = self.convert(audio)
        if not pcm or len(pcm) > 1_920_000:
            raise AudioError("audio must be between zero and 60 seconds")
        request = self.request_factory()
        request.ProjectId = 0
        request.SubServiceType = 2
        request.EngSerViceType = "16k_zh"
        request.SourceType = 1
        request.VoiceFormat = "pcm"
        request.UsrAudioKey = uuid4().hex
        request.Data = base64.b64encode(pcm).decode("ascii")
        request.DataLen = len(pcm)
        return (self.client.SentenceRecognition(request).Result or "").strip()
