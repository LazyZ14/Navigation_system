# Remove offline navigation implementation plan

**Goal:** Remove the retired MapLibre/OSRM stack and local map artifacts; retain AMap live/demo navigation, the device-independent GPS bus, iOS sending/recording and optional speech transcription.

**Approved scope:** User approved the full cleanup in this chat. Work on `codex/remove-offline-navigation`, based on `feature/amap-live-gps`; do not modify or merge PR #2.

**Architecture:** AMap remains responsible for route planning/rendering. Keep its WGS-84/GCJ-02 conversion, route matching, jitter filtering and recalculation controller. FastAPI retains GPS and optional transcription only. Root page redirects to AMap. Remove the OSM-dependent POI/intent API and its retired frontend, retaining AMap's current intent parser.

**Execution:** Inline, in the current checkout; no extra worktree or new dependencies.

## Tasks

- [x] Add failing checks for retired API routes, privacy ignore rules and the two-service container configuration; observe failures.
- [x] Remove offline-only frontend modules/tests and MapLibre dependency, backend routes/models/services/tests, map construction/demo scripts, synthetic replay fixtures and local map artifacts. Update remaining GPS tests to remove retired dependencies.
- [x] Keep optional `/api/voice/transcribe` and its existing limits/error tests. Remove OSM POI, local LLM intent and evaluation code that depend on the retired stack.
- [x] Redirect `/` to `/amap.html`, update Vite and containers, add a health endpoint and a small local smoke check.
- [x] Broaden `.gitignore` and add `.dockerignore` for credentials, location recordings and build output; leave blank examples trackable. Scan tracked files and reachable Git history without printing credential values.
- [x] Update README, architecture, development/data policies and AGENTS for the single AMap stack; remove obsolete offline map guides, retain historical plans with clear historical status.
- [x] Run backend and frontend suites, build, compose validation, privacy scan and final review. Do not call paid APIs or commit real positioning data. Report unverified real-device/deployment behavior.

## Review focus

- AMap matcher must survive removal of the separate offline route matcher.
- GPS payloads/authentication/streaming must remain hardware independent.
- Unknown legacy API paths must no longer invoke OSRM or a local POI catalog.
- `.env.production`, exported recordings and signing/private keys must be ignored at arbitrary depths, while blank examples remain trackable.
- Docker context and repository ignore rules must both exclude secrets; ignored Vite build output can still contain client-side map credentials and must not be committed.

## Verification record

- RED: scope/privacy/container tests initially reported 16 expected failures and 7 passes.
- GREEN: `cd backend && .venv/bin/python -m pytest -q`: 57 passed (two existing dependency deprecation warnings).
- `npm --prefix frontend test`: 26 passed; `npm --prefix frontend run build`: success, no old MapLibre bundle.
- `docker compose config --quiet` and `bash -n scripts/smoke_test.sh`: success. No container image was built.
- Live local smoke: API health, frontend proxy, AMap HTML and GPS snapshot passed. A synthetic 0/0 fix was accepted by HTTP and received through the frontend WebSocket proxy. No paid API calls or real location fixtures were used.
- Static final review: no severe regressions identified. Real-device navigation was not repeated after this cleanup; iOS source was not changed.
- History scan: 492 reachable blobs checked for known local credentials and recognizable secret formats. Old AMap credential constants found in historical configuration blobs; introduction `28cba08`, removal `87a2a5b`. Both current local AMap credential values matched history. User must rotate in the provider console; no history rewrite performed.
- Branch remains local with uncommitted changes for review; PR #2 and existing branches are untouched.
- Both temporary services stopped. The pre-existing idle WebSocket subscription cleanup issue required cancellation after the configured graceful-shutdown timeout; no GPS lifecycle behavior was changed in this cleanup.
