#!/usr/bin/env bash
# Ban gate: fail if any agent-upsell / phone-home / experiment string appears
# in OUR source (node_modules and dist excluded — vendor bundles may contain
# innocuous substrings like navigator.userAgent). This script itself is
# excluded from the scan since it necessarily names the patterns.
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='telemetry|telemetria|Copilot|copilot|experiment[-_ ]?service|agent[-_ ]?panel|ai[-_ ]?assistant|welcome[-_ ]?walkthrough'

if grep -rInE --exclude=ban-gate.sh "$PATTERN" src electron index.html scripts test 2>/dev/null; then
  echo "BAN-GATE FAILED: banned strings found above" >&2
  exit 1
fi

# Renderer must never fetch remote resources: no http(s) URLs in our source.
if grep -rInEo 'https?://[^"'"'"' )]+' src electron index.html 2>/dev/null | grep -v 'w3\.org' ; then
  echo "BAN-GATE FAILED: remote URL in app source (app must be local-only)" >&2
  exit 1
fi

echo "ban-gate ok: no agent/telemetry strings, no remote URLs"
