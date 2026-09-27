import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    osrm_base_url: str


def get_settings() -> Settings:
    return Settings(osrm_base_url=os.getenv("OSRM_BASE_URL", "http://127.0.0.1:5000"))
