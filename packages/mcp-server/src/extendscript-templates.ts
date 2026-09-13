/**
 * ExtendScript templates for Premiere Pro operations.
 *
 * These scripts are evaluated in the Premiere Pro host via CEP/EvalScript.
 * Compatible with Premiere Pro 2021 (v21.0) and later.
 *
 * NOTE: ExtendScript runs in ES3. Do NOT use arrow functions, const/let,
 * template literals, or any ES5+ syntax in the returned script strings.
 * All values must be serialized as JSON strings and injected via the helpers.
 */

/** Escapes a string for safe injection into ExtendScript. */
function escStr(value: string): string {
  return JSON.stringify(value);
}

/**
 * Validates that a value is a safe integer before interpolating it
 * into an ExtendScript string. Throws if the value is not a finite
 * integer — prevents code injection via manipulated tool arguments.
 */
function safeInt(value: number, name: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`ExtendScript injection guard: "${name}" must be a finite integer, got ${value}`);
  }
  return value;
}

/**
 * Returns an ExtendScript snippet that imports a file into the active project.
 * Corresponds to MCP tool: importMedia
 *
 * @param filePath Absolute path to the media file.
 * @param binName  Target bin name. Created if it does not exist.
 */
export function importMediaScript(filePath: string, binName: string): string {
  return `
(function() {
  var proj = app.project;
  if (!proj) { return JSON.stringify({ error: "No active project" }); }
  var bin = proj.rootItem;
  var children = bin.children;
  var targetBin = null;
  for (var i = 0; i < children.numItems; i++) {
    if (children[i].name === ${escStr(binName)} && children[i].type === ProjectItemType.BIN) {
      targetBin = children[i];
      break;
    }
  }
  if (!targetBin) {
    targetBin = proj.rootItem.createBin(${escStr(binName)});
  }
  var importResult = proj.importFiles([${escStr(filePath)}], false, targetBin, false);
  return JSON.stringify({ success: importResult, bin: ${escStr(binName)} });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet that inserts a clip at a given time position
 * on a specific video or audio track.
 * Corresponds to MCP tool: insertClipAtTime
 *
 * @param projectItemIndex  Index of the project item to insert (0-based).
 * @param trackIndex        Track index (0-based).
 * @param startTimeTicks    Start time in Premiere ticks (1 tick = 1/254016000000 sec).
 * @param trackType         "video" or "audio"
 */
export function insertClipScript(
  projectItemIndex: number,
  trackIndex: number,
  startTimeTicks: string,
  trackType: "video" | "audio"
): string {
  const pi = safeInt(projectItemIndex, "projectItemIndex");
  const ti = safeInt(trackIndex, "trackIndex");
  const trackProperty = trackType === "video" ? "videoTracks" : "audioTracks";
  return `
(function() {
  var proj = app.project;
  var seq = proj.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var item = proj.rootItem.children[${pi}];
  if (!item) { return JSON.stringify({ error: "Project item not found at index ${pi}" }); }
  var track = seq.${trackProperty}[${ti}];
  if (!track) { return JSON.stringify({ error: "Track not found at index ${ti}" }); }
  var time = new Time();
  time.ticks = "${startTimeTicks}";
  var overwriteResult = track.insertClip(item, time);
  return JSON.stringify({ success: overwriteResult });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet that cuts a clip at a specific time.
 * Corresponds to MCP tool: cutClipAtTime
 *
 * @param trackIndex    Track index (0-based, video track).
 * @param timeTicks     Time at which to razor-cut (in Premiere ticks).
 */
export function cutClipAtTimeScript(trackIndex: number, timeTicks: string): string {
  const ti = safeInt(trackIndex, "trackIndex");
  return `
(function() {
  var seq = app.project.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var time = new Time();
  time.ticks = "${timeTicks}";
  seq.videoTracks[${ti}].razor(time);
  return JSON.stringify({ success: true, timeTicks: "${timeTicks}" });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet that removes a clip (clip item) from the timeline
 * and closes the gap by ripple-deleting.
 * Corresponds to MCP tool: removeClip
 *
 * @param trackIndex   Video track index (0-based).
 * @param clipIndex    Index of the clip within the track (0-based).
 */
export function removeClipScript(trackIndex: number, clipIndex: number): string {
  const ti = safeInt(trackIndex, "trackIndex");
  const ci = safeInt(clipIndex, "clipIndex");
  return `
(function() {
  var seq = app.project.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var track = seq.videoTracks[${ti}];
  if (!track) { return JSON.stringify({ error: "Track not found" }); }
  var clip = track.clips[${ci}];
  if (!clip) { return JSON.stringify({ error: "Clip not found" }); }
  clip.remove(false, true); // (false = do not ripple shift audio, true = ripple)
  return JSON.stringify({ success: true });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet to apply a transition between two adjacent clips.
 * Corresponds to MCP tool: applyTransition
 *
 * NOTE: Transition names must match the installed effect names in Premiere.
 * Common values: "Cross Dissolve", "Dip to Black", "Film Dissolve"
 *
 * @param trackIndex       Video track index (0-based).
 * @param clipIndex        Index of the first clip (transition applied at its end).
 * @param transitionName   Name of the transition effect.
 * @param durationTicks    Duration of the transition in ticks.
 * @param alignment        "start" | "center" | "end" of the cut point.
 */
export function applyTransitionScript(
  trackIndex: number,
  clipIndex: number,
  transitionName: string,
  durationTicks: string,
  alignment: "start" | "center" | "end"
): string {
  const ti = safeInt(trackIndex, "trackIndex");
  const ci = safeInt(clipIndex, "clipIndex");
  const alignMap = { start: 0, center: 1, end: 2 };
  const alignValue = alignMap[alignment];
  return `
(function() {
  var seq = app.project.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var track = seq.videoTracks[${ti}];
  if (!track) { return JSON.stringify({ error: "Track not found" }); }
  var clip = track.clips[${ci}];
  if (!clip) { return JSON.stringify({ error: "Clip not found" }); }
  var dur = new Time();
  dur.ticks = "${durationTicks}";
  var result = seq.videoTracks[${ti}].clips[${ci}].addTransition(
    ${escStr(transitionName)},
    ${alignValue},
    dur
  );
  return JSON.stringify({ success: !!result, transition: ${escStr(transitionName)} });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet to get the active sequence state.
 * Corresponds to MCP tool: getSequenceInfo
 * Returns JSON with: name, duration ticks, video/audio track counts, clip list.
 */
export function getSequenceInfoScript(): string {
  return `
(function() {
  var seq = app.project.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var videoTracks = [];
  for (var vi = 0; vi < seq.videoTracks.numTracks; vi++) {
    var clips = [];
    for (var ci = 0; ci < seq.videoTracks[vi].clips.numItems; ci++) {
      var c = seq.videoTracks[vi].clips[ci];
      clips.push({
        index: ci,
        name: c.name,
        startTicks: c.start.ticks,
        endTicks: c.end.ticks,
        durationTicks: c.duration.ticks
      });
    }
    videoTracks.push({ index: vi, clipCount: clips.length, clips: clips });
  }
  return JSON.stringify({
    name: seq.name,
    durationTicks: seq.end.ticks,
    videoTrackCount: seq.videoTracks.numTracks,
    audioTrackCount: seq.audioTracks.numTracks,
    videoTracks: videoTracks
  });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet to list all project items (non-bin) in the root.
 * Corresponds to MCP tool: listProjectItems
 */
export function listProjectItemsScript(): string {
  return `
(function() {
  var proj = app.project;
  if (!proj) { return JSON.stringify({ error: "No active project" }); }
  var result = [];
  var root = proj.rootItem;
  function walkItems(item, depth) {
    for (var i = 0; i < item.children.numItems; i++) {
      var child = item.children[i];
      if (child.type !== ProjectItemType.BIN) {
        result.push({ index: result.length, name: child.name, type: child.type, depth: depth });
      } else {
        walkItems(child, depth + 1);
      }
    }
  }
  walkItems(root, 0);
  return JSON.stringify({ items: result });
})();
`.trim();
}

/**
 * Returns an ExtendScript snippet to trigger an export using the AME queue.
 * Corresponds to MCP tool: exportSequence
 *
 * NOTE: This requires Adobe Media Encoder to be installed and open.
 * UXP does not support AME scripting as of Premiere Pro v25.2.
 *
 * @param outputPath       Absolute path for the output file.
 * @param presetPath       Absolute path to an .epr export preset file.
 */
export function exportSequenceScript(outputPath: string, presetPath: string): string {
  return `
(function() {
  var seq = app.project.activeSequence;
  if (!seq) { return JSON.stringify({ error: "No active sequence" }); }
  var encoder = app.encoder;
  if (!encoder) { return JSON.stringify({ error: "Adobe Media Encoder not available" }); }
  var result = encoder.encodeSequence(
    seq,
    ${escStr(outputPath)},
    ${escStr(presetPath)},
    encoder.ENCODE_WORKAREA,
    true
  );
  return JSON.stringify({ success: result, outputPath: ${escStr(outputPath)} });
})();
`.trim();
}
