# minimal-editor

A minimal, fast, VS Code–familiar editor for quickly looking at code changes.
No extensions. No telemetry. No agent upsell popups. Ever.

Built on the same editing engine as VS Code ([Monaco](https://github.com/microsoft/monaco-editor))
inside a bare [Electron](https://github.com/electron/electron) shell — with only four features:

- **Files** — folder tree, tabs, syntax highlighting, save (Ctrl+S)
- **Changes** — git status list, side-by-side diffs, `[` / `]` to step through changes
- **Search** — filename + content search across the project (Enter)
- **Nothing else** — no accounts, no marketplace, no update prompts, no network calls

The renderer is blocked from all `http(s)`/`ws(s)` traffic at the Chromium
network layer (see `electron/main.cjs`), and CI runs a **ban gate**
(`scripts/ban-gate.sh`) that fails the build if any telemetry/agent string
appears in app source.

## Quick start

Requirements: Node.js 20+, git, and Electron's Linux runtime libs
(`libgtk-3-0`, `libnss3`, `libasound2` — present on most desktops).

```bash
git clone https://github.com/nitishagar/minimal-editor.git
cd minimal-editor
npm install
npm run build
npm start [path/to/repo]   # opens the app; optional start folder
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Rebuild renderer + launch (with `--dev` DevTools when passed to electron) |
| `npm test` | Ban gate + unit tests (`node --test`) |
| `npm run smoke` | Boot the built app headlessly and verify the renderer loads |
| `npm run ban-gate` | Fail on telemetry/agent strings or remote URLs in app source |

Keyboard: `Ctrl+O` open folder · `Ctrl+S` save · `Ctrl+W` close tab ·
`[` / `]` previous/next change (in a diff).

## Why not a full VS Code fork?

A full `microsoft/vscode` (Code-OSS) build carries the entire workbench:
extension host, marketplace, settings sync, experiments service, and the
agent/Copilot surfaces. Stripping that down by subtraction fights the codebase
and still ships its weight. VSCodium proves the point from the other side: it
is explicitly *not* a fork, just build scripts over Microsoft's repo — same
full-weight VS Code.

So minimal-editor starts from zero and adds up instead: Monaco for the editor
(VS Code's own engine, MIT), Electron for the shell (what VS Code itself
uses), and ~2k lines of our own code for tree/tabs/diff/search. See
[`thoughts/shared/minimal-editor/`](thoughts/shared/minimal-editor/) for the
research → plan → implement trail.

Possible future: a Tauri port for even smaller binaries (blocked today only by
missing `webkit2gtk-4.1` dev headers on the build machine; the code is
structured for it — all desktop I/O lives behind `window.api`).

## Project layout

```
electron/      main.cjs (window + net-block), preload.cjs (window.api bridge),
               git.cjs + files.cjs (local-only helpers, unit-tested)
src/           renderer.ts (tree/tabs/editor/diff/search UI), styles.css
test/          node:test suites for git.cjs + files.cjs
scripts/       ban-gate.sh, smoke.mjs
thoughts/      research → plan → implement loop artifacts
```

## License

MIT — see [LICENSE](LICENSE).
