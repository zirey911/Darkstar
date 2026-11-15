"""Darkstar health and educational chat API."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from darkstar_navigation.chat import router
from darkstar_navigation.config import load_environment
from darkstar_navigation.environment import router as environment_router
from darkstar_navigation.geology import router as geology_router
from darkstar_navigation.marswalk import router as marswalk_router
from darkstar_navigation.terrain import router as terrain_router
from darkstar_navigation.terrain_view import router as terrain_view_router

load_environment()

app = FastAPI(title="Darkstar Navigation", version="0.1.0")
app.include_router(router)
app.include_router(terrain_router)
app.include_router(marswalk_router)
app.include_router(geology_router)
app.include_router(environment_router)
app.include_router(terrain_view_router)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
