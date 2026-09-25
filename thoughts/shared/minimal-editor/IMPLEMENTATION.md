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
