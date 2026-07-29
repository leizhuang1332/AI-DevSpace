/**
 * E2E: 真 SDK 跑 ANALYZING(ADR-0020 D11 · ticket 07)
 *
 * 验收(PRD ticket 07 spec):
 * - 启动 web + agent(走既有 `pnpm dev:web` + `pnpm dev:agent` 守护脚本)
 * - 等 SDK idle(健康检查 `/api/health` 200 + `ok: true`)
 * - 走 DRAFTING 上传或 fixture 创建新需求 → 本 spec 内 fixture 优先,
 *   避免 docx 解析分支干扰(spec 直接 `POST /api/requirements` 走
 *   后端 `requirement-create` 路径,后端落 `requirement.md` 默认内容)
 * - 进 ANALYZING → 见 AdmissionDashboard 空态 + "开始分析" 按钮
 * - 点按钮 → SSE 推 chunks → 等待 5 卡 count 全部 > 0 与 ProductList
 *   至少 1 个 subproblem
 * - 截图保存到 e2e artifact 并 attach
 * - `cat requirements/<id>/analysis/sessions/<sid>/chunks.jsonl` 头 5 行
 *   写入 spec 报告
 *
 * Skip 行为(ADR-0020 D11 上线门槛):
 * - `ANTHROPIC_API_KEY` 缺失 → `test.skip()`,Playwright 标 skipped 不 fail
 * - web(3333)/agent(7777) 不可达 → 同样 skip,不 fail
 *
 * 设计要点:
 * - **不引入** `MockClaudeProvider` / `FakeClaudeProvider` —— agent 真接 SDK,
 *   spec 仅是用户视角验证(参 ADR-0020 D11)
 * - **不覆盖** `interject` / `generate-brief` 真跑(见 ADR-0020 D13 / D14)
 * - **不覆盖** SkillsPage 改造(见 ADR-0020 D12)
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3333'
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:7777'
const SKIP_REASON_NO_KEY =
  'ANTHROPIC_API_KEY not set; e2e SKIPPED (per ADR-0020 D11 上线门槛:CI 默认 SKIP 不 fail)'
const SKIP_REASON_NO_WEB = `Web server not reachable at ${WEB_URL}; e2e SKIPPED (启动: pnpm dev:web)`
const SKIP_REASON_NO_AGENT = `Agent server not reachable at ${AGENT_URL}; e2e SKIPPED (启动: pnpm agent:start)`
const SKIP_REASON_NO_PLAYWRIGHT_BROWSER =
  'Playwright chromium browser not installed; e2e SKIPPED (运行: pnpm --filter @ai-devspace/web e2e:install)'

/** 默认 5 个 admission dimension id(与 DEFAULT_ADMISSION_DIMENSIONS 对齐)。 */
const ADMISSION_DIMENSION_IDS = [
  'loss_prevention',
  'performance',
  'arch_conflict',
  'business_reasonable',
  'context_query',
] as const

/** 默认 workspace 根(与后端 `WorkspaceService.resolveRoot` 对齐)。 */
function defaultAgentRoot(): string {
  return process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')
}

interface BootstrapPayload {
  token: string
  cookieName: string
}
interface CreateRequirementPayload {
  id: string
  title: string
  createdAt: string
}

/**
 * 通过 agent bootstrap 端点拿鉴权 token(spec 不复用浏览器 cookie;
 * 直接以 service call 形式拿 token,避免和 web 端 bootstrap 互相干扰)。
 */
async function bootstrapToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${AGENT_URL}/api/agent/bootstrap`, {
    headers: { origin: WEB_URL },
  })
  if (!res.ok()) {
    throw new Error(`bootstrap failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as BootstrapPayload
  return body.token
}

/**
 * 走 fixture 路径 POST `/api/requirements` 创建新需求 —— 后端会落
 * `requirements/<id>/meta.yaml` + `requirement.md`(默认 DRAFTING 提示
 * 内容)。**避免**走 docx 上传分支(spec 跑通不依赖 mammoth / 模板解析)。
 */
