#!/usr/bin/env bash
#
# scripts/verify-analyzing-real-run.sh
#
# Reviewer 手工验收脚本(ADR-0020 D11 · ticket 07)
#
# 用法:
#   pnpm verify:analyzing-real-run
#   或
#   ANTHROPIC_API_KEY=sk-ant-... bash scripts/verify-analyzing-real-run.sh
#
# 流程:
#   1. 校验 ANTHROPIC_API_KEY 已设置(否则 print SKIPPED reason 并退出 1)
#   2. 启动 web + agent(走既有 `pnpm dev:web` + `pnpm agent:start` 守护脚本)
#   3. 等 agent `/api/health` 返 200(SDK idle 健康)
#   4. bootstrap token → POST /api/requirements 创建 fixture 需求
#   5. POST /api/requirements/<id>/analysis/start(angle=architecture)
#   6. 等 chunks.jsonl 出现(最长 180s)
#   7. 把 SSE / chunks.jsonl 头几行归档到
#      ~/.aidevspace/verification/<timestamp>/
#   8. (可选)调浏览器 Playwright 跑 e2e 套件,把 trace 归档到同目录
#   9. 关 agent(交给 agent-stop.sh)
#  10. 输出物:verification 目录路径 + 头 5 行 chunks.jsonl 内容
#
# 设计要点:
#   - 真 SDK 跑(无 mock);若 key 缺 → 立刻退出,避免 reviewer 误以为脚本跑通
#   - 不写新 Skill / 不改 start handler / 不动 AdmissionDashboard(纯跑通性)
#   - 归档内容作为 PR 上线门槛的物证(贴到 PR 评论)
#   - 出错时 trap EXIT 清理 agent 守护进程,避免 reviewer 下次启动撞端口
#
# 不做的事(non-goals):
#   - 不调 `interject` / `generate-brief`(见 ADR-0020 D13 / D14 后续 PR)
#   - 不动 SkillsPage(见 ADR-0020 D12 后续 PR)
#   - 不替换 MockClaudeProvider(明确不引入,参 ADR-0020 D11)

set -euo pipefail

# ============================================================================
# 路径与常量
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_DIR="$REPO_ROOT/apps/agent"
WEB_DIR="$REPO_ROOT/apps/web"

WEB_URL="${WEB_URL:-http://localhost:3333}"
AGENT_URL="${AGENT_URL:-http://localhost:7777}"
WORKSPACE_ROOT="${AIDEVSPACE_HOME:-$HOME/.aidevspace}"
VERIFICATION_ROOT="$WORKSPACE_ROOT/verification"
STAMP="$(date +%Y%m%dT%H%M%S)"
RUN_DIR="$VERIFICATION_ROOT/$STAMP"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$RUN_DIR" "$LOG_DIR"

# ============================================================================
# 颜色输出
# ============================================================================
if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_BOLD="" C_GREEN="" C_YELLOW="" C_RED="" C_DIM="" C_RESET=""
fi
log()    { printf "%s[verify]%s %s\n" "$C_BOLD" "$C_RESET" "$*"; }
ok()     { printf "%s[verify]%s %s%s%s\n" "$C_BOLD" "$C_RESET" "$C_GREEN" "$*" "$C_RESET"; }
warn()   { printf "%s[verify]%s %s%s%s\n" "$C_BOLD" "$C_RESET" "$C_YELLOW" "$*" "$C_RESET"; }
fail()   { printf "%s[verify]%s %s%s%s\n" "$C_BOLD" "$C_RESET" "$C_RED" "$*" "$C_RESET" >&2; }

# ============================================================================
# 前置校验
# ============================================================================
log "ticket 07 · verifying analyzing real run"
log "  REPO_ROOT=$REPO_ROOT"
log "  WORKSPACE_ROOT=$WORKSPACE_ROOT"
log "  WEB_URL=$WEB_URL"
log "  AGENT_URL=$AGENT_URL"
log "  RUN_DIR=$RUN_DIR"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  fail "ANTHROPIC_API_KEY not set; 真 SDK 跑不动。设置后重跑:"
  fail "  ANTHROPIC_API_KEY=sk-ant-... pnpm verify:analyzing-real-run"
  exit 1
fi
ok "ANTHROPIC_API_KEY present (redacted: ${ANTHROPIC_API_KEY:0:7}...)"

# ============================================================================
# Agent 守护进程管理(走既有 agent-start.sh / agent-stop.sh)
# ============================================================================
AGENT_PID=""
agent_started_by_us=0

