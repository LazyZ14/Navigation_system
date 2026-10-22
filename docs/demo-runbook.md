# Offline Navigation MVP Runbook

## Start

Prerequisites: Docker Desktop is running, `data/osrm/zhuhai.osrm*` has been built locally, and
`frontend/public/generated/roads.geojson` exists. These generated artifacts remain ignored by Git.

Run `bash scripts/demo.sh`, then open `http://127.0.0.1:5173/`.

The page starts with demo endpoints aligned to both synthetic tracks. Choose **正常路线** or
**偏航重规划**, click **规划路线**, then click **开始模拟回放**. You can still click the map to
replace the demo endpoints for route-only exploration. The same button pauses, resumes, and restarts a completed replay. The vehicle uses
the server's road-matched coordinate; a warning is shown if it cannot be matched. During normal replay,
the passed route turns gray, remaining distance decreases, and the state ends at **已到达目的地**.
During off-route replay, **已重新规划路线** is shown once and the active route is replaced in place.

## Verify

Run `bash scripts/smoke_test.sh`. It checks the local front-end, route API, and that the normal synthetic replay reaches `arrived`.
It also runs the deterministic off-route track and requires exactly one route replacement.

The Compose topology contains three local-only containers:

1. `frontend`: Nginx serves MapLibre and the generated offline road GeoJSON, and proxies `/api`.
2. `api`: FastAPI owns public routing and navigation-session state.
3. `osrm`: OSRM owns car routing and nearest-road matching.

The browser never calls OSRM directly.

## Stop

Run `docker compose down`.

All inputs are local WGS-84 synthetic tracks and ignored local OSRM/map artifacts. No cloud map, real GPS, or user trajectory is used.
