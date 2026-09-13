/**
 * Style Analysis API client.
 *
 * Thin HTTP wrapper around the Python FastAPI service running on localhost:8001.
 * The orchestrator calls this to get objective metrics before building the LLM context.
 */

import fetch from "node-fetch";

const BASE_URL = process.env.STYLE_ANALYSIS_URL ?? "http://localhost:8001";

export interface BeatTimestamp {
  time_seconds: number;
  confidence: number;
}

export interface AudioAnalysisResult {
  schema_version: number;
  file_path: string;
  duration_seconds: number;
  bpm: number;
  beats: BeatTimestamp[];
}

export interface SceneCut {
  start_frame: number;
  start_time_seconds: number;
  end_frame: number;
  end_time_seconds: number;
  duration_seconds: number;
}

export interface SceneAnalysisResult {
  schema_version: number;
  file_path: string;
  total_duration_seconds: number;
  fps: number;
  scene_count: number;
  scenes: SceneCut[];
}

export interface DominantColor {
  r: number;
  g: number;
  b: number;
  weight: number;
}

export interface VideoStyleProfile {
  schema_version: number;
  file_path: string;
  duration_seconds: number;
  fps: number;
  cuts_per_minute: number;
  avg_shot_duration_seconds: number;
  min_shot_duration_seconds: number;
  max_shot_duration_seconds: number;
  detected_transitions: string[];
  dominant_transition: string;
  dominant_colors: DominantColor[];
  avg_brightness: number;
  avg_saturation: number;
  text_detected_in_frames: boolean;
  key_frame_paths: string[];
}

/** Default timeout for all requests to the Style Analysis service (ms). */
const FETCH_TIMEOUT_MS = 30_000;

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Style Analysis API error ${res.status} on ${endpoint}: ${text}`);
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Style Analysis request timed out after ${FETCH_TIMEOUT_MS / 1000}s on ${endpoint}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeAudio(filePath: string): Promise<AudioAnalysisResult> {
  return post<AudioAnalysisResult>("/analyze/audio", { file_path: filePath });
}

export async function analyzeScenes(
  filePath: string,
  threshold = 27.0
): Promise<SceneAnalysisResult> {
  return post<SceneAnalysisResult>("/analyze/scenes", { file_path: filePath, threshold });
}

export async function analyzeVideo(
  filePath: string,
  sampleFrames = 8
): Promise<VideoStyleProfile> {
  return post<VideoStyleProfile>("/analyze/video", {
    file_path: filePath,
    sample_frames: sampleFrames,
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
