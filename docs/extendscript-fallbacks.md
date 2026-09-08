# ExtendScript Fallback Operations

This document lists every MCP tool operation that ALWAYS routes through
ExtendScript/CEP, regardless of the configured bridge mode or Premiere version.

These are operations where no equivalent UXP API exists as of Premiere Pro v25.2.

---

## Always-ExtendScript Operations

### exportSequence

**Reason:** Adobe Media Encoder scripting is exposed exclusively via the
`app.encoder` object in ExtendScript. There is no UXP equivalent API.

**MCP Tool:** `exportSequence`
**Script generator:** `exportSequenceScript()` in extendscript-templates.ts

**Requirements:**
- Adobe Media Encoder must be installed
- AME must be open before calling this tool (the `app.encoder` object is only
  available when AME is running)
- The `.epr` preset file must exist at the specified path

**Alternative for simple exports:** Use Premiere's built-in export shortcut
(Cmd/Ctrl+M) for manual exports, or queue via AME scripting.

---

### applyLumetriColorPreset

**Reason:** The Lumetri Color panel API is not exposed in UXP as of v25.2.
LUT and color grade application requires ExtendScript via `QEProject` or
direct effect parameter manipulation.

**Status:** NOT YET IMPLEMENTED in the current MCP server.
Planned for a future milestone after the beat-cut MVP is complete.

**Workaround:** Export the sequence, apply a LUT in DaVinci Resolve, and
re-import the graded footage.

---

### addMotionKeyframe

**Reason:** The UXP keyframe API (`VideoEffect.addKeyframe()`) is present
in v25.2 but marked as experimental and not reliable for production use.
Position/scale/rotation keyframe automation uses ExtendScript via
`clipVideoEffect.getProperties()` and `addKeyframe()`.

**Status:** NOT YET IMPLEMENTED. Planned for style replication phase 2.

---

### createLegacyTitle

**Reason:** The `PProTitle` module (legacy title creator) is ExtendScript-only.
For newer Essential Graphics titles, there is also no UXP API.

**Status:** NOT YET IMPLEMENTED. Text overlay support is a post-MVP feature.

---

## Partially-ExtendScript Operations

These operations use UXP on Premiere v25.2+ but fall back to ExtendScript
on older versions:

| Operation | UXP Available Since | Fallback |
|---|---|---|
| insertClip | v24.x (partial) | ExtendScript v21-v23 |
| razor (cut) | v24.x (partial) | ExtendScript v21-v23 |
| removeClip | v24.x (partial) | ExtendScript v21-v23 |
| addTransition | v25.2 (experimental) | ExtendScript all versions |
| getSequenceInfo | v23.x | ExtendScript v21-v22 |
| listProjectItems | v23.x | ExtendScript v21-v22 |

The bridge-config.ts module handles this routing automatically based on
the PREMIERE_VERSION environment variable.
