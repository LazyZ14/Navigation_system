import pytest
from pydantic import ValidationError

from app.services.voice import NavigationIntent, parse_model_output


def test_navigation_intent_accepts_named_destination():
    result = parse_model_output('{"intent":"navigate_to_poi","destination_query":"停车场","requires_clarification":false}')
    assert result.destination_query == "停车场"


@pytest.mark.parametrize("output", [
    '{"intent":"navigate_to_poi","destination_query":"停车场","requires_clarification":false,"lat":22.3}',
    '{"intent":"navigate_to_poi","destination_query":"","requires_clarification":false}',
    'not-json',
])
def test_model_output_rejects_invalid_or_fabricated_data(output):
    with pytest.raises((ValidationError, ValueError)):
        parse_model_output(output)


def test_unknown_intent_is_not_navigation():
    result = NavigationIntent(intent="unknown", destination_query="", requires_clarification=True)
    assert result.intent == "unknown"


def test_rejects_unrecognized_osm_category():
    with pytest.raises(ValidationError):
        NavigationIntent(intent="navigate_to_poi", destination_query="", category="invented", requires_clarification=False)


def test_specific_food_constraint_is_not_silently_dropped():
    from app.services.voice import preserve_specific_food
    intent = NavigationIntent(intent="navigate_to_poi", destination_query="", category="food", requires_clarification=False)
    result = preserve_specific_food("我要吃火锅", intent)
    assert result.destination_query == "火锅"
