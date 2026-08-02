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

# Wait for the agent to actually serve /api/health on $PORT.
# 历史上只用 /dev/tcp 探端口,会在端口被旧/占用进程抢走时误报 ready,
# 实际 Agent 因 EADDRINUSE 立即崩溃,Web → Agent 全断。本次改用 HTTP 健康探针
# + 进程存活双校验,失败时非零退出,留 30s 缓冲以兼容冷启动 SDK / cc-switch 初始化。
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
READY=0
# 最多 30s 探测(60 * 0.5s)。测试时可经 AGENT_START_PROBE_TIMEOUT 缩短。
PROBE_ITERS="${AGENT_START_PROBE_TIMEOUT:-60}"
for ((i=0; i<PROBE_ITERS; i++)); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "agent-start: ERROR pid $APP_PID exited before becoming ready; see $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
  fi
  CODE="$(curl --max-time 1 -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
  if [[ "$CODE" == "200" ]]; then
    READY=1
    break
  fi
  sleep 0.5
done

if [[ "$READY" -ne 1 ]]; then
  echo "agent-start: ERROR $HEALTH_URL did not return 200 within 30s; see $LOG_FILE"
  # 清理 PID 文件 + 杀掉仍在跑但无 HTTP 的子进程,避免下一轮启动撞 EADDRINUSE
  if kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    sleep 0.5
    kill -KILL "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  exit 1
fi

echo "agent-start: ready on :$PORT (http /api/health)"
exit 0
