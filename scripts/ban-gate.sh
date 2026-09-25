#!/usr/bin/env bash
# Ban gate: fail if any agent-upsell / phone-home / experiment string appears
# in OUR source (node_modules, dist and Rust target/ excluded — vendor code
# may contain innocuous substrings like navigator.userAgent). This script
# itself is excluded since it necessarily names the patterns. Also fails on
# remote URLs in app source and on HTTP client crates in Cargo.toml — the app
# must be local-only.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='telemetry|telemetria|Copilot|copilot|experiment[-_ ]?service|agent[-_ ]?panel|ai[-_ ]?assistant|welcome[-_ ]?walkthrough'

if grep -rInE --exclude=ban-gate.sh "$PATTERN" src e2e index.html scripts src-tauri/src 2>/dev/null; then
  echo "BAN-GATE FAILED: banned strings found above" >&2
  exit 1
fi

# Renderer must never fetch remote resources: no http(s) URLs in our source.
if grep -rInEo 'https?://[^"'"'"' )]+' src e2e index.html src-tauri/src 2>/dev/null | grep -v 'w3\.org\|schema\.tauri\.app\|tauri\.localhost\|localhost:1420'; then
  echo "BAN-GATE FAILED: remote URL in app source (app must be local-only)" >&2
  exit 1
fi

# No HTTP client crates: the Rust backend must have no way to phone home.
if grep -inE '^\s*(reqwest|hyper|ureq|curl| surf |isahc|attohttpc)\b' src-tauri/Cargo.toml src-tauri/Cargo.lock 2>/dev/null; then
  echo "BAN-GATE FAILED: HTTP client crate in Rust dependencies" >&2
  exit 1
fi

echo "ban-gate ok: no agent strings, no remote URLs, no HTTP crates"
