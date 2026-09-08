/**
 * AutoEditor UXP Panel — index.js
 *
 * Runs inside Premiere Pro's UXP runtime (v25.2+).
 * Opens a WebSocket server on port 3200, receives command payloads
 * from the MCP server's bridge.ts, executes them via the Premiere UXP DOM API,
 * and returns JSON results.
 *
 * Command payload schema:
 *   { "command": "<commandName>", "params": { ... } }
 *
 * Result schema:
 *   { "success": true, ... } or { "error": "<message>" }
 *
 * Available commands (mirrors the ExtendScript paths in extendscript-templates.ts):
 *   - ping
 *   - getSequenceInfo
 *   - importMedia       (params: filePath, binName)
 *   - insertClipAtTime  (params: projectItemIndex, trackIndex, startTimeTicks, trackType)
 *   - cutClipAtTime     (params: trackIndex, timeTicks)
 *   - removeClip        (params: trackIndex, clipIndex)
 *   - applyTransition   (params: trackIndex, clipIndex, transitionName, durationTicks, alignment)
 *
 * NOTE: exportSequence and applyLumetriColorPreset are NOT available here.
 * Those always route through the ExtendScript path regardless of Premiere version.
 */

"use strict";

/* global require, premierepro */

// UXP provides a built-in 'websocket' server via the uxp.networking API in newer builds.
// For broader compatibility we use the uxp.shell.WebSocketServer if available,
// otherwise fall back to a polling approach with a note in the UI.
const uxp = require("uxp");
const ppro = require("premierepro");

const PORT = parseInt(process.env.UXP_WS_PORT || "3200", 10);
const statusDot  = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const logEl      = document.getElementById("log");

let logLines = [];
const MAX_LINES = 30;

