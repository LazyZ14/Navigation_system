from fastapi import FastAPI

from app.api.gps import router as gps_router
from app.api.navigation import router as navigation_router, websocket_router
from app.api.routes import router

app = FastAPI(title="Offline Navigation API", version="0.1.0")
app.include_router(router)
app.include_router(gps_router)
app.include_router(navigation_router)
app.include_router(websocket_router)
