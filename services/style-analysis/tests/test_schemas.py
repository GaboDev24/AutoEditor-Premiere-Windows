"""
Unit tests for the Style Analysis service.

Run with:  pytest tests/ -v
These tests use synthetic data and do not require a real video file
for the schema/structural tests. File-based tests are marked with @pytest.mark.integration
and require actual test assets in tests/fixtures/.
"""

from __future__ import annotations

import pytest

from schemas import (
    AnalyzeAudioRequest,
    AnalyzeScenesRequest,
    AnalyzeVideoRequest,
    AudioAnalysisResult,
    BeatTimestamp,
    DominantColor,
    SceneAnalysisResult,
    SceneCut,
    TransitionType,
    VideoStyleProfile,
)


class TestSchemaValidation:
    """Pydantic schema validation tests — no file I/O required."""

    def test_audio_result_valid(self) -> None:
        result = AudioAnalysisResult(
            file_path="/tmp/test.mp4",
            duration_seconds=60.0,
            bpm=120.0,
            beats=[
                BeatTimestamp(time_seconds=0.5, confidence=0.95),
                BeatTimestamp(time_seconds=1.0, confidence=0.88),
            ],
        )
        assert result.schema_version == 1
        assert result.bpm == 120.0
        assert len(result.beats) == 2

    def test_audio_result_rejects_negative_bpm(self) -> None:
        with pytest.raises(Exception):
            AudioAnalysisResult(
                file_path="/tmp/test.mp4",
                duration_seconds=60.0,
                bpm=-1.0,
                beats=[],
            )

    def test_beat_timestamp_confidence_out_of_range(self) -> None:
        with pytest.raises(Exception):
            BeatTimestamp(time_seconds=1.0, confidence=1.5)

    def test_scene_result_valid(self) -> None:
        result = SceneAnalysisResult(
            file_path="/tmp/test.mp4",
            total_duration_seconds=30.0,
            fps=25.0,
            scene_count=3,
            scenes=[
                SceneCut(start_frame=0, start_time_seconds=0.0, end_frame=25, end_time_seconds=1.0, duration_seconds=1.0),
                SceneCut(start_frame=25, start_time_seconds=1.0, end_frame=50, end_time_seconds=2.0, duration_seconds=1.0),
                SceneCut(start_frame=50, start_time_seconds=2.0, end_frame=75, end_time_seconds=3.0, duration_seconds=1.0),
            ],
        )
        assert result.schema_version == 1
        assert result.scene_count == 3

    def test_video_style_profile_valid(self) -> None:
        profile = VideoStyleProfile(
            file_path="/tmp/test.mp4",
            duration_seconds=120.0,
            fps=24.0,
            cuts_per_minute=15.0,
            avg_shot_duration_seconds=4.0,
            min_shot_duration_seconds=0.5,
            max_shot_duration_seconds=12.0,
            detected_transitions=[TransitionType.cut, TransitionType.dissolve],
            dominant_transition=TransitionType.cut,
            dominant_colors=[DominantColor(r=20, g=20, b=20, weight=0.6)],
            avg_brightness=50.0,
            avg_saturation=80.0,
            text_detected_in_frames=False,
            key_frame_paths=["/tmp/frame_000.jpg"],
        )
        assert profile.schema_version == 1
        assert profile.dominant_transition == TransitionType.cut

    def test_dominant_color_weight_out_of_range(self) -> None:
        with pytest.raises(Exception):
            DominantColor(r=0, g=0, b=0, weight=1.5)

    def test_analyze_audio_request_requires_file_path(self) -> None:
        with pytest.raises(Exception):
            AnalyzeAudioRequest()  # type: ignore[call-arg]

    def test_analyze_video_request_sample_frames_bounds(self) -> None:
        with pytest.raises(Exception):
            AnalyzeVideoRequest(file_path="/tmp/x.mp4", sample_frames=0)
        with pytest.raises(Exception):
            AnalyzeVideoRequest(file_path="/tmp/x.mp4", sample_frames=31)

    def test_analyze_scenes_threshold_bounds(self) -> None:
        with pytest.raises(Exception):
            AnalyzeScenesRequest(file_path="/tmp/x.mp4", threshold=0.0)


class TestSchemaVersionImmutability:
    """Schema version fields should be frozen and always equal 1."""

    def test_audio_version_frozen(self) -> None:
        r = AudioAnalysisResult(file_path="/f", duration_seconds=1.0, bpm=100.0, beats=[])
        with pytest.raises(Exception):
            r.schema_version = 2  # type: ignore[misc]

    def test_scene_version_frozen(self) -> None:
        r = SceneAnalysisResult(file_path="/f", total_duration_seconds=1.0, fps=25.0, scene_count=0, scenes=[])
        with pytest.raises(Exception):
            r.schema_version = 2  # type: ignore[misc]