function log(text, type = "info") {
  const colors = { info: "#8888a0", ok: "#22c55e", err: "#ef4444" };
  logLines.push(`<span style="color:${colors[type] || colors.info}">${esc(text)}</span>`);
  if (logLines.length > MAX_LINES) logLines.shift();
  logEl.innerHTML = logLines.join("<br>");
  logEl.scrollTop = logEl.scrollHeight;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setStatus(connected, text) {
  statusDot.className = connected ? "connected" : "error";
  statusText.textContent = text;
}

// ---------------------------------------------------------------------------
// Command handlers using Premiere UXP DOM API
// ---------------------------------------------------------------------------

async function cmdPing() {
  const app = ppro.app;
  return { pong: true, version: app.version };
}

async function cmdGetSequenceInfo() {
  const app = ppro.app;
  const seq = app.project?.activeSequence;
  if (!seq) return { error: "No active sequence" };

  const videoTracks = [];
  const trackCount = seq.videoTracks?.length ?? 0;
  for (let vi = 0; vi < trackCount; vi++) {
    const track = seq.videoTracks[vi];
    const clips = [];
    const clipCount = track.clips?.length ?? 0;
    for (let ci = 0; ci < clipCount; ci++) {
      const c = track.clips[ci];
      clips.push({
        index: ci,
        name: c.name,
        startTicks: c.start?.ticks?.toString() ?? "0",
        endTicks: c.end?.ticks?.toString() ?? "0",
      });
    }
    videoTracks.push({ index: vi, clipCount, clips });
  }

  return {
    name: seq.name,
    durationTicks: seq.end?.ticks?.toString() ?? "0",
    videoTrackCount: trackCount,
    audioTrackCount: seq.audioTracks?.length ?? 0,
    videoTracks,
  };
}

async function cmdImportMedia({ filePath, binName = "Imports" }) {
  const app = ppro.app;
  const project = app.project;
  if (!project) return { error: "No active project" };

  let targetBin = null;
  for (const child of project.rootItem.children ?? []) {
    if (child.name === binName && child.type === "bin") {
      targetBin = child;
      break;
    }
  }
  if (!targetBin) {
    targetBin = await project.rootItem.createBin(binName);
  }
  const result = await project.importFiles([filePath], false, targetBin, false);
  return { success: result, bin: binName };
}

async function cmdInsertClipAtTime({ projectItemIndex, trackIndex, startTimeTicks, trackType = "video" }) {
  const app = ppro.app;
  const seq = app.project?.activeSequence;
  if (!seq) return { error: "No active sequence" };

  const item = app.project.rootItem.children?.[projectItemIndex];
  if (!item) return { error: `No project item at index ${projectItemIndex}` };

  const tracks = trackType === "video" ? seq.videoTracks : seq.audioTracks;
  const track = tracks?.[trackIndex];
  if (!track) return { error: `No track at index ${trackIndex}` };

  const time = new ppro.Time();
  time.ticks = BigInt(startTimeTicks);
  const result = await track.insertClip(item, time);
  return { success: !!result };
}

async function cmdCutClipAtTime({ trackIndex, timeTicks }) {
  const app = ppro.app;
  const seq = app.project?.activeSequence;
  if (!seq) return { error: "No active sequence" };

  const track = seq.videoTracks?.[trackIndex];
  if (!track) return { error: `No video track at index ${trackIndex}` };

  const time = new ppro.Time();
  time.ticks = BigInt(timeTicks);
  await track.razor(time);
  return { success: true, timeTicks };
}

async function cmdRemoveClip({ trackIndex, clipIndex }) {
  const app = ppro.app;
  const seq = app.project?.activeSequence;
  if (!seq) return { error: "No active sequence" };

  const clip = seq.videoTracks?.[trackIndex]?.clips?.[clipIndex];
  if (!clip) return { error: `No clip at track ${trackIndex} index ${clipIndex}` };

  await clip.remove(false, true);
  return { success: true };
}

async function cmdApplyTransition({ trackIndex, clipIndex, transitionName, durationTicks, alignment = "center" }) {
  const app = ppro.app;
  const seq = app.project?.activeSequence;
  if (!seq) return { error: "No active sequence" };

  const clip = seq.videoTracks?.[trackIndex]?.clips?.[clipIndex];
  if (!clip) return { error: `No clip at track ${trackIndex} index ${clipIndex}` };

  const alignMap = { start: 0, center: 1, end: 2 };
  const dur = new ppro.Time();
  dur.ticks = BigInt(durationTicks);
  const result = await clip.addTransition(transitionName, alignMap[alignment] ?? 1, dur);
  return { success: !!result, transition: transitionName };
}

const HANDLERS = {
  ping:             cmdPing,
  getSequenceInfo:  cmdGetSequenceInfo,
  importMedia:      cmdImportMedia,
  insertClipAtTime: cmdInsertClipAtTime,
  cutClipAtTime:    cmdCutClipAtTime,
  removeClip:       cmdRemoveClip,
  applyTransition:  cmdApplyTransition,
};

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

async function startServer() {
  try {
    const server = new uxp.networking.WebSocketServer({ port: PORT });

    server.addEventListener("connection", (event) => {
      const ws = event.socket;
      log(`Client connected`, "ok");

      ws.addEventListener("message", async (msgEvent) => {
        let request;
        try {
          request = JSON.parse(msgEvent.data);
        } catch {
          ws.send(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }

        const handler = HANDLERS[request.command];
        if (!handler) {
          ws.send(JSON.stringify({ error: `Unknown command: ${request.command}` }));
          return;
        }

        log(`cmd: ${request.command}`);
        try {
          const result = await handler(request.params ?? {});
          ws.send(JSON.stringify(result));
          log(`ok: ${request.command}`, "ok");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ error: msg }));
          log(`err: ${msg}`, "err");
        }
      });

      ws.addEventListener("close", () => log("Client disconnected"));
      ws.addEventListener("error", (e) => log(`WS error: ${e.message}`, "err"));
    });

    setStatus(true, `UXP bridge active on port ${PORT}`);
    log(`Listening on ws://localhost:${PORT}`, "ok");
  } catch (err) {
    setStatus(false, `Failed: ${err.message}`);
    log(`Server error: ${err.message}`, "err");
  }
}

startServer();
