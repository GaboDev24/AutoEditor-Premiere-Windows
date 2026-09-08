"""
Style Analysis — analyzer modules.

Contains the pure analysis logic, separated from FastAPI routing.
Each function is independently testable without an HTTP server.
"""

from __future__ import annotations

import os
import tempfile
from collections import Counter
from pathlib import Path

import cv2
import librosa
import numpy as np
from scenedetect import SceneManager, open_video
from scenedetect.detectors import ContentDetector

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


# ---------------------------------------------------------------------------
# Audio analysis
# ---------------------------------------------------------------------------

def analyze_audio(request: AnalyzeAudioRequest) -> AudioAnalysisResult:
    """
    Detect tempo (BPM) and beat timestamps using librosa.

    If the input is a video file, librosa will load only the audio stream.
    Librosa supports: mp3, wav, ogg, flac, mp4, mov, mkv (via soundfile/ffmpeg backend).
    """
    file_path = request.file_path
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    y, sr = librosa.load(file_path, mono=True)
    duration_seconds = float(librosa.get_duration(y=y, sr=sr))

    tempo_arr, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    bpm = float(np.mean(tempo_arr)) if np.ndim(tempo_arr) > 0 else float(tempo_arr)

    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    # librosa does not expose per-beat confidence; we use a uniform value.
    beats = [
        BeatTimestamp(time_seconds=float(t), confidence=1.0)
        for t in beat_times
    ]

    return AudioAnalysisResult(
        file_path=file_path,
        duration_seconds=duration_seconds,
        bpm=bpm,
        beats=beats,
    )


# ---------------------------------------------------------------------------
# Scene detection
# ---------------------------------------------------------------------------

