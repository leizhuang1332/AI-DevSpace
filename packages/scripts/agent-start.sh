#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_DIR="$REPO_ROOT/apps/agent"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
LOG_FILE="${AGENT_LOG_FILE:-$WORKSPACE_ROOT/logs/agent.log}"
PID_FILE="$WORKSPACE_ROOT/.agent.pid"
PORT="${PORT:-7777}"
# ANALYZING turn-bounded snapshot 根(ADR-0020 D10 · audit-2026-07-26 #4)。
# agent 内部同样有 `<workspaceRoot>/snapshots/analysis` 默认值,这里显式导出
# 只是为了让 `ps` / 日志里能一眼看到实际路径,并允许外部覆盖。
export AIDEVSPACE_SNAPSHOT_DIR="${AIDEVSPACE_SNAPSHOT_DIR:-$WORKSPACE_ROOT/snapshots/analysis}"

mkdir -p "$(dirname "$LOG_FILE")" "$WORKSPACE_ROOT" "$AIDEVSPACE_SNAPSHOT_DIR"

# If something is already alive on this PID file, skip relaunch.
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "agent-start: pid $OLD_PID already running; skipping relaunch"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Pick prod build if compiled, else dev (tsx via pnpm exec).
if [[ -f "$AGENT_DIR/dist/server.js" ]]; then
  CMD=(node "$AGENT_DIR/dist/server.js")
else
  # `pnpm exec tsx` resolves tsx from apps/agent/node_modules/.bin/
  # (set in apps/agent/package.json devDependencies). More reliable than
  # `npx --prefix` which loses PATH context after nohup fork.
  CMD=(pnpm --filter @ai-devspace/agent exec tsx "$AGENT_DIR/src/server.ts")
fi

echo "agent-start: launching on port $PORT"
echo "agent-start: snapshots -> $AIDEVSPACE_SNAPSHOT_DIR"
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
