from fastapi import FastAPI

from app.api.navigation import router as navigation_router, websocket_router
from app.api.routes import router
from app.api.voice import router as voice_router

app = FastAPI(title="Offline Navigation API", version="0.1.0")
app.include_router(router)
app.include_router(voice_router)
app.include_router(navigation_router)
app.include_router(websocket_router)
