#!/usr/bin/env bash
set -euo pipefail
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "agent-stop: no pid file at $PID_FILE; nothing to stop"
  exit 0
fi
PID="$(cat "$PID_FILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  echo "agent-stop: pid $PID not alive; removing stale pid file"
  rm -f "$PID_FILE"
  exit 0
fi

echo "agent-stop: TERM $PID"
kill -TERM "$PID" 2>/dev/null || true
for i in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "agent-stop: stopped"
    exit 0
  fi
  sleep 0.5
done
echo "agent-stop: forcing KILL $PID"
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
exit 0
