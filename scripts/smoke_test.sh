#!/usr/bin/env bash
set -euo pipefail

api_base="${API_BASE_URL:-http://127.0.0.1:8000}"
frontend_base="${FRONTEND_BASE_URL:-http://127.0.0.1:5173}"

curl --noproxy '*' --max-time 5 --fail --silent --show-error "$api_base/api/health" \
  | python3 -c 'import json,sys; assert json.load(sys.stdin) == {"status": "ok"}'
curl --noproxy '*' --max-time 5 --fail --silent --show-error "$frontend_base/api/health" \
  | python3 -c 'import json,sys; assert json.load(sys.stdin) == {"status": "ok"}'
curl --noproxy '*' --max-time 5 --fail --silent --show-error "$frontend_base/amap.html?mode=live" --output /dev/null
curl --noproxy '*' --max-time 5 --fail --silent --show-error "$frontend_base/api/gps/latest" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d["active"], bool); print("Local checks passed; GPS online:", d["active"])'
