import asyncio
import json
import os
import re
import unicodedata
import math
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool

from app.services.voice import NavigationIntent, UnverifiedConstraint, parse_model_output, preserve_specific_food, enforce_constraints, CATEGORY_SUBCLASSES
from app.services.tencent_asr import TencentASR, ASRConfigurationError, ASRTimeout, AudioError
from app.models import Coordinate

router = APIRouter(prefix="/api/voice", tags=["voice"])
_asr_slots = asyncio.Semaphore(2)
_audio_types = {"audio/webm", "video/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/aac"}
VOICE_UPLOAD_TIMEOUT_S = 15.0


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    origin: Coordinate | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value

    @field_validator("origin", mode="before")
    @classmethod
    def validate_origin(cls, value):
        if value is None or isinstance(value, Coordinate):
            return value
        if not isinstance(value, dict) or set(value) != {"lat", "lon"}:
            raise ValueError("origin must be a latitude/longitude object")
        if any(isinstance(value[key], bool) or not isinstance(value[key], (int, float)) for key in ("lat", "lon")):
            raise ValueError("origin coordinates must be finite numbers")
        if not (-90 <= value["lat"] <= 90 and -180 <= value["lon"] <= 180):
            raise ValueError("origin coordinates out of range")
        return value


async def parse_intent(text: str) -> NavigationIntent:
    prompt = ('你是导航需求解析器，只返回 JSON，字段 intent、destination_query、category、requires_clarification、constraints。'
              '导航、找地点和吃饭等需求 intent 为 navigate_to_poi，其他为 unknown。'
              f'category 只能是 {"、".join(CATEGORY_SUBCLASSES)} 或 null。'
              '吃饭、饿了对应 food；喝咖啡对应 cafe；停车对应 parking。'
              '用户明确提及具体地点名或特定菜品时 destination_query 必须保留名称；'
              '没有具体名称时 destination_query 为空字符串，用 category 表达类别；'
              '将所有附加条件放入 constraints 数组，每项使用 kind（location、exclusion、price、opening_hours、parking、cuisine、other）、text（用户原文条件）、status（unverified）；没有条件时为空数组。'
              '不得声称条件已验证。目的不明确时 requires_clarification 为 true。不得生成坐标。'
              '例：我要去吃饭 → {"intent":"navigate_to_poi","destination_query":"","category":"food","requires_clarification":false}。'
              '例：去必胜客 → {"intent":"navigate_to_poi","destination_query":"必胜客","category":"food","requires_clarification":false}。'
              '例：今天天气怎样 → {"intent":"unknown","destination_query":"","category":null,"requires_clarification":true}。'
              '用户输入：' + text)
    try:
        async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
            response = await client.post(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434") + "/api/generate", json={
                "model": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"), "prompt": prompt,
                "format": "json", "stream": False, "options": {"temperature": 0},
            })
            response.raise_for_status()
        return preserve_specific_food(text, parse_model_output(response.json()["response"]))
    except ValidationError as exc:
        errors = exc.errors()
        if errors and all(error["loc"] == ("category",) and error["type"] == "value_error" for error in errors):
            return NavigationIntent(intent="unknown", destination_query="", requires_clarification=True,
                                    constraints=[UnverifiedConstraint(kind="other", text="暂不支持该地点类别")])
        raise HTTPException(status_code=503, detail="llm_unavailable_or_invalid") from exc
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="llm_unavailable_or_invalid") from exc


def get_intent_parser():
    return parse_intent


def get_poi_catalog():
    path = Path(os.getenv("VOICE_POI_PATH", "frontend/public/generated/poi.geojson"))
    search_path = path.with_name("search-poi.geojson")
    if not search_path.is_file():
        raise HTTPException(status_code=503, detail="poi_catalog_rebuild_required")
    try:
        collection = json.loads(search_path.read_text(encoding="utf-8"))
        return [{"name": f["properties"]["display_name"], "real_name": f["properties"]["name"],
                 "names": f["properties"]["names"], "osm_id": f["properties"]["osm_id"],
                 "source_type": f["properties"]["source_type"], "category": f["properties"]["subclass"], "isced_level": f["properties"].get("isced_level", ""),
                 "location": Coordinate(lat=f["geometry"]["coordinates"][1], lon=f["geometry"]["coordinates"][0]).model_dump()}
                for f in collection["features"] if f["geometry"]["type"] == "Point"]
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(status_code=503, detail="poi_data_unavailable")


