#!/usr/bin/env node
/**
 * AutoEditor Premiere — CLI entrypoint.
 *
 * Interactive REPL for the orchestrator. Connects to the MCP server,
 * takes user instructions via stdin, runs the agent loop, and prints results.
 *
 * Usage:
 *   pnpm --filter orchestrator dev
 *
 * Environment variables (all optional except LLM_BACKEND credentials):
 *   LLM_BACKEND          claude | gemini | ollama  (default: claude)
 *   ANTHROPIC_API_KEY    required if LLM_BACKEND=claude
 *   GEMINI_API_KEY       required if LLM_BACKEND=gemini
 *   OLLAMA_MODEL         required if LLM_BACKEND=ollama
 *   STYLE_ANALYSIS_URL   default: http://localhost:8001
 *   MCP_SERVER_CMD       command to launch MCP server (default: node)
 *   MCP_SERVER_ARGS      space-separated args (default: path to mcp-server dist/index.js)
 */

import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { createBackend } from "./llm.js";
import { Agent } from "./agent.js";

// Default MCP server path — resolves to the sibling mcp-server package
const DEFAULT_MCP_PATH = path.resolve(
  __dirname,
  "../../mcp-server/dist/index.js"
);

function printBanner(): void {
  console.log("=".repeat(60));
  console.log("  AutoEditor Premiere — AI Video Editing Orchestrator");
  console.log("=".repeat(60));
  console.log(`  LLM backend : ${process.env.LLM_BACKEND ?? "claude"}`);
  console.log(`  Style API   : ${process.env.STYLE_ANALYSIS_URL ?? "http://localhost:8001"}`);
  console.log(`  MCP server  : ${process.env.MCP_SERVER_CMD ?? "node"} ${process.env.MCP_SERVER_ARGS ?? DEFAULT_MCP_PATH}`);
  console.log("=".repeat(60));
  console.log();
  console.log('Type your editing instruction and press Enter.');
  console.log('Optional context flags you can include in your message:');
  console.log('  --audio <path>    path to audio/video for beat analysis');
  console.log('  --example <path>  path to example video for style analysis');
  console.log('  --raw <path>      path to raw footage for scene detection');
  console.log();
  console.log('Example:');
  console.log('  Cut the clips to the rhythm of the music --audio C:/videos/song.mp3');
  console.log();
  console.log('Type "exit" to quit.');
  console.log();
}

function parseFlags(input: string): {
  instruction: string;
  audioFilePath?: string;
  exampleVideoPath?: string;
  rawFootagePath?: string;
} {
  const audioMatch = input.match(/--audio\s+(\S+)/);
  const exampleMatch = input.match(/--example\s+(\S+)/);
  const rawMatch = input.match(/--raw\s+(\S+)/);

  const instruction = input
    .replace(/--audio\s+\S+/g, "")
    .replace(/--example\s+\S+/g, "")
    .replace(/--raw\s+\S+/g, "")
    .trim();

  return {
    instruction,
    audioFilePath: audioMatch?.[1],
    exampleVideoPath: exampleMatch?.[1],
    rawFootagePath: rawMatch?.[1],
  };
}

async function main(): Promise<void> {
  printBanner();

  let backend;
  try {
    backend = createBackend();
  } catch (err) {
    console.error(`Failed to create LLM backend: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const agent = new Agent(backend);

  const mcpCmd = process.env.MCP_SERVER_CMD ?? "node";
  const mcpArgs = process.env.MCP_SERVER_ARGS
    ? process.env.MCP_SERVER_ARGS.split(" ")
    : [DEFAULT_MCP_PATH];

  try {
    process.stdout.write("Connecting to MCP server... ");
    await agent.connectMcp(mcpCmd, mcpArgs);
    console.log("connected.\n");
  } catch (err) {
    console.error(`\nFailed to connect to MCP server: ${err instanceof Error ? err.message : err}`);
    console.error("Make sure the MCP server is built: pnpm --filter mcp-server build");
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed.toLowerCase() === "exit") {
      await agent.disconnectMcp();
      console.log("Goodbye.");
      process.exit(0);
    }

    const { instruction, audioFilePath, exampleVideoPath, rawFootagePath } = parseFlags(trimmed);

    if (!instruction) {
      console.log("Please provide an instruction.");
      rl.prompt();
      return;
    }

    try {
      const result = await agent.run({
        userInstruction: instruction,
        context: { audioFilePath, exampleVideoPath, rawFootagePath },
        onStep: (msg) => console.log(`  [agent] ${msg}`),
      });
      console.log("\n-- Result --");
      console.log(result);
      console.log();
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : err}\n`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    await agent.disconnectMcp();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
