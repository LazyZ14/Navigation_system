import pytest
from pydantic import ValidationError

from app.models import Coordinate


def test_coordinate_accepts_zero_latitude_and_longitude():
    coordinate = Coordinate(lat=0, lon=0)

    assert coordinate.lat == 0
    assert coordinate.lon == 0


def test_coordinate_rejects_latitude_outside_wgs84_range():
    with pytest.raises(ValidationError):
        Coordinate(lat=91, lon=116.4)
