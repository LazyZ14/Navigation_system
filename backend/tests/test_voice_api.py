from fastapi.testclient import TestClient
import pytest

from app.main import app


def test_text_request_returns_candidates_without_creating_session(monkeypatch):
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent

    async def parse(text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="停车场", requires_clarification=False)

    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "示例停车场", "category": "parking", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        response = TestClient(app).post("/api/voice/intent", json={"text": "找停车场"})
        assert response.status_code == 200
        assert response.json()["candidates"][0]["location"] == {"lat": 22.3, "lon": 113.5}
    finally:
        app.dependency_overrides.clear()


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


def test_unknown_request_never_returns_candidates():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="unknown", destination_query="停车场", requires_clarification=True)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "停车场", "category": "parking", "location": {"lat": 1, "lon": 2}}]
    try:
        assert TestClient(app).post("/api/voice/intent", json={"text": "天气如何"}).json()["candidates"] == []
    finally:
        app.dependency_overrides.clear()


def test_catalog_includes_local_named_places(tmp_path, monkeypatch):
    import json
    from app.api.voice import get_poi_catalog
    poi = tmp_path / "poi.geojson"
    poi.write_text(json.dumps({"features": []}))
    (tmp_path / "search-poi.geojson").write_text(json.dumps({"features": [
        {"properties": {"name": "示例地点", "display_name": "示例地点", "osm_id": "node/1", "source_type": "place", "subclass": "", "names": {"name": "示例地点"}}, "geometry": {"type": "Point", "coordinates": [113.5, 22.3]}}
    ]}))
    monkeypatch.setenv("VOICE_POI_PATH", str(poi))
    assert get_poi_catalog()[0]["name"] == "示例地点"


def test_missing_search_catalog_requires_rebuild(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from app.api.voice import get_poi_catalog
    monkeypatch.setenv("VOICE_POI_PATH", str(tmp_path / "poi.geojson"))
    with pytest.raises(HTTPException) as error:
        get_poi_catalog()
    assert error.value.detail == "poi_catalog_rebuild_required"


def test_invalid_catalog_coordinates_are_rejected(tmp_path, monkeypatch):
    import json
    from fastapi import HTTPException
    from app.api.voice import get_poi_catalog
    (tmp_path / "search-poi.geojson").write_text(json.dumps({"features": [
        {"properties": {"name": "地点", "display_name": "地点", "osm_id": "node/1", "source_type": "amenity", "subclass": "cafe", "names": {}}, "geometry": {"type": "Point", "coordinates": [181, 22]}}
    ]}))
    monkeypatch.setenv("VOICE_POI_PATH", str(tmp_path / "poi.geojson"))
    with pytest.raises(HTTPException):
        get_poi_catalog()


def test_catalog_preserves_search_identity_aliases_and_unnamed(tmp_path, monkeypatch):
    import json
    from app.api.voice import get_poi_catalog
    poi = tmp_path / "poi.geojson"
    poi.write_text(json.dumps({"features": []}))
    (tmp_path / "search-poi.geojson").write_text(json.dumps({"features": [
        {"properties": {"osm_id": "node/1", "source_type": "amenity", "name": "星巴克", "display_name": "星巴克", "subclass": "cafe", "names": {"name:en": "Starbucks"}}, "geometry": {"type": "Point", "coordinates": [113.5, 22.3]}},
        {"properties": {"osm_id": "node/2", "source_type": "amenity", "name": "", "display_name": "未命名停车场", "subclass": "parking", "names": {}}, "geometry": {"type": "Point", "coordinates": [113.6, 22.4]}}
    ]}))
    monkeypatch.setenv("VOICE_POI_PATH", str(poi))
    catalog = get_poi_catalog()
    assert catalog[0]["osm_id"] == "node/1"
    assert catalog[0]["names"]["name:en"] == "Starbucks"
    assert catalog[1]["name"] == "未命名停车场"
    assert catalog[1]["real_name"] == ""


def test_search_matches_english_alias_without_losing_identity():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="ＳＴＡＲＢＵＣＫＳ", category="cafe", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "星巴克", "names": {"name:en": "Starbucks"}, "osm_id": "node/1", "category": "cafe", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "去ＳＴＡＲＢＵＣＫＳ"}).json()
        assert result["candidates"][0]["osm_id"] == "node/1"
    finally:
        app.dependency_overrides.clear()


