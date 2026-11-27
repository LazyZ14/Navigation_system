from fastapi import FastAPI

from app.api.gps import gps_websocket_router, router as gps_router
from app.api.voice import router as voice_router

app = FastAPI(title="Navigation GPS API", version="0.1.0")
app.include_router(voice_router)
app.include_router(gps_router)
app.include_router(gps_websocket_router)


@app.get('/api/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}
