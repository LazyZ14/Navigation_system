import asyncio
import os

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.services.tencent_asr import TencentASR, ASRConfigurationError, ASRTimeout, AudioError

router = APIRouter(prefix="/api/voice", tags=["voice"])
_asr_slots = asyncio.Semaphore(2)
_audio_types = {"audio/webm", "video/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/aac"}
VOICE_UPLOAD_TIMEOUT_S = 15.0


def transcribe_audio(audio: bytes) -> str:
    return TencentASR.from_environment().transcribe(audio)


@router.post("/transcribe")
async def transcribe(request: Request):
    origin = request.headers.get("origin")
    allowed_origins = {item.strip() for item in os.getenv("VOICE_ALLOWED_ORIGINS", "http://localhost:15173,http://127.0.0.1:15173,http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()}
    if not origin or origin not in allowed_origins:
        raise HTTPException(status_code=403, detail="origin_not_allowed")
    if request.headers.get("content-length") == "0":
        raise HTTPException(status_code=400, detail="invalid_audio")
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type not in _audio_types:
        raise HTTPException(status_code=415, detail="unsupported_audio_type")
    if _asr_slots.locked():
        raise HTTPException(status_code=429, detail="asr_busy")
    await _asr_slots.acquire()
    try:
        audio = bytearray()
        try:
            async with asyncio.timeout(VOICE_UPLOAD_TIMEOUT_S):
                async for chunk in request.stream():
                    if len(audio) + len(chunk) > 3_000_000:
                        raise HTTPException(status_code=413, detail="audio_too_large")
                    audio.extend(chunk)
        except TimeoutError as exc:
            raise HTTPException(status_code=408, detail="audio_upload_timeout") from exc
        if not audio:
            raise HTTPException(status_code=400, detail="invalid_audio")
        text = await run_in_threadpool(transcribe_audio, bytes(audio))
    except HTTPException:
        raise
    except AudioError as exc:
        raise HTTPException(status_code=400, detail="invalid_audio") from exc
    except ASRConfigurationError as exc:
        raise HTTPException(status_code=503, detail="asr_not_configured") from exc
    except ASRTimeout as exc:
        raise HTTPException(status_code=504, detail="asr_timeout") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="asr_unavailable_or_failed") from exc
    finally:
        _asr_slots.release()
    if not text:
        raise HTTPException(status_code=422, detail="no_speech")
    return {"text": text}
