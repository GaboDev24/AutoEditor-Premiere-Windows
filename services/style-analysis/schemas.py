"""
Pydantic schemas for the Style Analysis service.

Version: 1
All schema changes must be backward-compatible or bump the version field.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared types
# ---------------------------------------------------------------------------

class TransitionType(str, Enum):
    """Detected transition types between scenes."""
    cut = "cut"
    dissolve = "dissolve"
    fade_to_black = "fade_to_black"
    fade_from_black = "fade_from_black"
    wipe = "wipe"
    unknown = "unknown"


# ---------------------------------------------------------------------------
# /analyze/audio — v1
# ---------------------------------------------------------------------------

class BeatTimestamp(BaseModel):
    """A single beat detected in the audio."""
    time_seconds: Annotated[float, Field(ge=0.0, description="Beat position in seconds.")]
    confidence: Annotated[float, Field(ge=0.0, le=1.0, description="Librosa beat confidence score (0–1).")]


class AudioAnalysisResult(BaseModel):
    """
    Result of POST /analyze/audio.
    Schema version: 1
    """
    schema_version: int = Field(1, frozen=True)
    file_path: str = Field(description="Absolute path of the analyzed audio/video file.")
    duration_seconds: float = Field(ge=0.0)
    bpm: Annotated[float, Field(ge=0.0, description="Estimated tempo in beats per minute.")]
    beats: list[BeatTimestamp] = Field(description="List of detected beat timestamps.")


# ---------------------------------------------------------------------------
# /analyze/scenes — v1
# ---------------------------------------------------------------------------

class SceneCut(BaseModel):
    """A detected scene cut (or hard cut between shots)."""
    start_frame: int = Field(ge=0)
    start_time_seconds: float = Field(ge=0.0)
    end_frame: int = Field(ge=0)
    end_time_seconds: float = Field(ge=0.0)
    duration_seconds: float = Field(ge=0.0)


class SceneAnalysisResult(BaseModel):
    """
    Result of POST /analyze/scenes.
    Schema version: 1
    """
    schema_version: int = Field(1, frozen=True)
    file_path: str
    total_duration_seconds: float = Field(ge=0.0)
    fps: float = Field(gt=0.0, description="Frame rate of the analyzed video.")
    scene_count: int = Field(ge=0)
    scenes: list[SceneCut]


# ---------------------------------------------------------------------------
# /analyze/video — v1
# ---------------------------------------------------------------------------

class DominantColor(BaseModel):
    """A dominant color sampled from key frames."""
    r: int = Field(ge=0, le=255)
    g: int = Field(ge=0, le=255)
    b: int = Field(ge=0, le=255)
    weight: Annotated[float, Field(ge=0.0, le=1.0, description="Approximate proportion of this color in sampled frames.")]


class VideoStyleProfile(BaseModel):
    """
    Result of POST /analyze/video.
    This is an objective metrics profile — subjective analysis is delegated to the LLM.
    Schema version: 1
    """
    schema_version: int = Field(1, frozen=True)
    file_path: str
    duration_seconds: float = Field(ge=0.0)
    fps: float = Field(gt=0.0)

    # Cut rhythm metrics
    cuts_per_minute: float = Field(ge=0.0, description="Average number of cuts per minute.")
    avg_shot_duration_seconds: float = Field(ge=0.0, description="Mean duration of a single shot/clip.")
    min_shot_duration_seconds: float = Field(ge=0.0)
    max_shot_duration_seconds: float = Field(ge=0.0)

    # Transition analysis
    detected_transitions: list[TransitionType] = Field(
        description="Transition types detected at scene boundaries (list may contain duplicates)."
    )
    dominant_transition: TransitionType = Field(description="Most frequently detected transition type.")

    # Color palette
    dominant_colors: list[DominantColor] = Field(description="Up to 5 dominant colors sampled from key frames.")
    avg_brightness: Annotated[float, Field(ge=0.0, le=255.0, description="Mean pixel brightness across sampled frames.")]
    avg_saturation: Annotated[float, Field(ge=0.0, le=255.0, description="Mean HSV saturation across sampled frames.")]

    # Text presence
    text_detected_in_frames: bool = Field(
        description="Whether on-screen text was detected in any sampled frame (simple heuristic, not OCR)."
    )

    # Key frames for LLM vision analysis
    key_frame_paths: list[str] = Field(
        description="Absolute paths to extracted key frame images for LLM visual analysis."
    )


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AnalyzeVideoRequest(BaseModel):
    file_path: str = Field(description="Absolute path to the video file.")
    sample_frames: int = Field(default=8, ge=1, le=30, description="Number of frames to sample for color/text analysis.")


class AnalyzeAudioRequest(BaseModel):
    file_path: str = Field(description="Absolute path to the audio or video file.")


class AnalyzeScenesRequest(BaseModel):
    file_path: str = Field(description="Absolute path to the video file.")
    threshold: float = Field(default=27.0, ge=1.0, le=100.0, description="PySceneDetect content detection threshold.")