cleanup() {
  local rc=$?
  if [[ $agent_started_by_us -eq 1 ]]; then
    log "cleanup: stopping agent (started by us)"
    bash "$REPO_ROOT/packages/scripts/agent-stop.sh" \
      >>"$LOG_DIR/agent-stop.log" 2>&1 || true
  fi
  if [[ $rc -ne 0 ]]; then
    fail "verify 失败(exit=$rc);归档目录保留:$RUN_DIR"
  else
    ok "verify 完成;归档目录:$RUN_DIR"
  fi
  exit $rc
}
trap cleanup EXIT

start_agent() {
  log "starting agent via packages/scripts/agent-start.sh"
  if bash "$REPO_ROOT/packages/scripts/agent-start.sh" \
       >>"$LOG_DIR/agent-start.log" 2>&1; then
    agent_started_by_us=1
  else
    fail "agent-start 失败;tail of log:"
    tail -50 "$LOG_DIR/agent-start.log" >&2 || true
    return 1
  fi
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null -m 2 "$AGENT_URL/api/health"; then
      ok "agent healthy on $AGENT_URL"
      return 0
    fi
    sleep 1
  done
  fail "agent health timeout (30s);tail of log:"
  tail -80 "$LOG_DIR/agent-start.log" >&2 || true
  return 1
}

# 检查 agent 是否已在外跑(若已跑,不接管启停)
if curl -sf -o /dev/null -m 2 "$AGENT_URL/api/health"; then
  ok "agent already running on $AGENT_URL(由外部启动;本脚本不接管)"
else
  start_agent
fi

# ============================================================================
# Web:Playwright 已通过 baseURL 3333 访问 —— 本脚本不主动启 web,留给
# reviewer 决定(通常 CI 与本机都靠 `pnpm dev:web` 起)
# ============================================================================
if curl -sf -o /dev/null -m 2 "$WEB_URL/"; then
  ok "web reachable on $WEB_URL"
else
  warn "web not reachable on $WEB_URL;start with: pnpm dev:web"
  fail "此脚本只跑 backend + 归档产物,UI 端到端验收请用 pnpm e2e(spec 自动跑)"
  exit 1
fi

# ============================================================================
# 步骤 1:bootstrap token
# ============================================================================
log "step 1 · bootstrap token"
BOOTSTRAP_JSON="$RUN_DIR/bootstrap.json"
if ! curl -sf -H "origin: $WEB_URL" "$AGENT_URL/api/agent/bootstrap" \
     -o "$BOOTSTRAP_JSON"; then
  fail "bootstrap 失败;see $BOOTSTRAP_JSON"
  exit 1
