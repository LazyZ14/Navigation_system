from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


CATEGORY_SUBCLASSES = {
    "food": {"restaurant", "fast_food"}, "cafe": {"cafe"}, "parking": {"parking"},
    "fuel": {"fuel"}, "hotel": {"hotel"}, "park": {"park"}, "supermarket": {"supermarket"},
    "convenience": {"convenience"}, "pharmacy": {"pharmacy"}, "bank": {"bank"},
    "police": {"police"}, "station": {"station"}, "bakery": {"bakery"}, "mall": {"mall"},
    "department_store": {"department_store"}, "clothes": {"clothes"}, "books": {"books"},
    "attraction": {"attraction"}, "museum": {"museum"}, "sports_centre": {"sports_centre"},
    "stadium": {"stadium"}, "government": {"government"}, "school": {"school"},
    "university": {"university", "college"}, "hospital": {"hospital"},
}


class UnverifiedConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["location", "exclusion", "price", "opening_hours", "parking", "cuisine", "other"]
    text: str = Field(min_length=1, max_length=100)
    status: Literal["unverified", "verified"] = "unverified"

    @field_validator("status")
    @classmethod
    def reject_model_verified(cls, value):
        if value != "unverified":
            raise ValueError("only the server can verify constraints")
        return value


class NavigationIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    intent: Literal["navigate_to_poi", "unknown"]
    destination_query: str = Field(max_length=100)
    category: str | None = None
    requires_clarification: bool
    constraints: list[UnverifiedConstraint] = Field(default_factory=list, max_length=20)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value):
        if value is not None and value not in CATEGORY_SUBCLASSES:
            raise ValueError("unsupported POI category")
        return value

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


def enforce_constraints(text: str, intent: NavigationIntent, known_names: tuple[str, ...] = ()) -> NavigationIntent:
    """Do not turn recognized but unverifiable conditions into ordinary results."""
    import unicodedata

    normalized = unicodedata.normalize("NFKC", text).casefold()
    conditions = {
        "location": ("附近", "最近", "就近", "沿途", "顺路", "周边"),
        "exclusion": ("不要", "不想", "不去", "除外", "除了", "不是", "排除"),
        "price": ("便宜", "实惠", "低价", "价格", "免费", "最贵"),
        "opening_hours": ("营业", "开门", "关闭", "关门", "24小时"),
        "parking": ("有停车位", "有车位", "方便停车", "可以停车", "能停车"),
        "cuisine": ("火锅", "烧烤", "汉堡", "炸鸡", "寿司"),
        "other": ("适合休息", "方便休息", "适合儿童", "无障碍", "安静", "宠物", "轮椅", "充电", "素食"),
    }
    constraints = list(intent.constraints)
    present = {(c.kind, c.text) for c in constraints}
    for kind, terms in conditions.items():
        for term in terms:
            if term in normalized and (kind, term) not in present:
                constraints.append(UnverifiedConstraint(kind=kind, text=term))
                present.add((kind, term))
    # Only well-understood, literal wording may proceed without review. This
    # deliberately favors clarification over silently dropping new modifiers.
    if intent.intent == "navigate_to_poi" and not intent.requires_clarification and not any(c.kind != "location" for c in constraints):
        import re
        compact = lambda value: re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", value).casefold())
        remainder = compact(text)
        target = compact(intent.destination_query)
        if "的" in target:
            constraints.append(UnverifiedConstraint(kind="other", text="目的地描述包含未验证的修饰条件"))
        if target and target in remainder:
            remainder = remainder.replace(target, "", 1)
        tokens = (
            "能不能", "可不可以", "我想要", "我想去", "我要去", "带我去", "导航到", "导航去", "帮我找", "帮我去",
            "帮我", "给我", "我想", "我要", "我想要", "想要", "导航", "前往", "寻找", "有没有", "请问", "请",
            "最近", "就近", "附近", "周边", "沿途", "顺路", "一个", "一家", "一所", "一处", "一下", "一趟",
            "吃饭", "饿了", "餐厅", "餐馆", "饭店", "快餐", "咖啡馆", "咖啡店", "咖啡", "停车场", "停车位", "车位", "停车",
            "加油站", "加油", "酒店", "宾馆", "住宿", "超市", "便利店", "药房", "药店", "银行", "学校", "大学", "医院", "学院",
            "警察局", "派出所", "车站", "面包店", "烘焙店", "购物中心", "商场", "百货店", "百货", "服装店", "衣服店", "书店",
            "旅游景点", "景点", "博物馆", "体育中心", "体育场", "政府机构", "公园", "吃", "喝", "找", "去", "到", "我", "想", "要", "的", "个", "吗", "吧", "了",
        )
        for token in tokens:
            remainder = remainder.replace(token, "")
        if target and len(remainder) >= 2 and remainder in target and any(target == compact(name) for name in known_names):
            remainder = ""
        if remainder:
            constraints.append(UnverifiedConstraint(kind="other", text="需求包含未验证的附加内容"))
    return intent.model_copy(update={"constraints": constraints, "requires_clarification": intent.requires_clarification or bool(constraints)})
