import json
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    osrm_base_url: str
    gps_device_tokens: dict[str, str]
    gps_max_active_streams: int


def _load_gps_device_tokens(raw_value: str | None) -> dict[str, str]:
    if not raw_value:
        return {}
    try:
        tokens = json.loads(raw_value)
    except json.JSONDecodeError as error:
        raise ValueError("GPS_DEVICE_TOKENS_JSON must be a JSON object") from error
    if not isinstance(tokens, dict) or any(not isinstance(device_id, str) or not isinstance(token, str) or not token for device_id, token in tokens.items()):
        raise ValueError("GPS_DEVICE_TOKENS_JSON must map device IDs to non-empty tokens")
    return tokens


def get_settings() -> Settings:
    return Settings(
        osrm_base_url=os.getenv("OSRM_BASE_URL", "http://127.0.0.1:5000"),
        gps_device_tokens=_load_gps_device_tokens(os.getenv("GPS_DEVICE_TOKENS_JSON")),
        gps_max_active_streams=int(os.getenv("GPS_MAX_ACTIVE_STREAMS", "100")),
    )