fi
TOKEN="$(grep -o '"token":"[^"]*"' "$BOOTSTRAP_JSON" | head -1 | cut -d'"' -f4)"
if [[ -z "$TOKEN" ]]; then
  fail "无法解析 bootstrap token"
  exit 1
fi
ok "token: ${TOKEN:0:12}..."

# ============================================================================
# 步骤 2:创建 fixture 需求(fixture 优先,避免 docx 解析分支)
# ============================================================================
log "step 2 · POST /api/requirements(fixture 创建)"
TITLE="verify-analyzing-$STAMP"
REQ_JSON="$RUN_DIR/requirement-create.json"
HTTP_CODE="$(curl -s -o "$REQ_JSON" -w "%{http_code}" \
  -X POST "$AGENT_URL/api/requirements" \
  -H "x-aidevspace-token: $TOKEN" \
  -H "content-type: application/json" \
  -H "origin: $WEB_URL" \
  --data "{\"title\":\"$TITLE\"}")"
if [[ "$HTTP_CODE" != "201" ]]; then
  fail "create requirement 失败:HTTP $HTTP_CODE"
  cat "$REQ_JSON" >&2 || true
  exit 1
fi
REQUIREMENT_ID="$(grep -o '"id":"[^"]*"' "$REQ_JSON" | head -1 | cut -d'"' -f4)"
ok "requirement created: id=$REQUIREMENT_ID title=$TITLE"

# ============================================================================
# 步骤 3:启动分析(POST /api/requirements/<id>/analysis/start)
# ============================================================================
log "step 3 · POST /api/requirements/$REQUIREMENT_ID/analysis/start"
START_JSON="$RUN_DIR/start.json"
HTTP_CODE="$(curl -s -o "$START_JSON" -w "%{http_code}" \
  -X POST "$AGENT_URL/api/requirements/$REQUIREMENT_ID/analysis/start" \
  -H "x-aidevspace-token: $TOKEN" \
  -H "content-type: application/json" \
  -H "origin: $WEB_URL" \
  --data '{"angle":"architecture","label":"verify-架构"}')"
if [[ "$HTTP_CODE" != "201" ]]; then
  fail "start analysis 失败:HTTP $HTTP_CODE"
  cat "$START_JSON" >&2 || true
  exit 1
fi
SESSION_ID="$(grep -o '"sessionId":"[^"]*"' "$START_JSON" | head -1 | cut -d'"' -f4)"
ok "session started: $SESSION_ID"

# ============================================================================
# 步骤 4:订阅 SSE(50 行够 review 看 turn-1/turn-2 形态),同时等
# chunks.jsonl 写第一行后归零超时
# ============================================================================
log "step 4 · 订阅 SSE 50 行 + 等 chunks.jsonl ≥1 行"
SSE_LOG="$RUN_DIR/sse-stream.log"
CHUNKS_PATH="$WORKSPACE_ROOT/requirements/$REQUIREMENT_ID/analysis/sessions/$SESSION_ID/chunks.jsonl"
# 后台 curl -N 走 SSE 流;50 行后 timeout(单 SDK turn 文本不长)
curl -sN -H "origin: $WEB_URL" \
  "$AGENT_URL/api/requirement/$REQUIREMENT_ID/events" \
  --max-time 60 \
  > "$SSE_LOG" 2>&1 &
SSE_PID=$!

# 等 chunks.jsonl 出现且非空(最长 120s);turn-1 完成通常 < 60s
DEADLINE=$((SECONDS + 120))
SAW_CHUNK=0
while (( SECONDS < DEADLINE )); do
  if [[ -s "$CHUNKS_PATH" ]]; then
    SAW_CHUNK=1
    break
  fi
  sleep 2
done
# 等 SSE 流自然退出 / 兜底杀
wait "$SSE_PID" 2>/dev/null || true

if (( SAW_CHUNK == 0 )); then
  fail "chunks.jsonl 未在 120s 内出现;agent log tail:"
  if [[ -f "$WORKSPACE_ROOT/logs/agent.log" ]]; then
    tail -100 "$WORKSPACE_ROOT/logs/agent.log" >&2 || true
  fi
  exit 1
fi
ok "chunks.jsonl 已写: $(wc -l < "$CHUNKS_PATH") lines"

# ============================================================================
# 步骤 5:归档 SSE 头 3 段 + chunks.jsonl 头 5 行
# ============================================================================
log "step 5 · 归档头几行 → 上线门槛物证"
ARCHIVE_HEAD="$RUN_DIR/chunks-head-5.txt"
{
  echo "# chunks.jsonl head 5 lines"
  echo "# requirementId=$REQUIREMENT_ID"
  echo "# sessionId=$SESSION_ID"
  echo "# workspaceRoot=$WORKSPACE_ROOT"
  echo "# chunks_path=$CHUNKS_PATH"
  echo
  head -n 5 "$CHUNKS_PATH" || true
} > "$ARCHIVE_HEAD"

ARCHIVE_SSE="$RUN_DIR/sse-head-3.txt"
{
  echo "# SSE 头 3 段(named events)"
  echo "# endpoint=$AGENT_URL/api/requirement/$REQUIREMENT_ID/events"
  echo
  head -n 30 "$SSE_LOG" || true
} > "$ARCHIVE_SSE"

ok "归档物证:"
ok "  - $ARCHIVE_HEAD"
ok "  - $ARCHIVE_SSE"

# ============================================================================
# 步骤 6:打印 reviewer 报告(粘 PR 评论用)
# ============================================================================
echo
printf "%s%s%s\n" "$C_BOLD" "========================================" "$C_RESET"
printf "%s%s%s\n" "$C_BOLD" "  Verify Report — ticket 07" "$C_RESET"
printf "%s%s%s\n" "$C_BOLD" "========================================" "$C_RESET"
echo
printf "requirementId=%s\n" "$REQUIREMENT_ID"
printf "sessionId=%s\n" "$SESSION_ID"
printf "workspaceRoot=%s\n" "$WORKSPACE_ROOT"
printf "chunks_path=%s\n" "$CHUNKS_PATH"
printf "chunks_lines=%s\n" "$(wc -l < "$CHUNKS_PATH")"
echo
printf "%s chunks.jsonl head 5:%s\n" "$C_BOLD" "$C_RESET"
cat "$ARCHIVE_HEAD"
echo
printf "%s SSE head 3:%s\n" "$C_BOLD" "$C_RESET"
cat "$ARCHIVE_SSE"
echo
printf "%s%s%s\n" "$C_BOLD" "========================================" "$C_RESET"
echo
ok "完成。归档目录:$RUN_DIR"
ok "PR 上线门槛 reviewer 报告请贴:$ARCHIVE_HEAD + $ARCHIVE_SSE"