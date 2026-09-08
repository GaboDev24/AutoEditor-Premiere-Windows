/**
 * LLM backend abstraction.
 *
 * Supports three interchangeable backends:
 *   - claude   — Anthropic Claude API
 *   - gemini   — Google Gemini API
 *   - ollama   — Local model via Ollama (OpenAI-compatible HTTP API)
 *
 * Backend is selected via the LLM_BACKEND environment variable.
 * No code changes required to switch backends.
 *
 * All backends expose the same interface: LlmBackend.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";
import fetch from "node-fetch";

export type BackendType = "claude" | "gemini" | "ollama";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  text: string | null;
  toolCalls: LlmToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop";
}

export interface LlmBackend {
  complete(
    systemPrompt: string,
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Claude backend
// ---------------------------------------------------------------------------

export class ClaudeBackend implements LlmBackend {
  private client: Anthropic;
  private model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is required for Claude backend.");
    this.client = new Anthropic({ apiKey });
    this.model = process.env.CLAUDE_MODEL ?? "claude-opus-4-5";
  }

  async complete(
    systemPrompt: string,
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        properties: (t.inputSchema["properties"] as Record<string, unknown>) ?? {},
        required: (t.inputSchema["required"] as string[]) ?? [],
      },
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    const toolCalls: LlmToolCall[] = [];
    let text: string | null = null;

    for (const block of response.content) {
      if (block.type === "text") text = block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    const stopReason =
      response.stop_reason === "tool_use" ? "tool_use" :
      response.stop_reason === "max_tokens" ? "max_tokens" :
      "end_turn";

    return { text, toolCalls, stopReason };
  }
}

// ---------------------------------------------------------------------------
// Gemini backend
// ---------------------------------------------------------------------------

export class GeminiBackend implements LlmBackend {
  private client: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required for Gemini backend.");
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    const genAI = new GoogleGenerativeAI(apiKey);
    this.client = genAI.getGenerativeModel({ model });
  }

  async complete(
    systemPrompt: string,
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse> {
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geminiTools: any =
      tools.length > 0
        ? [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: {
                  type: FunctionDeclarationSchemaType.OBJECT,
                  properties: t.inputSchema["properties"] ?? {},
                  required: (t.inputSchema["required"] as string[] | undefined) ?? [],
                },
              })),
            },
          ]
        : undefined;

    const chat = this.client.startChat({
      history,
      systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
      tools: geminiTools,
    });

    const result = await chat.sendMessage(lastMessage?.content ?? "");
    const response = result.response;

    const toolCalls: LlmToolCall[] = [];
    let text: string | null = null;

    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) text = part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: part.functionCall.name,
            name: part.functionCall.name,
            input: (part.functionCall.args as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    const stopReason =
      finishReason === "STOP" ? "end_turn" :
      toolCalls.length > 0 ? "tool_use" :
      "end_turn";

    return { text, toolCalls, stopReason };
  }
}

// ---------------------------------------------------------------------------
// Ollama backend (OpenAI-compatible)
// ---------------------------------------------------------------------------

interface OllamaChatMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

interface OllamaResponse {
  message: OllamaChatMessage;
  done_reason: string;
}

export class OllamaBackend implements LlmBackend {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.model = process.env.OLLAMA_MODEL ?? "llama3";
  }

  async complete(
    systemPrompt: string,
    messages: LlmMessage[],
    tools: LlmTool[]
  ): Promise<LlmResponse> {
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      tools:
        tools.length > 0
          ? tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            }))
          : undefined,
      stream: false,
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as OllamaResponse;
    const msg = data.message;

    const toolCalls: LlmToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const stopReason =
      data.done_reason === "tool_calls" ? "tool_use" :
      data.done_reason === "length" ? "max_tokens" :
      "end_turn";

    return { text: msg.content || null, toolCalls, stopReason };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBackend(): LlmBackend {
  const backend = (process.env.LLM_BACKEND ?? "claude") as BackendType;
  switch (backend) {
    case "claude":  return new ClaudeBackend();
    case "gemini":  return new GeminiBackend();
    case "ollama":  return new OllamaBackend();
    default:
      throw new Error(`Unknown LLM_BACKEND: "${backend}". Valid values: claude, gemini, ollama`);
  }
}
