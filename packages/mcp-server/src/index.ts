import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PremiereBridge } from "./bridge.js";
import { secondsToTicksString } from "./time-utils.js";
import {
  importMediaScript,
  insertClipScript,
  cutClipAtTimeScript,
  removeClipScript,
  applyTransitionScript,
  getSequenceInfoScript,
  listProjectItemsScript,
  exportSequenceScript,
} from "./extendscript-templates.js";

const bridge = new PremiereBridge();
const server = new McpServer({
  name: "premiere-mcp",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tool: importMedia
// ---------------------------------------------------------------------------
server.tool(
  "importMedia",
  "Import a media file into the active Premiere Pro project. Works via CEP/ExtendScript on all Premiere versions from 2021+.",
  {
    filePath: z.string().describe("Absolute path to the media file to import."),
    binName: z.string().default("Imports").describe("Name of the bin to place the imported item in."),
  },
  async ({ filePath, binName }) => {
    const script = importMediaScript(filePath, binName);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error importing media: ${result.error}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Imported "${filePath}" into bin "${binName}".` }],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: listProjectItems
// ---------------------------------------------------------------------------
server.tool(
  "listProjectItems",
  "List all non-bin project items in the active Premiere Pro project, returning their names and indices. Use to discover what clips are available before editing.",
  {},
  async () => {
    const script = listProjectItemsScript();
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error listing items: ${result.error}` }], isError: true };
    }
    const items = result.items as Array<{ index: number; name: string; type: number }>;
    const lines = items.map((i) => `[${i.index}] ${i.name} (type: ${i.type})`);
    return { content: [{ type: "text", text: lines.join("\n") || "No items found." }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: getSequenceInfo
// ---------------------------------------------------------------------------
server.tool(
  "getSequenceInfo",
  "Get information about the active sequence: name, duration, track counts, and a list of all clips on video tracks with their start/end times. Call this before making edits to understand the current timeline state.",
  {},
  async () => {
    const script = getSequenceInfoScript();
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error getting sequence info: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: insertClipAtTime
// ---------------------------------------------------------------------------
server.tool(
  "insertClipAtTime",
  "Insert a project item (by index) onto a video or audio track at a given time position (in seconds). Use listProjectItems to get indices.",
  {
    projectItemIndex: z.number().int().min(0).describe("Index of the project item to insert."),
    trackIndex: z.number().int().min(0).default(0).describe("Video or audio track index (0-based)."),
    startTimeSeconds: z.number().min(0).describe("Start time in seconds where the clip will be placed."),
    trackType: z.enum(["video", "audio"]).default("video").describe("Whether to insert on a video or audio track."),
  },
  async ({ projectItemIndex, trackIndex, startTimeSeconds, trackType }) => {
    const ticks = secondsToTicksString(startTimeSeconds);
    const script = insertClipScript(projectItemIndex, trackIndex, ticks, trackType);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error inserting clip: ${result.error}` }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `Inserted project item ${projectItemIndex} on ${trackType} track ${trackIndex} at ${startTimeSeconds}s.`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: cutClipAtTime
// ---------------------------------------------------------------------------
server.tool(
  "cutClipAtTime",
  "Razor-cut (split) all clips on a video track at a specific time position. The two resulting clip segments remain in the timeline.",
  {
    trackIndex: z.number().int().min(0).default(0).describe("Video track index (0-based)."),
    timeSeconds: z.number().min(0).describe("Time position in seconds at which to cut."),
  },
  async ({ trackIndex, timeSeconds }) => {
    const ticks = secondsToTicksString(timeSeconds);
    const script = cutClipAtTimeScript(trackIndex, ticks);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error cutting clip: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: `Cut track ${trackIndex} at ${timeSeconds}s.` }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: removeClip
// ---------------------------------------------------------------------------
server.tool(
  "removeClip",
  "Remove a clip from the timeline by track and clip index (ripple-delete, closing the gap). Use getSequenceInfo to obtain clip indices.",
  {
    trackIndex: z.number().int().min(0).default(0).describe("Video track index (0-based)."),
    clipIndex: z.number().int().min(0).describe("Clip index within the track (0-based)."),
  },
  async ({ trackIndex, clipIndex }) => {
    const script = removeClipScript(trackIndex, clipIndex);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error removing clip: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text", text: `Removed clip ${clipIndex} from track ${trackIndex}.` }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: applyTransition
// ---------------------------------------------------------------------------
server.tool(
  "applyTransition",
  "Apply a video transition at the end of a clip. Common transition names: 'Cross Dissolve', 'Dip to Black', 'Film Dissolve'.",
  {
    trackIndex: z.number().int().min(0).default(0).describe("Video track index (0-based)."),
    clipIndex: z.number().int().min(0).describe("Clip index. The transition is applied at the end of this clip."),
    transitionName: z.string().default("Cross Dissolve").describe("Name of the transition effect as it appears in Premiere."),
    durationSeconds: z.number().min(0.1).default(0.5).describe("Duration of the transition in seconds."),
    alignment: z.enum(["start", "center", "end"]).default("center").describe("Alignment of the transition relative to the cut point."),
  },
  async ({ trackIndex, clipIndex, transitionName, durationSeconds, alignment }) => {
    const durationTicks = secondsToTicksString(durationSeconds);
    const script = applyTransitionScript(trackIndex, clipIndex, transitionName, durationTicks, alignment);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error applying transition: ${result.error}` }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `Applied "${transitionName}" (${durationSeconds}s, ${alignment}) to clip ${clipIndex} on track ${trackIndex}.`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: exportSequence
// ---------------------------------------------------------------------------
server.tool(
  "exportSequence",
  "Export the active sequence using Adobe Media Encoder. Requires AME to be installed and open. NOTE: This always uses ExtendScript regardless of Premiere version, as the AME scripting API is not available via UXP as of Premiere Pro v25.2.",
  {
    outputPath: z.string().describe("Absolute path for the output file (e.g., C:/videos/output.mp4)."),
    presetPath: z.string().describe("Absolute path to an Adobe Media Encoder .epr export preset file."),
  },
  async ({ outputPath, presetPath }) => {
    // Always use ExtendScript for export — AME scripting is not in UXP API
    const script = exportSequenceScript(outputPath, presetPath);
    const result = await bridge.evalExtendScript(script);
    if (result.error) {
      return { content: [{ type: "text", text: `Error exporting: ${result.error}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: `Export queued. Output: ${outputPath}` }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Premiere MCP server running. Bridge mode: ${bridge.mode}`);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
