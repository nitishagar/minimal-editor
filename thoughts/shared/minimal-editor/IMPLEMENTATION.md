# Implementation log — minimal editor

## 2026-09-25 — v0.1.0 scaffold (implement_plan, single pass)

- Scaffolded Electron 40 + Vite 6 + Monaco 0.52 + vanilla-TS repo per PLAN.md.
- Main process converted ESM → `.cjs` for guaranteed preload/sandbox compat.
- Implemented: tree, tabs w/ dirty dots, save, Changes list w/ status badges,
  Monaco diff vs `git show HEAD:path`, `[`/`]` change stepping, project
  search, branch/changed-count/cursor statusbar, `?root=` CLI-arg boot.
- Guards: 1 MiB file cap, binary detection, 8000-entry tree cap, 200-hit
  search cap, skipped dirs (node_modules/.git/dist/...).
- Verification: `npm test`, `npm run build`, `xvfb/npm run smoke` (see CI).
- Deviations: Electron instead of Tauri (webkit2gtk dev headers unavailable;
  recorded in RESEARCH.md). No other plan changes.

## 2026-09-25 — verification-swarm fixes (validate_plan)

- Fixed IPC path traversal (FAIL → PASS): `resolveInRoot` containment in
  `files.cjs` read/write; `assertRepoPath` guard in `git.cjs` diff/showHead;
  regression tests in `test/files.test.mjs` + `test/git.test.mjs`.
- Fixed Monaco diff-model leak: dispose previous diff pair on each `openDiff`
  and on `openRoot`; `setModel(null)` when the last tab closes.
- Removed dead IPC surface (`git-diff`, `git-log` handlers + preload entries).
- Hardened main: net-block registered before `loadFile`, `setWindowOpenHandler`
  deny, `will-navigate` pinned to `file://`; CSP tightened (`connect-src
  'none'`, `object-src 'none'`, `base-uri 'self'`).

## 2026-09-25 — Tauri port + e2e (blazing-fast follow-up)

- Measured Electron baseline: ~1.4 s spawn-to-quit, ~200 MB installed.
- Unblocked local Tauri builds without root: user-space extraction of
  webkit2gtk-4.1 + gtk + closure `-dev` debs into `~/.webkit`
  (`scripts/env.sh` sets PKG_CONFIG_PATH/SYSROOT; CI uses apt).
- Ported shell Electron → Tauri 2: `src/api.ts` adapter (renderer otherwise
  untouched), `electron/*.cjs` → `src-tauri/src/core/{fs,git}.rs` with the
  same 12 unit tests in Rust (plus symlink-escape rejection).
- Built `--e2e` harness (Rust fixture + injected `e2e/driver.js`): 14 cases
  covering every feature + Monaco model/edit/undo/diff behaviors; 14/14 green
  locally and in CI (xvfb).
- Perf: lazy diff-editor creation (boot 1.17 s → 1.08 s); cherry-picked
  Monaco `editor.api` import tried and reverted (0.52 internal paths too
  fragile for ~100 ms); release LTO+strip. Final: ~1.1 s boot, 7 MB binary,
  4 MB .deb. v0.1.0 tag preserves the Electron generation.
- CI matrix builds Linux/macOS/Windows installers as artifacts per push.
