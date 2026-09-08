/**
 * ExtendScript host-side script for the AutoEditor CEP extension.
 * Loaded by Premiere Pro when the panel opens (via <ScriptPath> in manifest.xml).
 *
 * This file must be valid ExtendScript (ES3-compatible).
 * Do NOT use arrow functions, const/let, template literals, or classes.
 *
 * Provides utility functions that can be called from bridge.js via
 * csInterface.evalScript("functionName(args)").
 *
 * Compatible with Premiere Pro 2021 (v21.0) and later.
 */

/**
 * Ping function — used by the MCP server to verify Premiere is responding.
 * @returns {string} JSON string: { "pong": true, "version": "<premiere version>" }
 */
function autoeditorPing() {
  var version = app.version || "unknown";
  return JSON.stringify({ pong: true, version: version });
}

/**
 * Returns the name and frame rate of the active sequence.
 * Used as a lightweight health check before any editing operation.
 * @returns {string} JSON string with sequence name and fps, or an error object.
 */
function autoeditorGetActiveSequence() {
  var seq = app.project && app.project.activeSequence;
  if (!seq) {
    return JSON.stringify({ error: "No active sequence" });
  }
  return JSON.stringify({
    name: seq.name,
    frameRate: seq.getSettings().videoFrameRate.toString()
  });
}
