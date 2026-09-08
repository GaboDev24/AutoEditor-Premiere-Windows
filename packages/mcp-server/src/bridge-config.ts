/**
 * Bridge version constants for Adobe Premiere Pro.
 *
 * Premiere Pro version history:
 *   v21.x  (2021)  - CEP/ExtendScript only. UXP not available.
 *   v22.x  (2022)  - CEP/ExtendScript only. UXP not available.
 *   v23.x  (2023)  - UXP introduced experimentally. Most operations still require ExtendScript.
 *   v24.x  (2024)  - UXP expanded but incomplete. ExtendScript used for complex timeline ops.
 *   v25.2+ (2025)  - UXP preferred. ExtendScript fallback for unsupported operations.
 *
 * Operations that always require ExtendScript (regardless of version):
 *   - applyLumetriColorPreset (no UXP color grading API as of v25.2)
 *   - exportSequence with custom codec parameters (AME scripting still ExtendScript-only)
 *   - addMotionKeyframe (UXP keyframe API incomplete)
 *   - legacyTitle creation (requires PProTitle module, ExtendScript only)
 */

export type BridgeMode = "uxp" | "extendscript";

export interface PremiereBridgeConfig {
  mode: BridgeMode;
  /** WebSocket URL for the UXP panel endpoint (used in UXP mode). */
  uxpWsUrl: string;
  /** CEP socket/port for ExtendScript evaluation (used in ExtendScript mode). */
  cepPort: number;
}

/**
 * Determines the appropriate bridge mode based on the detected Premiere version
 * or the PREMIERE_BRIDGE_MODE environment variable override.
 *
 * Detection priority:
 *  1. Environment variable PREMIERE_BRIDGE_MODE (uxp | extendscript) — explicit override.
 *  2. PREMIERE_VERSION env var parsed as major.minor float.
 *  3. Defaults to extendscript for maximum compatibility.
 */
export function resolveBridgeMode(): BridgeMode {
  const override = process.env.PREMIERE_BRIDGE_MODE;
  if (override === "uxp" || override === "extendscript") {
    return override;
  }

  const versionStr = process.env.PREMIERE_VERSION;
  if (versionStr) {
    const version = parseFloat(versionStr);
    // UXP is only reliable from v25.2 onward
    if (version >= 25.2) {
      return "uxp";
    }
  }

  // Safe default: ExtendScript works from v21.x onward
  return "extendscript";
}

export function defaultBridgeConfig(): PremiereBridgeConfig {
  return {
    mode: resolveBridgeMode(),
    uxpWsUrl: process.env.UXP_WS_URL ?? "ws://localhost:3200",
    cepPort: parseInt(process.env.CEP_PORT ?? "3201", 10),
  };
}
