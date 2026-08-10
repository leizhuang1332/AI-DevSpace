/**
 * Playwright 配置 — analyzing-real-run e2e
 *
 * 设计要点(ADR-0020 D11 · ticket 07 · audit-2026-07-26 #5):
 * - **按需自启 web + agent**:`E2E_AUTOSTART=1` 时注册 `webServer`,让
 *   `pnpm e2e` 成为**自包含**的一条命令(审计指出 spec 之前完全不启服务,
 *   于是 CI 里永远走 skip 分支,"绿"是假绿)。
 *   `reuseExistingServer` 恒为 true:本机已经 `pnpm dev` 起着服务时直接复用,
 *   不抢端口、不污染 dev 的 `.next/`(见仓库 CLAUDE.md 的 dev↔build 隔离规则)。
 * - 默认(不设 E2E_AUTOSTART)仍**不**自启:保留"本机 dev 服已跑"的日常用法,
 *   web/agent 缺位时 spec 走 `test.skip()`,不 fail。
 * - chromium 单 project:真 SDK 跑本就慢,firefox/webkit 再跑是浪费 CI 时长。
 * - timeout 5 分钟:turn-1 admission 5 维 + turn-2 brainstorm 三桶,真 SDK
 *   在 token 经济 / network latency 下常需 1-3 分钟;5 分钟给"网络异常 +
 *   retry"留 buffer。
 *
 * Skip 行为(参 ticket 07 spec):
 * - `ANTHROPIC_API_KEY` 缺 → spec 内部 `test.skip()`,Playwright 标 skipped;
 *   不 fail(CI 默认行为见 `pnpm e2e` 包装脚本)。
 * - web(3333)/agent(7777) 不可达 → 同样 `test.skip()`,不 fail。
 */

import { defineConfig, devices } from '@playwright/test'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3333'
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:7777'
const AUTOSTART = process.env.E2E_AUTOSTART === '1'

/**
 * 自启服务定义 —— 仅在 `E2E_AUTOSTART=1` 时生效。
 *
 * agent 走仓库既有守护脚本(会 `mkdir` snapshot 目录、写 pid 文件);
 * web 走 `pnpm dev:web`(**不** `next build` —— 见 CLAUDE.md:build 会覆盖
 * dev 的 `.next/` 运行时缓存)。
 */
const webServers = [
  {
    command: 'pnpm --filter @ai-devspace/agent exec tsx src/server.ts',
    url: `${AGENT_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    /**
     * issue 09 e2e 守门 —— `AIDEVSPACE_FAKE_CHAT_PROVIDER=1` 让 agent 用
     * 脚本化 FakeChatProvider 跑 board-chat.spec.ts(确定性 emit
     * PermissionPrompt / PlanModePrompt / CostCapModal 等 11 步),不走真
     * ClaudeCodeProvider。生产 / 其他 e2e 不设该 env → 行为不变。
     * reuseExistingServer: true 时,若 agent 已手动起(带该 env)就直接复用。
     */
    env: { AIDEVSPACE_FAKE_CHAT_PROVIDER: '1' },
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  },
  {
    command: 'pnpm --filter @ai-devspace/web dev',
    url: WEB_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  },
]

export default defineConfig({
  testDir: './e2e',
  /** 单 spec 文件 5 分钟上限;真 SDK 跑 token 限速时 turn-1 可能 60-90s。 */
  timeout: 5 * 60 * 1000,
  /** 全局 expect 超时给长流程更多 buffer(SSE 推 chunks 中间可能 5-10s 静默)。 */
  expect: { timeout: 60_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: './test-results',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /** 单次 page action 60s;SDK 模型慢响应时给浏览器 fetch 留 buffer。 */
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  ...(AUTOSTART ? { webServer: webServers } : {}),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /** metadata 供 `playwright test --grep` 过滤;不强制 CI 必带。 */
  metadata: {
    webUrl: WEB_URL,
    agentUrl: AGENT_URL,
    autostart: AUTOSTART,
  },
})