#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$project_root"

docker compose up -d --build

thematic_map_data_ready() {
  for map_layer in roads buildings water green landuse road-labels place-labels poi; do
    curl --max-time 3 --fail --silent "http://127.0.0.1:5173/generated/${map_layer}.geojson" >/dev/null || return 1
  done
}

for _ in $(seq 1 30); do
  if curl --max-time 3 --fail --silent http://127.0.0.1:8000/openapi.json >/dev/null \
    && thematic_map_data_ready \
    && curl --max-time 3 --fail --silent 'http://127.0.0.1:5000/nearest/v1/driving/116.4,39.9?number=1' >/dev/null; then
    echo "Offline navigation MVP: http://127.0.0.1:5173/"
    exit 0
  fi
  sleep 1
done

echo "MVP services did not become ready within 30 seconds" >&2
exit 1
