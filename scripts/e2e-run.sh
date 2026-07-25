#!/usr/bin/env bash
#
# scripts/e2e-run.sh
#
# `pnpm e2e` 包装脚本(ADR-0020 D11 · ticket 07)
#
# 职责:
#   - ANTHROPIC_API_KEY 缺失 → print SKIPPED reason + exit 0(CI 默认行为,
#     不 fail,见 ADR-0020 上线门槛第 4 项)
#   - @playwright/test 未安装 → print SKIPPED reason + exit 0(避免本地
#     首次 clone 跑 `pnpm e2e` 报缺包失败)
#   - chromium browser 未下载 → print SKIPPED reason + exit 0(同上,
#     引导 reviewer 跑 `pnpm --filter @ai-devspace/web e2e:install`)
#   - 否则转交 `pnpm --filter @ai-devspace/web exec playwright test`
#
# 设计要点:
#   - 永远不返回非零退出码当 skip 触发 —— 让 CI 默认 SKIP 不 fail
#   - 显式打印 SKIPPED 行,reviewer 一眼能识别(而非"无声"通过)
#   - 真正 fail(e2e 跑通但断言失败)→ exit 1(透传 Playwright 退出码)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web"

# 颜色
if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_RESET=$'\033[0m'
else
  C_BOLD="" C_YELLOW="" C_RED="" C_RESET=""
fi
log()  { printf "%s[e2e]%s %s\n" "$C_BOLD" "$C_RESET" "$*"; }
warn() { printf "%s[e2e]%s %s%s%s\n" "$C_BOLD" "$C_RESET" "$C_YELLOW" "$*" "$C_RESET"; }
fail() { printf "%s[e2e]%s %s%s%s\n" "$C_BOLD" "$C_RESET" "$C_RED" "$*" "$C_RESET" >&2; }

# ============================================================================
# 1. ANTHROPIC_API_KEY 缺失 → SKIP(参 ADR-0020 上线门槛第 4 项)
# ============================================================================
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  warn "SKIPPED e2e: ANTHROPIC_API_KEY not set"
  warn "  Per ADR-0020 D11 上线门槛,CI 默认 SKIP 不 fail"
  warn "  本机跑:export ANTHROPIC_API_KEY=sk-ant-... && pnpm e2e"
  exit 0
fi

# ============================================================================
# 2. @playwright/test 未安装 → SKIP(避免本地首次 clone 跑 pnpm e2e 撞缺包)
# ============================================================================
if [[ ! -d "$WEB_DIR/node_modules/@playwright/test" ]]; then
  warn "SKIPPED e2e: @playwright/test not installed"
  warn "  安装:pnpm install(自动含 devDep)"
  warn "  或显式:pnpm --filter @ai-devspace/web e2e:install(下载 chromium)"
  exit 0
fi

# ============================================================================
# 3. chromium browser 未下载 → 探测并 SKIP
# ============================================================================
PW_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if [[ ! -d "$PW_BROWSERS_PATH" ]] \
   && ! compgen -G "$WEB_DIR/node_modules/playwright-core/.local-browsers/*" >/dev/null; then
  warn "SKIPPED e2e: Playwright chromium browser not downloaded"
  warn "  安装:pnpm --filter @ai-devspace/web e2e:install"
  exit 0
fi

# ============================================================================
# 4. 准备转交 Playwright
# ============================================================================
log "ANTHROPIC_API_KEY present; running pnpm e2e (chromium)"
cd "$REPO_ROOT"
exec pnpm --filter @ai-devspace/web exec playwright test "$@"