def test_literal_short_name_can_link_to_real_osm_name():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="必胜客", category="food", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "必胜客", "names": {"name": "必胜客"}, "osm_id": "node/1", "category": "restaurant", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "去必胜"}).json()
        assert result["candidates"][0]["osm_id"] == "node/1"
    finally:
        app.dependency_overrides.clear()


def test_same_named_osm_entities_remain_distinct():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="中国石化", category="fuel", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [
        {"name": "中国石化", "osm_id": "node/1", "category": "fuel", "location": {"lat": 22.3, "lon": 113.5}},
        {"name": "中国石化", "osm_id": "node/2", "category": "fuel", "location": {"lat": 22.4, "lon": 113.6}},
    ]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "导航去中国石化"}).json()
        assert {p["osm_id"] for p in result["candidates"]} == {"node/1", "node/2"}
    finally:
        app.dependency_overrides.clear()


def test_meal_intent_matches_osm_restaurants_and_not_cafes():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="food", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [
        {"name": "示例餐馆", "category": "restaurant", "location": {"lat": 22.3, "lon": 113.5}},
        {"name": "示例快餐", "category": "fast_food", "location": {"lat": 22.4, "lon": 113.6}},
        {"name": "咖啡店", "category": "cafe", "location": {"lat": 22.5, "lon": 113.7}},
    ]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "我要去吃饭"}).json()
        assert [c["name"] for c in result["candidates"]] == ["示例快餐", "示例餐馆"]
    finally:
        app.dependency_overrides.clear()


def test_named_destination_never_falls_back_to_category():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="不存在的餐馆", category="food", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "其他餐馆", "category": "restaurant", "location": {"lat": 1, "lon": 2}}]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "去不存在的餐馆"}).json()
        assert result["candidates"] == []
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(("category", "subclass"), [("cafe", "cafe"), ("parking", "parking"), ("fuel", "fuel"), ("hotel", "hotel"), ("supermarket", "supermarket"), ("museum", "museum")])
def test_category_matches_only_local_osm_subclass(category, subclass):
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category=category, requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [
        {"name": "匹配地点", "category": subclass, "location": {"lat": 22.3, "lon": 113.5}},
        {"name": "不相关地点", "category": "other", "location": {"lat": 22.4, "lon": 113.6}},
    ]
    try:
        query = {"cafe": "找咖啡店", "parking": "找停车场", "fuel": "找加油站", "hotel": "找酒店", "supermarket": "找超市", "museum": "找博物馆"}[category]
        response = TestClient(app).post("/api/voice/intent", json={"text": query})
        assert [c["name"] for c in response.json()["candidates"]] == ["匹配地点"]
    finally:
        app.dependency_overrides.clear()


def test_generic_coffee_query_matches_osm_cafes_even_without_coffee_in_name():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="咖啡", category="cafe", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "星巴克", "category": "cafe", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        response = TestClient(app).post("/api/voice/intent", json={"text": "我想喝咖啡"})
        assert response.json()["candidates"][0]["name"] == "星巴克"
    finally:
        app.dependency_overrides.clear()


