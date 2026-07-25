/**
 * Playwright 配置 — analyzing-real-run e2e
 *
 * 设计要点(ADR-0020 D11 · ticket 07):
 * - **不**自动启动 web / agent —— 走既有 `pnpm dev:web` + `pnpm dev:agent`
 *   守护脚本(本仓库 `packages/scripts/agent-start.sh` + agent 默认 tsx watch)。
 *   这避免 e2e 与 dev 服务器相互抢占端口 / 共享状态。
 * - **不**注册 webServer:web+agent 缺位即整 spec `test.skip()`,而不是
 *   webServer 失败退出 process 让 CI 假绿。
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
  },
})