def analyze_scenes(request: AnalyzeScenesRequest) -> SceneAnalysisResult:
    """
    Detect scene/shot changes using PySceneDetect's ContentDetector.

    Returns a list of scene boundaries with start/end frame numbers and times.
    Uses the threshold parameter to control sensitivity — lower = more cuts detected.
    """
    file_path = request.file_path
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    video = open_video(file_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(ContentDetector(threshold=request.threshold))

    scene_manager.detect_scenes(video, show_progress=False)
    raw_scenes = scene_manager.get_scene_list()

    fps = video.frame_rate
    # Get total duration from the last scene's end time, or fallback to 0
    total_duration = raw_scenes[-1][1].get_seconds() if raw_scenes else 0.0

    scenes = []
    for start_tc, end_tc in raw_scenes:
        scenes.append(
            SceneCut(
                start_frame=start_tc.frame_num,
                start_time_seconds=start_tc.get_seconds(),
                end_frame=end_tc.frame_num,
                end_time_seconds=end_tc.get_seconds(),
                duration_seconds=end_tc.get_seconds() - start_tc.get_seconds(),
            )
        )

    return SceneAnalysisResult(
        file_path=file_path,
        total_duration_seconds=total_duration,
        fps=fps,
        scene_count=len(scenes),
        scenes=scenes,
    )


# ---------------------------------------------------------------------------
# Video style profile
# ---------------------------------------------------------------------------

_TRANSITION_THRESHOLD_FADE = 20.0  # Mean brightness below this → likely fade to/from black

def _sample_frames(cap: cv2.VideoCapture, n: int) -> list[np.ndarray]:
    """Extract n evenly-spaced frames from an open VideoCapture."""
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        return []
    indices = np.linspace(0, total - 1, min(n, total), dtype=int)
    frames = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ret, frame = cap.read()
        if ret:
            frames.append(frame)
    return frames


def _dominant_colors(frames: list[np.ndarray], k: int = 5) -> list[DominantColor]:
    """K-means on all sampled pixel colors to find dominant palette."""
    if not frames:
        return []

    pixels = np.vstack([
        f.reshape(-1, 3) for f in frames
    ]).astype(np.float32)

    # Subsample to at most 10 000 pixels for speed
    if len(pixels) > 10_000:
        idx = np.random.choice(len(pixels), 10_000, replace=False)
        pixels = pixels[idx]

    k = min(k, len(pixels))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, labels, centers = cv2.kmeans(
        pixels, k, None, criteria, 3, cv2.KMEANS_RANDOM_CENTERS
    )
    counts = Counter(labels.flatten().tolist())
    total = sum(counts.values())

    result = []
    for i, center in enumerate(centers):
        b, g, r = int(center[0]), int(center[1]), int(center[2])
        weight = counts[i] / total if total > 0 else 0.0
        result.append(DominantColor(r=r, g=g, b=b, weight=round(weight, 4)))

    result.sort(key=lambda c: c.weight, reverse=True)
    return result


def _detect_transition_type(prev_frame: np.ndarray, next_frame: np.ndarray) -> TransitionType:
    """
    Heuristic transition classification between two frames.
    This is intentionally coarse — subjective analysis is delegated to the LLM.
    """
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    next_gray = cv2.cvtColor(next_frame, cv2.COLOR_BGR2GRAY)

    prev_mean = float(np.mean(prev_gray))
    next_mean = float(np.mean(next_gray))

    if prev_mean < _TRANSITION_THRESHOLD_FADE:
        return TransitionType.fade_from_black
    if next_mean < _TRANSITION_THRESHOLD_FADE:
        return TransitionType.fade_to_black

    diff = cv2.absdiff(prev_gray, next_gray)
    mean_diff = float(np.mean(diff))

    if mean_diff < 10.0:
        return TransitionType.dissolve
    return TransitionType.cut


def _has_text_heuristic(frame: np.ndarray) -> bool:
    """
    Very simple text-presence heuristic using edge density.
    A high concentration of thin horizontal edges in a region suggests text.
    Not a replacement for OCR — the LLM receives key frames for visual analysis.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 200)
    edge_ratio = float(np.count_nonzero(edges)) / edges.size
    return edge_ratio > 0.04


def analyze_video(request: AnalyzeVideoRequest) -> VideoStyleProfile:
    """
    Extract objective style metrics from a video file.

    This function only computes measurable metrics. All subjective judgment
    (e.g., 'cinematic feel', 'aggressive pace') is intentionally omitted and
    delegated to the LLM orchestrator, which receives key_frame_paths for visual analysis.
    """
    file_path = request.file_path
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open file: {file_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_seconds = total_frames / fps if fps > 0 else 0.0

    frames = _sample_frames(cap, request.sample_frames)
    cap.release()

    # Color metrics
    dominant_colors = _dominant_colors(frames, k=5)

    brightness_values = [float(np.mean(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))) for f in frames]
    avg_brightness = float(np.mean(brightness_values)) if brightness_values else 0.0

    saturation_values = []
    for f in frames:
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        saturation_values.append(float(np.mean(hsv[:, :, 1])))
    avg_saturation = float(np.mean(saturation_values)) if saturation_values else 0.0

    # Text heuristic
    text_detected = any(_has_text_heuristic(f) for f in frames)

    # Scene/cut analysis (reuse analyze_scenes)
    scene_result = analyze_scenes(
        AnalyzeScenesRequest(file_path=file_path, threshold=27.0)
    )
    cuts_per_minute = (
        scene_result.scene_count / (duration_seconds / 60.0)
        if duration_seconds > 0 else 0.0
    )
    shot_durations = [s.duration_seconds for s in scene_result.scenes]
    avg_shot = float(np.mean(shot_durations)) if shot_durations else duration_seconds
    min_shot = float(min(shot_durations)) if shot_durations else 0.0
    max_shot = float(max(shot_durations)) if shot_durations else duration_seconds

    # Transition heuristics between adjacent sampled frames
    detected_transitions: list[TransitionType] = []
    for i in range(len(frames) - 1):
        t = _detect_transition_type(frames[i], frames[i + 1])
        detected_transitions.append(t)

    if detected_transitions:
        dominant_transition = Counter(detected_transitions).most_common(1)[0][0]
    else:
        dominant_transition = TransitionType.cut

    # Export key frames for LLM vision analysis
    tmp_dir = tempfile.mkdtemp(prefix="autoeditor_keyframes_")
    key_frame_paths: list[str] = []
    for i, frame in enumerate(frames):
        frame_path = os.path.join(tmp_dir, f"frame_{i:03d}.jpg")
        cv2.imwrite(frame_path, frame)
        key_frame_paths.append(frame_path)

    return VideoStyleProfile(
        file_path=file_path,
        duration_seconds=duration_seconds,
        fps=fps,
        cuts_per_minute=round(cuts_per_minute, 2),
        avg_shot_duration_seconds=round(avg_shot, 3),
        min_shot_duration_seconds=round(min_shot, 3),
        max_shot_duration_seconds=round(max_shot, 3),
        detected_transitions=detected_transitions,
        dominant_transition=dominant_transition,
        dominant_colors=dominant_colors,
        avg_brightness=round(avg_brightness, 2),
        avg_saturation=round(avg_saturation, 2),
        text_detected_in_frames=text_detected,
        key_frame_paths=key_frame_paths,
    )
