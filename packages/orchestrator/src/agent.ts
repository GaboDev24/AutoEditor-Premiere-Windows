/**
 * Orchestrator agent.
 *
 * Assembles context for the LLM from:
 *   1. The current Premiere Pro sequence state (via MCP getSequenceInfo / listProjectItems)
 *   2. Style analysis results from the Python service (audio beats, scene cuts, video profile)
 *   3. The user's natural language instruction
 *
 * Then runs an agentic loop: the LLM decides which MCP tools to call, the agent
 * executes them, feeds results back, and repeats until stop_reason is "end_turn".
 *
 * Tool calls are executed sequentially to avoid race conditions in the Premiere timeline.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type LlmBackend, type LlmMessage, type LlmTool, type LlmToolCall } from "./llm.js";
import { analyzeAudio, analyzeScenes, analyzeVideo, checkHealth } from "./style-client.js";
import type { AudioAnalysisResult, VideoStyleProfile } from "./style-client.js";

export interface AgentContext {
  /** Path to the audio/video file to use for beat detection. */
  audioFilePath?: string;
  /** Path to an example video whose style should be replicated. */
  exampleVideoPath?: string;
  /** Raw footage video path for scene detection. */
  rawFootagePath?: string;
}

export interface AgentRunOptions {
  userInstruction: string;
  context: AgentContext;
  /** Maximum number of LLM turns before giving up. Default: 20 */
  maxTurns?: number;
  onStep?: (message: string) => void;
}

export class Agent {
  private backend: LlmBackend;
  private mcpClient: Client;
  private mcpConnected = false;

  constructor(backend: LlmBackend) {
    this.backend = backend;
    this.mcpClient = new Client({ name: "orchestrator", version: "0.1.0" });
  }

  // ---------------------------------------------------------------------------
  // MCP connection
  // ---------------------------------------------------------------------------

  async connectMcp(serverCommand: string, serverArgs: string[]): Promise<void> {
    const transport = new StdioClientTransport({
      command: serverCommand,
      args: serverArgs,
    });
    await this.mcpClient.connect(transport);
    this.mcpConnected = true;
  }

