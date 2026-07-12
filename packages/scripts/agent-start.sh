#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_DIR="$REPO_ROOT/apps/agent"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
LOG_FILE="${AGENT_LOG_FILE:-$WORKSPACE_ROOT/logs/agent.log}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"
PORT="${PORT:-7777}"

mkdir -p "$(dirname "$LOG_FILE")" "$WORKSPACE_ROOT"

# If something is already alive on this PID file, skip relaunch.
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "agent-start: pid $OLD_PID already running; skipping relaunch"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Pick prod build if compiled, else dev (tsx).
if [[ -f "$AGENT_DIR/dist/server.js" ]]; then
  CMD=(node "$AGENT_DIR/dist/server.js")
else
  CMD=(npx --prefix "$REPO_ROOT" tsx "$AGENT_DIR/src/server.ts")
fi

echo "agent-start: launching on port $PORT"
nohup "${CMD[@]}" >/dev/null 2>>"$LOG_FILE" &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"
echo "agent-start: pid=$APP_PID log=$LOG_FILE"

# Wait briefly for port to come up
for i in {1..20}; do
  if (echo > /dev/tcp/127.0.0.1/"$PORT") 2>/dev/null; then
    echo "agent-start: ready on :$PORT"
    exit 0
  fi
  sleep 0.5
done
echo "agent-start: WARNING port $PORT not ready within 10s; check $LOG_FILE"
exit 0
