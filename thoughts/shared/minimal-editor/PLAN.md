# Plan — minimal editor (2026-09-25)

## Scope (in)

Files tree + tabs + Monaco editing, git Changes list + side-by-side diffs
with `[`/`]` stepping, project filename/content search, save, folder CLI arg.

## Scope (out)

Extensions/marketplace, terminal, debugging, accounts/sync, telemetry,
auto-update, any agent/Copilot surface, Windows/macOS packaging (Linux first).

## Architecture

- `electron/main.cjs`: single window, `sandbox:true`, `contextIsolation`,
  renderer network blocked at `webRequest.onBeforeRequest`.
- `electron/preload.cjs`: `window.api` bridge — local fs/git only.
- `electron/git.cjs`, `electron/files.cjs`: plain-Node helpers (no Electron
  imports) so `node --test` covers them without a display.
- `src/renderer.ts`: vanilla TS, one Monaco editor + one diff editor toggled;
  per-file models; tree/diff/search/tabs/statusbar. No framework.
- `scripts/ban-gate.sh`: CI gate — banned strings + remote URLs fail build.
- `scripts/smoke.mjs` + `--smoke` main-process mode: headless boot check.

## Validation

`npm test` (ban gate + unit tests) → `npm run build` → `npm run smoke`
(xvfb on CI) → manual open/screenshot of a real repo. Publish: `gh repo
create --public` + push + tag `v0.1.0`.