  async disconnectMcp(): Promise<void> {
    if (this.mcpConnected) {
      await this.mcpClient.close();
      this.mcpConnected = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tool discovery from MCP server
  // ---------------------------------------------------------------------------

  private async getTools(): Promise<LlmTool[]> {
    const result = await this.mcpClient.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  private async executeTool(call: LlmToolCall): Promise<string> {
    const result = await this.mcpClient.callTool({
      name: call.name,
      arguments: call.input,
    });

    // MCP result content is an array of content blocks
    const contentBlocks = result.content as Array<{ type: string; text?: string }>;
    const text = contentBlocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    return text || JSON.stringify(result.content);
  }

  // ---------------------------------------------------------------------------
  // Context assembly
  // ---------------------------------------------------------------------------

  private async assembleContext(
    context: AgentContext,
    onStep?: (msg: string) => void
  ): Promise<{ systemPrompt: string; styleData: object }> {
    const sections: string[] = [];

    // Check Python service health
    const healthy = await checkHealth();
    if (!healthy) {
      onStep?.("Warning: Style Analysis service is not reachable at the configured URL. Audio/scene analysis will be skipped.");
    }

    // Audio beat analysis
    let audioResult: AudioAnalysisResult | null = null;
    if (context.audioFilePath && healthy) {
      onStep?.(`Analyzing audio beats: ${context.audioFilePath}`);
      audioResult = await analyzeAudio(context.audioFilePath);
      sections.push(
        `## Audio Analysis\n` +
        `- BPM: ${audioResult.bpm.toFixed(1)}\n` +
        `- Duration: ${audioResult.duration_seconds.toFixed(2)}s\n` +
        `- Beat count: ${audioResult.beats.length}\n` +
        `- Beat timestamps (seconds): ${audioResult.beats.map((b) => b.time_seconds.toFixed(3)).join(", ")}`
      );
    }

    // Example video style profile
    let styleProfile: VideoStyleProfile | null = null;
    if (context.exampleVideoPath && healthy) {
      onStep?.(`Analyzing example video style: ${context.exampleVideoPath}`);
      styleProfile = await analyzeVideo(context.exampleVideoPath, 8);
      sections.push(
        `## Example Video Style Profile\n` +
        `- Cuts per minute: ${styleProfile.cuts_per_minute}\n` +
        `- Avg shot duration: ${styleProfile.avg_shot_duration_seconds}s\n` +
        `- Min/Max shot: ${styleProfile.min_shot_duration_seconds}s / ${styleProfile.max_shot_duration_seconds}s\n` +
        `- Dominant transition: ${styleProfile.dominant_transition}\n` +
        `- Avg brightness: ${styleProfile.avg_brightness} / 255\n` +
        `- Avg saturation: ${styleProfile.avg_saturation} / 255\n` +
        `- Text on screen: ${styleProfile.text_detected_in_frames}\n` +
        `- Key frames available at: ${styleProfile.key_frame_paths.join(", ")}`
      );
    }

    // Raw footage scene detection
    if (context.rawFootagePath && healthy) {
      onStep?.(`Detecting scenes in raw footage: ${context.rawFootagePath}`);
      const scenes = await analyzeScenes(context.rawFootagePath);
      sections.push(
        `## Raw Footage Scenes\n` +
        `- Total scenes detected: ${scenes.scene_count}\n` +
        `- Duration: ${scenes.total_duration_seconds.toFixed(2)}s at ${scenes.fps}fps\n` +
        scenes.scenes
          .map((s, i) => `  Scene ${i + 1}: ${s.start_time_seconds.toFixed(3)}s – ${s.end_time_seconds.toFixed(3)}s (${s.duration_seconds.toFixed(3)}s)`)
          .join("\n")
      );
    }

    const contextBlock = sections.length > 0 ? sections.join("\n\n") : "(No style analysis context provided.)";

    const systemPrompt = [
      "You are an expert video editor operating inside Adobe Premiere Pro via the MCP protocol.",
      "You have access to tools that directly manipulate the Premiere Pro timeline.",
      "",
      "Rules:",
      "- Before making any cuts or insertions, always call getSequenceInfo and listProjectItems to understand the current state.",
      "- Work sequentially. Complete one operation and verify the result before proceeding.",
      "- Do not fabricate tool results. If a tool returns an error, report it and stop.",
      "- Be explicit about what you are doing and why, in plain language the user can follow.",
      "- Times are always in seconds. The tools handle internal tick conversion.",
      "- When cutting to beats, snap cuts to the nearest beat timestamp from the audio analysis.",
      "- Do not use emojis in any response.",
      "",
      "## Current Analysis Context",
      contextBlock,
    ].join("\n");

    return { systemPrompt, styleData: { audioResult, styleProfile } };
  }

  // ---------------------------------------------------------------------------
  // Agentic loop
  // ---------------------------------------------------------------------------

  async run(options: AgentRunOptions): Promise<string> {
    const { userInstruction, context, maxTurns = 20, onStep } = options;

    if (!this.mcpConnected) {
      throw new Error("MCP client is not connected. Call connectMcp() first.");
    }

    const { systemPrompt } = await this.assembleContext(context, onStep);
    const tools = await this.getTools();

    const messages: LlmMessage[] = [
      { role: "user", content: userInstruction },
    ];

    let turns = 0;
    let finalText = "";

    onStep?.("Starting editing session...");

    while (turns < maxTurns) {
      turns++;
      onStep?.(`Turn ${turns}: calling LLM...`);

      const response = await this.backend.complete(systemPrompt, messages, tools);

      if (response.text) {
        finalText = response.text;
        onStep?.(`LLM: ${response.text}`);
      }

      if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
        break;
      }

      // Add assistant message with tool calls to history
      messages.push({
        role: "assistant",
        content: response.text ?? `Executing ${response.toolCalls.length} tool(s).`,
      });

      // Execute each tool call and collect results
      const toolResultParts: string[] = [];
      for (const call of response.toolCalls) {
        onStep?.(`Calling tool: ${call.name} ${JSON.stringify(call.input)}`);
        let result: string;
        try {
          result = await this.executeTool(call);
          onStep?.(`Tool result (${call.name}): ${result.slice(0, 120)}${result.length > 120 ? "..." : ""}`);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          onStep?.(`Tool error (${call.name}): ${result}`);
        }
        toolResultParts.push(`[${call.name}] ${result}`);
      }

      // Feed tool results back as a user message
      messages.push({
        role: "user",
        content: toolResultParts.join("\n\n"),
      });
    }

    if (turns >= maxTurns) {
      finalText += `\n\n(Reached maximum of ${maxTurns} turns.)`;
    }

    return finalText || "Done.";
  }
}
