#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

echo "agent-watch: watching pid file $PID_FILE every 5s"
while true; do
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -z "${PID:-}" ]] || ! kill -0 "$PID" 2>/dev/null; then
      echo "agent-watch: pid missing or dead; relaunching via start.sh"
      bash "$SCRIPT_DIR/agent-start.sh" || true
    fi
  else
    echo "agent-watch: no pid file; launching"
    bash "$SCRIPT_DIR/agent-start.sh" || true
  fi
  sleep 5
done
