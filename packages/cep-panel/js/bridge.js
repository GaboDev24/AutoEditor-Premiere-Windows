/**
 * AutoEditor CEP Bridge — bridge.js
 *
 * Runs inside the CEP panel WebView (Chromium embedded in Premiere Pro).
 * Opens a TCP server using the Node.js `net` module (available in CEP via
 * the --nodeIntegration flag) on port 3201.
 *
 * Protocol (length-prefixed JSON):
 *   Client sends:  [4-byte big-endian uint32 length][UTF-8 JSON payload]
 *   Server replies: [4-byte big-endian uint32 length][UTF-8 JSON result]
 *
 * Payload schema:
 *   { "type": "evalScript", "script": "<ExtendScript string>" }
 *
 * Result schema (forwarded directly from Premiere's evalScript callback):
 *   Any JSON-parseable string, or { "rawResponse": "<string>" } on parse failure.
 *
 * Compatible with Premiere Pro 2021 (v21.0) and later.
 */

"use strict";

/* global CSInterface */

var cs = new CSInterface();
var PORT = parseInt(process.env.CEP_PORT || "3201", 10);
var net = require("net");

var statusDot  = document.getElementById("status-dot");
var statusText = document.getElementById("status-text");
var logEl      = document.getElementById("log");
var MAX_LOG_ENTRIES = 40;
var logEntries = [];

function appendLog(text, cls) {
  logEntries.push({ text: text, cls: cls || "entry" });
  if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();
  logEl.innerHTML = logEntries.map(function(e) {
    return '<div class="' + e.cls + '">' + escHtml(e.text) + "</div>";
  }).join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setStatus(connected, text) {
  statusDot.className = connected ? "connected" : "error";
  statusText.textContent = text;
}

/** Read a complete length-prefixed message from the accumulated buffer. */
function tryReadMessage(buffer) {
  if (buffer.length < 4) return null;
  var length = buffer.readUInt32BE(0);
  if (buffer.length < 4 + length) return null;
  var payload = buffer.slice(4, 4 + length).toString("utf8");
  var remaining = buffer.slice(4 + length);
  return { payload: payload, remaining: remaining };
}

/** Write a length-prefixed JSON response to a socket. */
function writeResponse(socket, obj) {
  var json = JSON.stringify(obj);
  var jsonBuf = Buffer.from(json, "utf8");
  var lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(jsonBuf.length, 0);
  socket.write(Buffer.concat([lenBuf, jsonBuf]));
}

var server = net.createServer(function(socket) {
  var buffer = Buffer.alloc(0);
  appendLog("Client connected", "ok");

  socket.on("data", function(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    var msg;
    while ((msg = tryReadMessage(buffer)) !== null) {
      buffer = msg.remaining;
      handleMessage(socket, msg.payload);
    }
  });

  socket.on("error", function(err) {
    appendLog("Socket error: " + err.message, "err");
  });

  socket.on("close", function() {
    appendLog("Client disconnected");
  });
});

function handleMessage(socket, payload) {
  var request;
  try {
    request = JSON.parse(payload);
  } catch (e) {
    writeResponse(socket, { error: "Invalid JSON payload" });
    return;
  }

  if (request.type !== "evalScript" || typeof request.script !== "string") {
    writeResponse(socket, { error: "Unknown message type or missing script" });
    return;
  }

  appendLog("evalScript: " + request.script.slice(0, 60) + (request.script.length > 60 ? "..." : ""));

  cs.evalScript(request.script, function(result) {
    var parsed;
    try {
      parsed = JSON.parse(result);
    } catch (_e) {
      parsed = { rawResponse: result };
    }
    writeResponse(socket, parsed);
    appendLog("Result: " + JSON.stringify(parsed).slice(0, 60), "ok");
  });
}

server.on("error", function(err) {
  setStatus(false, "Error: " + err.message);
  appendLog("Server error: " + err.message, "err");
});

server.listen(PORT, "127.0.0.1", function() {
  setStatus(true, "Bridge active on port " + PORT);
  appendLog("Listening on 127.0.0.1:" + PORT, "ok");
});

// Graceful shutdown when Premiere closes
window.addEventListener("unload", function() {
  server.close();
});
