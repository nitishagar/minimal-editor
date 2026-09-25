# Research — minimal editor (2026-09-25)

Goal: a minimal VS Code–like editor, lightweight and fast, for quickly
reviewing code changes — with no agent upsell spam.

## Evidence (inspected this run)

- `microsoft/vscode` README (raw): Code-OSS is MIT; full product is a
  distribution with Microsoft customizations. Build/run documented in the
  How-to-Contribute wiki (heavy: Node + native deps + long builds).
- `VSCodium/vscodium` README (raw): "This is not a fork. This is a repository
  of scripts to automatically build Microsoft's vscode repository into
  freely-licensed binaries." Same full weight as VS Code.
- `microsoft/monaco-editor` README (raw): "The Monaco Editor is the fully
  featured code editor from VS Code", shipped as `npm i monaco-editor` with an
  ESM build. Versioned API is `monaco.d.ts`.
- `tauri-apps/tauri` README (raw): "tiny, blazingly fast binaries", system
  webview; Linux needs webkit2gtk 4.1 (e.g. Ubuntu 22.04).
- `electron/electron` README (raw): Node.js + Chromium shell; "used by Visual
  Studio Code". Prebuilt x64/arm64 binaries for macOS/Windows/Linux.
- Local `nitishagar/claude-files` (inspected README, attach.sh, smoke test):
  phased `research → create_plan → implement_plan → validate_plan` loop
  (recommended `*_v2_7` track) with specialist subagents; this repo's
  `thoughts/` trail follows that shape.

## Decision

Full vscode-source fork rejected (build weight, subtraction-vs-addition).
VSCodium-style rebuild rejected (still full VS Code). Tauri preferred but
blocked: no webkit2gtk-4.1/gtk dev headers on this machine and no
non-interactive install path. **Chosen: Electron + Monaco + vanilla TS** —
same stack VS Code itself uses, minimal by construction.
