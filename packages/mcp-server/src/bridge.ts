import { WebSocket } from "ws";
import net from "net";
import { defaultBridgeConfig, type BridgeMode, type PremiereBridgeConfig } from "./bridge-config.js";

export interface BridgeResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Communication bridge between the MCP server and Premiere Pro.
 *
 * Mode selection:
 *   - "uxp": Sends commands to the UXP panel running inside Premiere via WebSocket.
 *            The UXP panel listens on ws://localhost:3200 and executes commands via
 *            the Premiere Pro UXP DOM API (available from Premiere v25.2+).
 *
 *   - "extendscript": Sends ExtendScript code to a CEP extension running inside
 *                     Premiere. The CEP extension exposes a TCP socket on port 3201
 *                     and evaluates scripts via `csInterface.evalScript()`.
 *                     Compatible with Premiere Pro 2021 (v21.0) and later.
 *
 * The bridge automatically selects the mode based on bridge-config.ts logic.
 * You can force a mode with the PREMIERE_BRIDGE_MODE environment variable.
 */
export class PremiereBridge {
  private readonly config: PremiereBridgeConfig;

  constructor(config?: PremiereBridgeConfig) {
    this.config = config ?? defaultBridgeConfig();
  }

  get mode(): BridgeMode {
    return this.config.mode;
  }

  /**
   * Executes an ExtendScript string in Premiere Pro via CEP/TCP.
   * Use this for any operation that is not supported by UXP or when running
   * on Premiere versions before v25.2.
   */
  async evalExtendScript(script: string): Promise<BridgeResult> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let data = "";

      client.connect(this.config.cepPort, "127.0.0.1", () => {
        // Protocol: length-prefixed JSON { type: "evalScript", script: "..." }
        const message = JSON.stringify({ type: "evalScript", script });
        const lengthBuf = Buffer.alloc(4);
        lengthBuf.writeUInt32BE(Buffer.byteLength(message, "utf8"), 0);
        client.write(lengthBuf);
        client.write(message, "utf8");
      });

      client.on("data", (chunk) => {
        data += chunk.toString("utf8");
      });

      client.on("end", () => {
        try {
          resolve(JSON.parse(data) as BridgeResult);
        } catch {
          resolve({ rawResponse: data });
        }
      });

      client.on("error", (err) => {
        reject(new Error(`CEP bridge error on port ${this.config.cepPort}: ${err.message}`));
      });

      // 10-second timeout to avoid hanging if Premiere is unresponsive
      client.setTimeout(10_000, () => {
        client.destroy();
        reject(new Error("CEP bridge timeout after 10s"));
      });
    });
  }

  /**
   * Sends a structured command to the UXP panel via WebSocket.
   * Only available on Premiere Pro v25.2+. For older versions, use evalExtendScript.
   *
   * @param command  Command name matching a handler registered in the UXP panel.
   * @param params   Parameters to pass to the UXP command handler.
   */
  async sendUxpCommand(command: string, params: Record<string, unknown>): Promise<BridgeResult> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.uxpWsUrl);
      let settled = false;

      const settle = (result: BridgeResult) => {
        if (!settled) {
          settled = true;
          ws.close();
          resolve(result);
        }
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({ command, params }));
      });

      ws.on("message", (raw) => {
        try {
          settle(JSON.parse(raw.toString()) as BridgeResult);
        } catch {
          settle({ rawResponse: raw.toString() });
        }
      });

      ws.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`UXP WebSocket error: ${err.message}`));
        }
      });

      ws.on("close", (code, reason) => {
        if (!settled) {
          settled = true;
          reject(new Error(`UXP WebSocket closed unexpectedly: ${code} ${reason}`));
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.terminate();
          reject(new Error("UXP WebSocket timeout after 10s"));
        }
      }, 10_000);
    });
  }

  /**
   * Unified executor. Routes to UXP or ExtendScript based on config.
   * For operations that always require ExtendScript (e.g., export, color presets),
   * callers should use evalExtendScript directly and pass a note in the tool description.
   *
   * @param uxpCommand    Command name for the UXP path.
   * @param uxpParams     Params for the UXP command.
   * @param extendScript  ExtendScript string for the CEP path.
   */
  async execute(
    uxpCommand: string,
    uxpParams: Record<string, unknown>,
    extendScript: string
  ): Promise<BridgeResult> {
    if (this.config.mode === "uxp") {
      return this.sendUxpCommand(uxpCommand, uxpParams);
    }
    return this.evalExtendScript(extendScript);
  }
}
