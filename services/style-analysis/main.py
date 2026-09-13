"""
Style Analysis Service — FastAPI application.

Runs locally on port 8001 (configurable via PORT env var).
Start with: uvicorn main:app --reload --port 8001
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from analyzers import analyze_audio, analyze_scenes, analyze_video
from schemas import (
    AnalyzeAudioRequest,
    AnalyzeScenesRequest,
    AnalyzeVideoRequest,
    AudioAnalysisResult,
    SceneAnalysisResult,
    VideoStyleProfile,
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle."""
    print("Style Analysis service started.")
    yield
    print("Style Analysis service stopped.")


app = FastAPI(
    title="AutoEditor Style Analysis",
    description=(
        "Local microservice that extracts objective style metrics from video and audio files. "
        "Subjective analysis is intentionally delegated to the LLM orchestrator."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3100"],
    allow_methods=["POST", "GET"],
    # Explicit allowlist — avoid wildcard to prevent accepting arbitrary custom headers.
    allow_headers=["Content-Type", "Accept"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "style-analysis"}


@app.post("/analyze/audio", response_model=AudioAnalysisResult)
def endpoint_analyze_audio(request: AnalyzeAudioRequest) -> AudioAnalysisResult:
    """
    Analyze tempo and beat timestamps from an audio or video file.

    Returns BPM and a list of beat positions in seconds.
    """
    try:
        return analyze_audio(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis error: {exc}") from exc


@app.post("/analyze/scenes", response_model=SceneAnalysisResult)
def endpoint_analyze_scenes(request: AnalyzeScenesRequest) -> SceneAnalysisResult:
    """
    Detect scene/shot changes in a video file.

    Returns a list of scene boundaries with start/end times and frame numbers.
    Useful for finding where natural cuts already exist in raw footage.
    """
    try:
        return analyze_scenes(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis error: {exc}") from exc


@app.post("/analyze/video", response_model=VideoStyleProfile)
def endpoint_analyze_video(request: AnalyzeVideoRequest) -> VideoStyleProfile:
    """
    Extract an objective style profile from a video file.

    Returns cut rhythm, color palette, brightness, and key frames for LLM analysis.
    This endpoint does NOT make subjective judgments about the video's style.
    """
    try:
        return analyze_video(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis error: {exc}") from exc
