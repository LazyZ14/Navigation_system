import json
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.services.voice import NavigationIntent, parse_model_output, preserve_specific_food
from app.services.tencent_asr import TencentASR, ASRConfigurationError, AudioError

router = APIRouter(prefix="/api/voice", tags=["voice"])


class TextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


async def parse_intent(text: str) -> NavigationIntent:
    prompt = ('你是导航需求解析器，只返回 JSON，字段 intent、destination_query、category、requires_clarification。'
              '导航、找地点和吃饭等需求 intent 为 navigate_to_poi，其他为 unknown。'
              'category 只能是 food、cafe、parking、fuel、hotel、park、supermarket、convenience、pharmacy、bank、police、station、bakery、mall、department_store、clothes、books、attraction、museum、sports_centre、stadium、government 或 null。'
              '吃饭、饿了对应 food；喝咖啡对应 cafe；停车对应 parking。'
              '用户明确提及具体地点名或特定菜品时 destination_query 必须保留名称；'
              '没有具体名称时 destination_query 为空字符串，用 category 表达类别；'
              '不确定或条件不能表达时 requires_clarification 为 true；不得生成坐标。'
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
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="llm_unavailable_or_invalid") from exc


def get_intent_parser():
    return parse_intent


def get_poi_catalog():
    path = Path(os.getenv("VOICE_POI_PATH", "frontend/public/generated/poi.geojson"))
    try:
        collection = json.loads(path.read_text(encoding="utf-8"))
        places = json.loads(path.with_name("place-labels.geojson").read_text(encoding="utf-8"))
        return [
            {"name": feature["properties"].get("name", ""),
             "category": feature["properties"].get("subclass", ""),
             "location": {"lat": feature["geometry"]["coordinates"][1], "lon": feature["geometry"]["coordinates"][0]}}
            for feature in collection["features"] + places["features"] if feature["geometry"]["type"] == "Point" and feature["properties"].get("name")
        ]
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        raise HTTPException(status_code=503, detail="poi_data_unavailable")


@router.post("/intent")
async def intent(request: TextRequest, parser=Depends(get_intent_parser), catalog=Depends(get_poi_catalog)):
    parsed = await parser(request.text)
    candidates = []
    if parsed.intent == "navigate_to_poi" and not parsed.requires_clarification:
        query = parsed.destination_query.casefold()
        category_subclasses = {
            "food": {"restaurant", "fast_food"}, "cafe": {"cafe"}, "parking": {"parking"},
            "fuel": {"fuel"}, "hotel": {"hotel"}, "park": {"park"}, "supermarket": {"supermarket"},
            "convenience": {"convenience"}, "pharmacy": {"pharmacy"}, "bank": {"bank"},
            "police": {"police"}, "station": {"station"}, "bakery": {"bakery"}, "mall": {"mall"},
            "department_store": {"department_store"}, "clothes": {"clothes"}, "books": {"books"},
            "attraction": {"attraction"}, "museum": {"museum"}, "sports_centre": {"sports_centre"},
            "stadium": {"stadium"}, "government": {"government"},
        }
        generic_terms = {
            "food": {"餐馆", "餐厅", "饭店", "吃饭", "餐饮"}, "cafe": {"咖啡", "咖啡店", "咖啡馆"},
            "parking": {"停车", "停车场", "车位"}, "fuel": {"加油", "加油站"}, "hotel": {"酒店", "宾馆", "住宿"},
            "park": {"公园"}, "supermarket": {"超市"}, "convenience": {"便利店"}, "pharmacy": {"药房", "药店"}, "bank": {"银行"},
            "police": {"警察局", "派出所"}, "station": {"车站", "站点"}, "bakery": {"面包店", "烘焙店"},
            "mall": {"商场", "购物中心"}, "department_store": {"百货", "百货店"}, "clothes": {"服装店", "衣服店"},
            "books": {"书店"}, "attraction": {"景点"}, "museum": {"博物馆"}, "sports_centre": {"体育中心"},
            "stadium": {"体育场"}, "government": {"政府机构"},
        }
        if parsed.category and query in generic_terms.get(parsed.category, set()):
            candidates = [p for p in catalog if p["category"] in category_subclasses[parsed.category]][:20]
        elif query:
            candidates = [p for p in catalog if query in p["name"].casefold() or (query in ("停车", "停车场", "车位") and p["category"] == "parking")][:20]
        elif parsed.category:
            candidates = [p for p in catalog if p["category"] in category_subclasses[parsed.category]][:20]
    return {"intent": parsed, "candidates": candidates}


def transcribe_audio(audio: bytes) -> str:
    return TencentASR.from_environment().transcribe(audio)


@router.post("/transcribe")
async def transcribe(request: Request):
    audio = await request.body()
    if not audio or len(audio) > 3_000_000:
        raise HTTPException(status_code=400, detail="invalid_audio")
    try:
        text = await run_in_threadpool(transcribe_audio, audio)
    except AudioError as exc:
        raise HTTPException(status_code=400, detail="invalid_audio") from exc
    except ASRConfigurationError as exc:
        raise HTTPException(status_code=503, detail="asr_not_configured") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="asr_unavailable_or_failed") from exc
    if not text:
        raise HTTPException(status_code=422, detail="no_speech")
    return {"text": text}
