from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IngressDisposition(str, Enum):
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"


class GpsFixSubmission(BaseModel):
    """Raw WGS-84 fix submitted by any positioning device."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "schema_version": 1,
                    "device_id": "ios-demo-device",
                    "stream_id": "f5824845-1c55-40c8-b98f-fdf7d5aa81d9",
                    "sequence": 42,
                    "lat": 39.9042,
                    "lon": 116.4074,
                    "accuracy_m": 8.5,
                    "speed_mps": 6.2,
                    "heading_deg": 85.0,
                    "timestamp": "2026-10-21T13:20:30.123Z",
                }
            ]
        }
    )

    schema_version: Literal[1]
    device_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    stream_id: UUID
    sequence: int = Field(ge=0)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: float = Field(ge=0, le=10_000, allow_inf_nan=False)
    speed_mps: float | None = Field(default=None, ge=0, le=120, allow_inf_nan=False)
    heading_deg: float | None = Field(default=None, ge=0, lt=360, allow_inf_nan=False)
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_include_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must include a timezone offset")
        return value.astimezone(timezone.utc)


class GpsIngressReceipt(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"accepted": True, "disposition": "accepted", "device_id": "ios-demo-device", "stream_id": "f5824845-1c55-40c8-b98f-fdf7d5aa81d9", "sequence": 42, "timestamp": "2026-10-21T13:20:30.123Z", "received_at": "2026-10-21T13:20:30.341Z", "network_delay_ms": 218}]})

    accepted: bool
    disposition: IngressDisposition
    device_id: str
    stream_id: UUID
    sequence: int
    timestamp: datetime
    received_at: datetime
    network_delay_ms: int