def test_unverified_constraint_is_disclosed_and_blocks_candidates():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="hotel", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "酒店", "category": "hotel", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": "找便宜的酒店"}).json()
        assert result["candidates"] == []
        assert result["intent"]["constraints"][0]["kind"] == "price"
        assert result["intent"]["requires_clarification"] is True
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("text", ["找一家可携带宠物的餐厅", "找有充电桩的酒店", "找适合轮椅出行的餐馆"])
def test_unrecognized_details_are_not_silently_dropped(text):
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_text):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="food", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "餐厅", "category": "restaurant", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        result = TestClient(app).post("/api/voice/intent", json={"text": text}).json()
        assert result["intent"]["requires_clarification"] is True
        assert result["candidates"] == []
    finally:
        app.dependency_overrides.clear()


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


def test_nearest_without_origin_requires_location():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="parking", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [{"name": "停车场", "category": "parking", "location": {"lat": 22.3, "lon": 113.5}}]
    try:
        data = TestClient(app).post("/api/voice/intent", json={"text": "最近的停车场"}).json()
        assert data["intent"]["requires_clarification"] is True
        assert data["candidates"] == []
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("origin", [{"lat": True, "lon": 113.5}, {"lat": "22.3", "lon": 113.5}, {"lat": 91, "lon": 113.5}])
def test_location_context_rejects_invalid_coordinates(origin):
    from app.api.voice import get_poi_catalog
    app.dependency_overrides[get_poi_catalog] = lambda: []
    try:
        assert TestClient(app).post("/api/voice/intent", json={"text": "最近的停车场", "origin": origin}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_blank_text_is_rejected_before_model_call():
    from app.api.voice import get_poi_catalog, get_intent_parser
    calls = []
    async def parse(text):
        calls.append(text)
    app.dependency_overrides[get_poi_catalog] = lambda: []
    app.dependency_overrides[get_intent_parser] = lambda: parse
    try:
        assert TestClient(app).post("/api/voice/intent", json={"text": "   \u3000"}).status_code == 422
        assert not calls
    finally:
        app.dependency_overrides.clear()


def test_nearest_with_selected_origin_sorts_by_straight_line_distance():
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="parking", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [
        {"name": "远", "category": "parking", "location": {"lat": 22.4, "lon": 113.5}},
        {"name": "近", "category": "parking", "location": {"lat": 22.31, "lon": 113.5}},
    ]
    try:
        data = TestClient(app).post("/api/voice/intent", json={"text": "最近的停车场", "origin": {"lat": 22.3, "lon": 113.5}}).json()
        assert data["intent"]["requires_clarification"] is False
        assert [c["name"] for c in data["candidates"]] == ["近", "远"]
        assert data["distance_basis"] == "straight_line"
        assert data["candidates"][0]["distance_m"] < data["candidates"][1]["distance_m"]
    finally:
        app.dependency_overrides.clear()


def test_nearby_needs_explicit_radius_and_filters_outside(monkeypatch):
    from app.api.voice import get_intent_parser, get_poi_catalog
    from app.services.voice import NavigationIntent
    async def parse(_):
        return NavigationIntent(intent="navigate_to_poi", destination_query="", category="parking", requires_clarification=False)
    app.dependency_overrides[get_intent_parser] = lambda: parse
    app.dependency_overrides[get_poi_catalog] = lambda: [
        {"name": "远", "category": "parking", "location": {"lat": 22.4, "lon": 113.5}},
        {"name": "近", "category": "parking", "location": {"lat": 22.301, "lon": 113.5}},
    ]
    payload = {"text": "附近的停车场", "origin": {"lat": 22.3, "lon": 113.5}}
    try:
        monkeypatch.delenv("VOICE_NEARBY_RADIUS_M", raising=False)
        assert TestClient(app).post("/api/voice/intent", json=payload).json()["candidates"] == []
        monkeypatch.setenv("VOICE_NEARBY_RADIUS_M", "1000")
        result = TestClient(app).post("/api/voice/intent", json=payload).json()
        assert [c["name"] for c in result["candidates"]] == ["近"]
        assert result["distance_basis"] == "straight_line"
    finally:
        app.dependency_overrides.clear()
