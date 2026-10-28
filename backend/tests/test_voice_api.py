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
    response = TestClient(app).post("/api/voice/transcribe", content=b"")
    assert response.status_code == 400


def test_asr_failure_is_safe(monkeypatch):
    from app.api import voice
    def fail(_audio):
        raise RuntimeError("failed")
    monkeypatch.setattr(voice, "transcribe_audio", fail)
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio")
    assert response.status_code == 503
    assert response.json()["detail"] == "asr_unavailable_or_failed"


def test_missing_credentials_gives_configuration_error(monkeypatch):
    monkeypatch.delenv("TENCENT_SECRET_ID", raising=False)
    monkeypatch.delenv("TENCENT_SECRET_KEY", raising=False)
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio")
    assert response.status_code == 503
    assert response.json()["detail"] == "asr_not_configured"


def test_no_speech_is_distinct(monkeypatch):
    from app.api import voice
    monkeypatch.setattr(voice, "transcribe_audio", lambda _: "")
    response = TestClient(app).post("/api/voice/transcribe", content=b"audio")
    assert response.status_code == 422


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
    (tmp_path / "place-labels.geojson").write_text(json.dumps({"features": [
        {"properties": {"name": "示例地点"}, "geometry": {"type": "Point", "coordinates": [113.5, 22.3]}}
    ]}))
    monkeypatch.setenv("VOICE_POI_PATH", str(poi))
    assert get_poi_catalog()[0]["name"] == "示例地点"


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
        assert [c["name"] for c in result["candidates"]] == ["示例餐馆", "示例快餐"]
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
        response = TestClient(app).post("/api/voice/intent", json={"text": "查找地点"})
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