@router.post("/intent")
async def intent(request: TextRequest, parser=Depends(get_intent_parser), catalog=Depends(get_poi_catalog)):
    model_intent = await parser(request.text)
    known_names = tuple(name for point in catalog for name in [point.get("real_name", point["name"]), *point.get("names", {}).values()] if name)
    parsed = enforce_constraints(request.text, model_intent, known_names)
    constraints = parsed.constraints
    school_level = "primary" if "小学" in request.text else "secondary" if "中学" in request.text else None
    school_candidates = []
    if school_level and model_intent.intent == "navigate_to_poi":
        levels = {"1"} if school_level == "primary" else {"2", "3"}
        school_candidates = [p for p in catalog if p["category"] == "school" and levels.intersection(re.split(r"[;,]", p.get("isced_level", "")))]
        if not school_candidates:
            constraints = [*constraints, UnverifiedConstraint(kind="other", text="学校层级缺少可验证的 OSM 标签")]
    try:
        nearby_radius = float(os.getenv("VOICE_NEARBY_RADIUS_M", ""))
        if not math.isfinite(nearby_radius) or nearby_radius <= 0:
            nearby_radius = None
    except ValueError:
        nearby_radius = None
    if request.origin is not None:
        constraints = [c.model_copy(update={"status": "verified"}) if c.kind == "location" and (c.text in ("最近", "就近") or (c.text in ("附近", "周边") and nearby_radius is not None)) else c for c in constraints]
    pending = any(c.status != "verified" for c in constraints)
    parsed = parsed.model_copy(update={"constraints": constraints, "requires_clarification": model_intent.requires_clarification or pending})
    distance_basis = None
    candidates = []
    if parsed.intent == "navigate_to_poi" and not parsed.requires_clarification:
        normalize = lambda value: re.sub(r"\s+", "", unicodedata.normalize("NFKC", value).casefold())
        query = normalize(parsed.destination_query)
        generic_terms = {
            "food": {"餐馆", "餐厅", "饭店", "吃饭", "餐饮"}, "cafe": {"咖啡", "咖啡店", "咖啡馆"},
            "parking": {"停车", "停车场", "车位"}, "fuel": {"加油", "加油站"}, "hotel": {"酒店", "宾馆", "住宿"},
            "park": {"公园"}, "supermarket": {"超市"}, "convenience": {"便利店"}, "pharmacy": {"药房", "药店"}, "bank": {"银行"},
            "police": {"警察局", "派出所"}, "station": {"车站", "站点"}, "bakery": {"面包店", "烘焙店"},
            "mall": {"商场", "购物中心"}, "department_store": {"百货", "百货店"}, "clothes": {"服装店", "衣服店"},
            "books": {"书店"}, "attraction": {"景点"}, "museum": {"博物馆"}, "sports_centre": {"体育中心"},
            "stadium": {"体育场"}, "government": {"政府机构"},
            "school": {"学校", "小学", "中学"}, "university": {"大学", "学院"}, "hospital": {"医院"},
        }
        if parsed.category and query in generic_terms.get(parsed.category, set()):
            candidates = [p for p in catalog if p["category"] in CATEGORY_SUBCLASSES[parsed.category]]
        elif query:
            candidates = [p for p in catalog if any(query in normalize(value) for value in [p.get("real_name", p["name"]), *p.get("names", {}).values()] if value) or (query in ("停车", "停车场", "车位") and p["category"] == "parking")]
        elif parsed.category:
            candidates = [p for p in catalog if p["category"] in CATEGORY_SUBCLASSES[parsed.category]]
        if school_level:
            candidates = [p for p in candidates if p in school_candidates]
        location_required = any(c.kind == "location" and c.status == "verified" for c in constraints)
        if location_required and request.origin is not None:
            def straight_line(candidate):
                lat1, lat2 = math.radians(request.origin.lat), math.radians(candidate["location"]["lat"])
                dlat = lat2 - lat1
                dlon = math.radians(candidate["location"]["lon"] - request.origin.lon)
                a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
                return 2 * 6371000 * math.asin(min(1.0, math.sqrt(a)))
            candidates = [{**candidate, "distance_m": straight_line(candidate)} for candidate in candidates]
            if any(c.text in ("附近", "周边") for c in constraints) and nearby_radius is not None:
                candidates = [candidate for candidate in candidates if candidate["distance_m"] <= nearby_radius]
            candidates.sort(key=lambda p: (p["distance_m"], p["name"], p.get("osm_id", "")))
            candidates = [{**candidate, "distance_m": round(candidate["distance_m"], 1)} for candidate in candidates]
            distance_basis = "straight_line"
        else:
            candidates.sort(key=lambda p: (p["name"].casefold(), p.get("osm_id", ""), p["location"]["lat"], p["location"]["lon"]))
        candidates = candidates[:20]
    return {"intent": parsed, "candidates": candidates, "distance_basis": distance_basis}


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
