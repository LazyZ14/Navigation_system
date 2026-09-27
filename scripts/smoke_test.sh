#!/usr/bin/env bash
set -euo pipefail

api_base=${API_BASE_URL:-http://127.0.0.1:8000}

require_local_get() {
  local name=$1
  local url=$2
  if ! curl --max-time 3 --fail --silent "$url" >/dev/null; then
    echo "$name is unavailable at $url" >&2
    exit 1
  fi
}

require_local_get "frontend" "http://127.0.0.1:5173/"
require_local_get "offline map data" "http://127.0.0.1:5173/generated/map-roads.geojson"
route=$(curl --max-time 3 --fail --silent -X POST "$api_base/api/routes" -H 'content-type: application/json' -d '{"origin":{"lat":39.9000,"lon":116.4000},"destination":{"lat":39.8994,"lon":116.4040}}')
python3 -c 'import json,sys; assert json.load(sys.stdin)["geometry"]' <<<"$route"
session=$(curl --max-time 3 --fail --silent -X POST "$api_base/api/navigation/sessions" -H 'content-type: application/json' -d '{"origin":{"lat":39.9000,"lon":116.4000},"destination":{"lat":39.8994,"lon":116.4040},"track_id":"normal-route"}')
session_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])' <<<"$session")
normal_arrived=0
for _ in $(seq 1 10); do
  state=$(curl --max-time 3 --fail --silent -X POST "$api_base/api/navigation/$session_id/replay/next")
  if python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin)["state"]["status"] == "arrived" else 1)' <<<"$state"; then
    normal_arrived=1
    break
  fi
done
if [[ "$normal_arrived" != "1" ]]; then
  echo "normal replay did not arrive" >&2
  exit 1
fi

off_route_session=$(curl --max-time 3 --fail --silent -X POST "$api_base/api/navigation/sessions" -H 'content-type: application/json' -d '{"origin":{"lat":39.9000,"lon":116.4000},"destination":{"lat":39.8994,"lon":116.4040},"track_id":"off-route"}')
off_route_session_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])' <<<"$off_route_session")
replan_count=0
for _ in $(seq 1 10); do
  state=$(curl --max-time 3 --fail --silent -X POST "$api_base/api/navigation/$off_route_session_id/replay/next")
  if python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin)["state"]["off_route"] else 1)' <<<"$state"; then
    replan_count=$((replan_count + 1))
  fi
  if python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin)["state"]["status"] == "arrived" else 1)' <<<"$state"; then
    break
  fi
done
if [[ "$replan_count" != "1" ]]; then
  echo "off-route replay expected one replan, got $replan_count" >&2
  exit 1
fi

echo "smoke test passed: route, normal arrival, and one off-route replan"
