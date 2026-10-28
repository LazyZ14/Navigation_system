from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class NavigationIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    intent: Literal["navigate_to_poi", "unknown"]
    destination_query: str = Field(max_length=100)
    category: Literal["food", "cafe", "parking", "fuel", "hotel", "park", "supermarket", "convenience", "pharmacy", "bank", "police", "station", "bakery", "mall", "department_store", "clothes", "books", "attraction", "museum", "sports_centre", "stadium", "government"] | None = None
    requires_clarification: bool

    @model_validator(mode="after")
    def validate_destination(self):
        self.destination_query = self.destination_query.strip()
        if self.intent == "navigate_to_poi" and not self.destination_query and not self.category and not self.requires_clarification:
            raise ValueError("a destination is required")
        return self


def parse_model_output(output: str) -> NavigationIntent:
    return NavigationIntent.model_validate_json(output)


def preserve_specific_food(text: str, intent: NavigationIntent) -> NavigationIntent:
    if intent.intent == "navigate_to_poi" and intent.category == "food" and not intent.destination_query:
        for term in ("火锅", "烧烤", "汉堡", "炸鸡", "寿司"):
            if term in text:
                return intent.model_copy(update={"destination_query": term})
    return intent
