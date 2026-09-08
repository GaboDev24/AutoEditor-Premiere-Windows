# UXP API Compatibility Reference

This document tracks which Premiere Pro operations are available via UXP
and which must fall back to ExtendScript (CEP), per Premiere Pro version.

## Version Matrix

| Operation | v21 (2021) | v22 (2022) | v23 (2023) | v24 (2024) | v25.2+ |
|---|---|---|---|---|---|
| importFiles | ExtendScript | ExtendScript | ExtendScript | ExtendScript | UXP |
| insertClip (video track) | ExtendScript | ExtendScript | ExtendScript | UXP (partial) | UXP |
| razor / cutClipAtTime | ExtendScript | ExtendScript | ExtendScript | UXP (partial) | UXP |
| removeClip (ripple delete) | ExtendScript | ExtendScript | ExtendScript | UXP (partial) | UXP |
| addTransition | ExtendScript | ExtendScript | ExtendScript | ExtendScript | UXP (experimental) |
| getSequenceInfo | ExtendScript | ExtendScript | UXP (partial) | UXP | UXP |
| listProjectItems | ExtendScript | ExtendScript | UXP (partial) | UXP | UXP |
| exportSequence (AME) | ExtendScript | ExtendScript | ExtendScript | ExtendScript | ExtendScript (*) |
| applyLumetriColorPreset | ExtendScript | ExtendScript | ExtendScript | ExtendScript | ExtendScript (*) |
| addKeyframe (motion) | ExtendScript | ExtendScript | ExtendScript | ExtendScript | ExtendScript (*) |
| createLegacyTitle | ExtendScript | ExtendScript | ExtendScript | ExtendScript | ExtendScript (*) |

(*) No UXP API available as of Premiere Pro v25.2. These operations always
    use the ExtendScript path regardless of the configured bridge mode.

## Bridge Mode Selection

The bridge auto-detects the version from the PREMIERE_VERSION environment variable:
- PREMIERE_VERSION >= 25.2 → UXP mode preferred
- PREMIERE_VERSION < 25.2 → ExtendScript mode

Override with: PREMIERE_BRIDGE_MODE=extendscript (or uxp)

## ExtendScript Constraints

ExtendScript in Premiere runs in an ES3 environment. Avoid:
- Arrow functions
- const / let (use var)
- Template literals
- Classes / class syntax
- Destructuring
- Spread operators
- Promises / async/await (use callbacks)

All ExtendScript templates in extendscript-templates.ts comply with these constraints.

## CEP Version Requirements

| Premiere Version | CEP Version |
|---|---|
| 2021 (v21.x) | CEP 10 |
| 2022 (v22.x) | CEP 11 |
| 2023 (v23.x) | CEP 11 |
| 2024 (v24.x) | CEP 12 |
| 2025+ (v25.x) | CEP 12 / UXP |

The manifest.xml requires CSXS 10.0 as minimum, which covers all versions from 2021.

## Registry Key for Developer Mode (CEP)

To load unsigned CEP extensions in development:

```
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.10]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12]
"PlayerDebugMode"="1"
```

Save as a .reg file and double-click to apply. Restart Premiere after applying.
