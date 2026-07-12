#!/usr/bin/env bash
set -euo pipefail
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "agent-status: no pid file at $PID_FILE"
  exit 1
fi
PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "agent-status: alive pid=$PID"
  exit 0
else
  echo "agent-status: dead pid=$PID (stale pid file)"
  exit 1
fi