async function createRequirement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${AGENT_URL}/api/requirements`, {
    headers: {
      'x-aidevspace-token': token,
      'content-type': 'application/json',
      origin: WEB_URL,
    },
    data: { title },
  })
  if (!res.ok()) {
    throw new Error(
      `create requirement failed: ${res.status()} ${await res.text()}`,
    )
  }
  const body = (await res.json()) as CreateRequirementPayload
  return body.id
}

/**
 * 健康检查 —— 等 agent `/api/health` 返回 `ok: true`(SDK idle 的代理信号;
 * 真 SDK idle 心跳由 agent 自己保证,health 端点不直接表达 idle,但 spec
 * 既然走真 SDK 接通,启动后能拿到 health 即代表 SDK 桥已通)。
 */
async function isAgentHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${AGENT_URL}/api/health`, {
      headers: { origin: WEB_URL },
      timeout: 5_000,
    })
    if (!res.ok()) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

/**
 * web 健康检查 —— Next.js `/` 在 ready 状态下返 200;若返 redirect/500/连不上
 * → 视作不可达,test.skip()。
 */
async function isWebReachable(): Promise<boolean> {
  try {
    const res = await fetch(WEB_URL, { redirect: 'manual' })
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

/**
 * 把 `requirements/<id>/analysis/sessions/<sid>/chunks.jsonl` 头 N 行
 * 读出来(spec 报告 / commit message 上线门槛用)。
 *
 * 新版 start handler(ticket 01)在创建 session 时立即空 `writeFileSync` 出
 * `chunks.jsonl`,turn-1 / turn-2 后续 appendFileSync 行;若 spec 在 SSE 推
 * 流完成前读,可能拿到 0 行(空文件 → 返回空数组);若推流完成,头 5 行就是
 * turn-1 的 admission chunks。读不到文件本身不视作 fail —— 但记入报告。
 */
function readChunksHead(
  workspaceRoot: string,
  requirementId: string,
  headCount: number,
): { sessionId: string | null; lines: string[]; missing: boolean } {
  const sessionsDir = join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    'sessions',
  )
  let sessionId: string | null = null
  let lines: string[] = []
  let missing = true
  try {
    const entries = readdirSync(sessionsDir)
    if (entries.length === 0) return { sessionId: null, lines, missing: true }
    // 取 mtime 最新 session(语义:回滚目标 = mtime 最新 session,见
    // apps/agent/src/routes/analysis.ts `restoreSnapshot` 同款策略)
    const latest = entries
      .map((name) => ({
        name,
        mtime: statSync(join(sessionsDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    sessionId = latest.name
    const chunksPath = join(sessionsDir, sessionId, 'chunks.jsonl')
    const raw = readFileSync(chunksPath, 'utf8')
    missing = false
    lines = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .slice(0, headCount)
  } catch {
    missing = true
  }
  return { sessionId, lines, missing }
}

/**
 * 单 spec 覆盖 ticket 07 的"端到端串验"。任何中间失败都打到 test report,
 * 不隐藏;reviewer 可直接通过 Playwright HTML report 与 chunks.jsonl 头 5
 * 行回放。
 */
test('analyzing real run — 真 SDK 跑通 admission + brainstorm', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!process.env.ANTHROPIC_API_KEY, SKIP_REASON_NO_KEY)
  test.skip(!(await isWebReachable()), SKIP_REASON_NO_WEB)
  test.skip(!(await isAgentHealthy(request)), SKIP_REASON_NO_AGENT)

  // 1. fixture:拿 token + 创建新需求
  const token = await bootstrapToken(request)
  const stamp = Date.now()
  const title = `e2e-analyzing-${stamp}`
  const requirementId = await createRequirement(request, token, title)
  testInfo.annotations.push({
    type: 'requirement-id',
    description: requirementId,
  })

  // 2. 打开 ANALYZING 工位
  await page.goto(`${WEB_URL}/requirements/${requirementId}/analyzing`)
  await expect(page.getByTestId('analyzing-zone')).toBeVisible({
    timeout: 30_000,
  })

  // 3. 验 AdmissionDashboard 空态 + 「开始分析」按钮可见
  const dashboard = page.getByTestId('admission-dashboard')
  await expect(dashboard).toBeVisible()
  await expect(dashboard).toHaveAttribute('data-phase', 'empty_armed', {
    timeout: 30_000,
  })
  const startBtn = page.getByTestId('admission-start-btn')
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toHaveAttribute('data-state', 'idle')

  // 4. 点按钮 —— 期望 state 切到 starting/running;按钮常驻(ticket 08),
  //    不会被卸载;startState 在 SSE 推 `analysis_done` 事件后由 web 端
  //    AnalyzingZone 监听复位回 idle
  await startBtn.click()

  // 4a. ticket 08 断言:按钮常驻可见;state=running(disabled 防重)
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toHaveAttribute('data-state', 'running', {
    timeout: 30_000,
  })

  // 5. 等 5 张 admission dim count 全部 > 0(turn-1 阶段产物)
  //    顺序:loss_prevention → performance → arch_conflict → business_reasonable
  //    → context_query(由 admission-check SKILL prompt 引导,见 ticket 02)
  for (const dimId of ADMISSION_DIMENSION_IDS) {
    const card = page.getByTestId(`admission-dim-${dimId}`)
    await expect(card).toHaveAttribute('data-count', /^[1-9]\d*$/, {
      timeout: 180_000,
    })
  }

  // 6. 等 ProductList 至少 1 个 subproblem(turn-2 阶段产物)
  //    ticket 02 requirement-brainstorm SKILL prompt 引导 AI 输出
  //    subproblem / risk / option 三类 chunk;spec 只校验 subproblem 至少 1
  //    是因为 ticket 07 验收 #5 锁定(ProductList 至少 1 个 subproblem)
  const firstSubproblem = page
    .getByTestId('product-subproblems-item')
    .first()
  await expect(firstSubproblem).toBeVisible({ timeout: 180_000 })

  // 6a. ticket 08:等 agent 端 turn-done publish `analysis_done` → web 端
  //     AnalyzingZone 监听 → setStartState('idle');按钮回到可点击 idle 态
  //     60s 超时覆盖双 turn 串行最长允许时长
  await expect(startBtn).toHaveAttribute('data-state', 'idle', {
    timeout: 60_000,
  })
  await expect(startBtn).toBeVisible()

  // 7. 截图(全页 + AdmissionDashboard 局部)
  const screenshotDir = testInfo.outputDir
  await page.screenshot({
    path: join(screenshotDir, 'analyzing-real-run-fullpage.png'),
    fullPage: true,
  })
  await page
    .locator('[data-testid="admission-dashboard"]')
    .screenshot({ path: join(screenshotDir, 'analyzing-real-run-dashboard.png') })

  // 8. 读 chunks.jsonl 头 5 行入 spec 报告(上线门槛物证)
  const workspaceRoot = defaultAgentRoot()
  const { sessionId, lines, missing } = readChunksHead(
    workspaceRoot,
    requirementId,
    5,
  )
  testInfo.annotations.push({ type: 'session-id', description: sessionId ?? '' })
  testInfo.annotations.push({
    type: 'chunks-missing',
    description: String(missing),
  })
  const headBlock = [
    `# chunks.jsonl head (requirementId=${requirementId}, sessionId=${sessionId ?? 'n/a'})`,
    `# workspaceRoot=${workspaceRoot}`,
    `# missing=${missing}`,
    ...(lines.length === 0
      ? ['(no chunks yet — turn-1/turn-2 SSE may still be in flight)']
      : lines),
  ].join('\n')
  // attach 让 Playwright HTML report 里有这块内容;testInfo.attach 也让
  // 上线门槛 reviewer 可一眼看到
  await testInfo.attach('chunks-head.txt', {
    body: headBlock,
    contentType: 'text/plain',
  })

  // 9. 断言 chunks.jsonl 至少被读到(空文件不视作 fail —— 上一步报告里已说明;
  //    spec 自身通过 5 dim count > 0 + ≥1 subproblem 强校验)
  expect(lines.length).toBeGreaterThan(0)
})

/**
 * 轻量冒烟 test —— 验证 web / agent 鉴权链路可达,不依赖 ANTHROPIC_API_KEY。
 *
 * 价值:CI 缺 key 时,这条至少跑通,证明 e2e 套件"骨架活着",reviewer 不会
 * 误判"e2e 全 skipped = 套件坏"。
 */
test('bootstrap: agent /api/agent/bootstrap 返 token', async ({ request }) => {
  test.skip(!(await isWebReachable()), SKIP_REASON_NO_WEB)
  test.skip(!(await isAgentHealthy(request)), SKIP_REASON_NO_AGENT)
  const res = await request.get(`${AGENT_URL}/api/agent/bootstrap`, {
    headers: { origin: WEB_URL },
  })
  expect(res.status()).toBe(200)
  const body = (await res.json()) as BootstrapPayload
  expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

// Re-export 以便 mocha 报告里看到(SKIP_REASON_NO_PLAYWRIGHT_BROWSER 是占位,
// 真正缺浏览器是 `playwright install` 阶段;Playwright 自带错误信息已经
// 清晰,这里不重复定义额外 test)
void SKIP_REASON_NO_PLAYWRIGHT_BROWSER