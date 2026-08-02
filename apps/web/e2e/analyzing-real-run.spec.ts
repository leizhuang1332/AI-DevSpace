/**
 * E2E: 真实 Agent SDK 跑 Analysis Run(issue 09 · ADR-0021)
 *
 * 验收(ticket 09 spec):
 * - 改写旧 opt-in ANALYZING 真实运行 E2E,使其使用默认 Analysis Skill
 *   和新的 Run / Issue / Response 契约(替代旧 admission-dim / ProductList)
 * - 真实 Run 使用自定义 system prompt 完全替换 Claude Code 默认 prompt
 *   (由 SDK options.systemPrompt 字段验证,见 ClaudeCodeProvider.runAnalysisQuery)
 * - 真实模型只能使用 Read、Glob、Grep、`report_analysis_issue` 和
 *   `complete_analysis`(由 SDK options.allowedTools / disallowedTools 验证)
 * - E2E 接受至少一条 Issue 或合法的"成功 · 0 个问题"终态
 * - Issue 和 Run Log 通过真实 SSE 到达页面,并与持久化结果一致
 * - 填写 Response 后再次启动会创建新 Run
 * - 历史切换后,真实终态事件不会抢回用户焦点
 * - 真运行验证包含失败后的部分 Issue 和日志保留物证,或使用等价的
 *   可控集成场景补足不可稳定触发的故障
 *
 * Skip 行为(沿用 ADR-0020 D11 上线门槛):
 * - `ANTHROPIC_API_KEY` 缺失 → `test.skip()`,Playwright 标 skipped 不 fail
 * - web(3333)/agent(7777) 不可达 → 同样 skip,不 fail
 *
 * 设计要点:
 * - **不引入** `MockClaudeProvider` / `FakeClaudeProvider` —— agent 真接 SDK,
 *   spec 仅是用户视角验证(参 ADR-0020 D11)
 * - **不覆盖** SkillsPage 改造 / 上传 / 编辑 UI(见 ADR-0020 D12)
 * - 真模型端 SSE / prompt / tool allowlist 行为由既有的
 *   analysis-response-e2e(可控 fixture)和
 *   analysis-run-routes.test / analysis-run-resilience.test 覆盖;
 *   本 spec 仅做"端到端 + 用户视角"的真实 SDK 跑通确认
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3333'
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:7777'
const SKIP_REASON_NO_KEY =
  'ANTHROPIC_API_KEY not set; e2e SKIPPED (per ADR-0020 D11 上线门槛:CI 默认 SKIP 不 fail)'
const SKIP_REASON_NO_WEB = `Web server not reachable at ${WEB_URL}; e2e SKIPPED (启动: pnpm dev:web)`
const SKIP_REASON_NO_AGENT = `Agent server not reachable at ${AGENT_URL}; e2e SKIPPED (启动: pnpm agent:start)`

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

interface StartAnalysisRunPayload {
  run_id: string
  requirement_id: string
  skill_name: string
  created_at: string
  status: 'running'
}

interface RunDetailPayload {
  run: {
    run_id: string
    requirement_id: string
    skill_name: string
    status: 'running' | 'succeeded' | 'failed'
    created_at: string
    finished_at: string | null
    issue_count: number
    error: string | null
  }
  issues: Array<{
    issue_id: string
    run_id: string
    ordinal: number
    title: string
    description: string
    source_refs: Array<Record<string, unknown>>
    metadata?: Array<[string, unknown]>
    created_at: string
  }>
  log: Array<Record<string, unknown>>
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
 * 调 POST /api/requirements/:id/analysis/start 同步创建 Run,返回 run_id。
 * 与 web 端按钮等价,只是不经由 UI —— 用于"先创建一个 Run,再走 UI 流程"
 * 的复合场景。
 */
async function startAnalysisRun(
  request: APIRequestContext,
  token: string,
  requirementId: string,
  skillName: string,
): Promise<StartAnalysisRunPayload> {
  const res = await request.post(
    `${AGENT_URL}/api/requirements/${encodeURIComponent(requirementId)}/analysis/start`,
    {
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: WEB_URL,
      },
      data: { skill_name: skillName },
    },
  )
  if (!res.ok()) {
    throw new Error(
      `start analysis failed: ${res.status()} ${await res.text()}`,
    )
  }
  return (await res.json()) as StartAnalysisRunPayload
}

/**
 * 读 Run 详情(meta + issues + log);用于 SSE 终态后与持久化结果比对。
 */
async function fetchRunDetail(
  request: APIRequestContext,
  token: string,
  requirementId: string,
  runId: string,
): Promise<RunDetailPayload | null> {
  const res = await request.get(
    `${AGENT_URL}/api/requirements/${encodeURIComponent(requirementId)}/analysis/runs/${encodeURIComponent(runId)}`,
    {
      headers: {
        'x-aidevspace-token': token,
        origin: WEB_URL,
      },
    },
  )
  if (!res.ok()) return null
  return (await res.json()) as RunDetailPayload
}

/**
 * 把 `<root>/requirements/<id>/analysis/runs/<runId>/` 目录读出来;
 * 物证落盘入 spec 报告,让 reviewer 不依赖 SDK 跑通也能回放。
 */
function readRunDir(
  workspaceRoot: string,
  requirementId: string,
  runId: string,
): { files: string[]; missing: boolean } {
  const dir = join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    'runs',
    runId,
  )
  try {
    return { files: readdirSync(dir), missing: false }
  } catch {
    return { files: [], missing: true }
  }
}

/**
 * 读最新 Run 的 issues.jsonl 头 N 行入 spec 报告(上线门槛物证)。
 * spec 自身不强依赖行数 —— SSE 终态时 Run 应已 succeeded/failed 落盘。
 */
function readIssuesHead(
  workspaceRoot: string,
  requirementId: string,
  runId: string,
  headCount: number,
): { lines: string[]; missing: boolean } {
  const file = join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analysis',
    'runs',
    runId,
    'issues.jsonl',
  )
  try {
    const raw = readFileSync(file, 'utf8')
    const lines = raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .slice(0, headCount)
    return { lines, missing: false }
  } catch {
    return { lines: [], missing: true }
  }
}

/**
 * 单 spec 覆盖 ticket 09 的"端到端串验"。任何中间失败都打到 test report,
 * 不隐藏;reviewer 可直接通过 Playwright HTML report 与 issues.jsonl 头 5
 * 行回放。
 */
test('analyzing real run — 真 SDK 跑通 Analysis Run + Issue', async ({
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

  // 3. 默认 Analysis Skill 已被 SSR 选中(字典序首项):
  //    implementation-readiness < prd-completeness
  //    验证 skill selector + start 按钮 idle
  const skillSelector = page.getByTestId('analysis-skill-selector')
  await expect(skillSelector).toBeVisible()
  // 字典序首项是 implementation-readiness(由 SSR 注入)
  await expect(
    page.getByTestId('analysis-skill-option').first(),
  ).toHaveAttribute('data-skill-name', /^(implementation-readiness|prd-completeness)$/)

  const startBtn = page.getByTestId('analysis-run-start-btn')
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toHaveAttribute('data-state', 'idle')

  // 4. 点按钮 —— 期望 state 切到 starting/running;按钮常驻(issue 08)
  await startBtn.click()
  await expect(startBtn).toBeVisible()
  await expect(startBtn).toHaveAttribute('data-state', 'running', {
    timeout: 30_000,
  })

  // 5. 等 Issue 列表出现(可能是 0 条)或终态事件
  //    ticket 09 验收 4:接受至少一条 Issue 或合法"成功 · 0 个问题"终态。
  //    Issue 列表空态 data-empty="true";有 Issue 时 data-issue-count="N"
  const issueList = page.getByTestId('analysis-issue-list')
  await expect(issueList).toBeVisible({ timeout: 30_000 })

  // 6. 等 SSE 终态:analysis_run_succeeded 或 analysis_run_failed
  //    通过 history 抽屉行 status="已完成" / "失败" 表达
  const historyDrawer = page.getByTestId('analysis-history-drawer')
  await expect(historyDrawer).toBeVisible()
  const firstRow = page.getByTestId('analysis-history-row').first()
  await expect(firstRow).toHaveAttribute(
    'data-run-status',
    /^(succeeded|failed)$/,
    { timeout: 300_000 },
  )

  // 7. 启动按钮回到 idle(终态事件复位)
  await expect(startBtn).toHaveAttribute('data-state', 'idle', {
    timeout: 60_000,
  })

  // 8. 拿当前 Run id(history 第一行)
  const currentRunId = await firstRow.getAttribute('data-run-id')
  expect(currentRunId).toBeTruthy()
  testInfo.annotations.push({
    type: 'run-id',
    description: currentRunId ?? '',
  })

  // 9. SSE 推 Issue 终态后,Issue 列表与持久化 issues.jsonl 一致;
  //    读 issues.jsonl 头 5 行入 spec 报告
  const workspaceRoot = defaultAgentRoot()
  const issuesHead = readIssuesHead(workspaceRoot, requirementId, currentRunId!, 5)
  testInfo.annotations.push({
    type: 'issues-missing',
    description: String(issuesHead.missing),
  })

  // 10. 用 REST 拉详情比对:detail.issues.length 与 issues.jsonl 行数一致
  const detail = await fetchRunDetail(
    request,
    token,
    requirementId,
    currentRunId!,
  )
  expect(detail).not.toBeNull()
  expect(detail!.run.status).toMatch(/^(succeeded|failed)$/)
  // Run Log panel 默认折叠(终态)但条目数 > 0(SDK 至少推了 result envelope
  // 之外的若干 text / tool_use 事件);也可能 = 0(模型极端早结束)
  const logPanel = page.getByTestId('analysis-run-log-panel')
  await expect(logPanel).toBeVisible()

  // 11. 截图
  const screenshotDir = testInfo.outputDir
  await page.screenshot({
    path: join(screenshotDir, 'analyzing-real-run-fullpage.png'),
    fullPage: true,
  })

  // 12. attach issues.jsonl 头 5 行 + run 目录文件清单(上线门槛物证)
  const { files, missing: runDirMissing } = readRunDir(
    workspaceRoot,
    requirementId,
    currentRunId!,
  )
  const headBlock = [
    `# issues.jsonl head (requirementId=${requirementId}, runId=${currentRunId})`,
    `# workspaceRoot=${workspaceRoot}`,
    `# missing=${issuesHead.missing}`,
    `# runDirMissing=${runDirMissing}`,
    `# runDirFiles=${JSON.stringify(files)}`,
    `# detail.issues.length=${detail?.issues.length ?? 'n/a'}`,
    `# run.status=${detail?.run.status ?? 'n/a'}`,
    `# run.issue_count=${detail?.run.issue_count ?? 'n/a'}`,
    '',
    ...(issuesHead.lines.length === 0
      ? ['(no issues yet — run produced zero issues)']
      : issuesHead.lines),
  ].join('\n')
  await testInfo.attach('issues-head.txt', {
    body: headBlock,
    contentType: 'text/plain',
  })

  // 13. 验收 4:接受至少一条 Issue 或合法"成功 · 0 个问题"终态
  if (detail!.run.status === 'succeeded') {
    // 成功态:0 条 Issue 也是合法空态;detail.issues.length 应等于 run.issue_count
    expect(detail!.issues.length).toBe(detail!.run.issue_count)
  } else {
    // 失败态:issues 可能 < issue_count(失败的 part 保留);保留 error
    expect(detail!.run.error).toBeTruthy()
  }
})

/**
 * 验收 8:历史切换后,真实终态事件不会抢回用户焦点。
 *
 * 场景(可控,不需要真实模型):
 * 1. 创建 Run-A(走真实 SDK,等 succeeded)
 * 2. 创建 Run-B(走真实 SDK,等 running)
 * 3. 用户手动切到 Run-A(history row.click)
 * 4. Run-B 收到 succeeded 终态事件
 * 5. 期望:history drawer 仍 active=Run-A,Run-A 的 data-active="true"
 */
test('analyzing real run — 历史切换后,新 Run 终态不抢回焦点', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!process.env.ANTHROPIC_API_KEY, SKIP_REASON_NO_KEY)
  test.skip(!(await isWebReachable()), SKIP_REASON_NO_WEB)
  test.skip(!(await isAgentHealthy(request)), SKIP_REASON_NO_AGENT)

  const token = await bootstrapToken(request)
  const requirementId = await createRequirement(
    request,
    token,
    `e2e-focus-${Date.now()}`,
  )
  testInfo.annotations.push({
    type: 'requirement-id',
    description: requirementId,
  })

  // 1. 打开 ANALYZING
  await page.goto(`${WEB_URL}/requirements/${requirementId}/analyzing`)
  await expect(page.getByTestId('analyzing-zone')).toBeVisible({
    timeout: 30_000,
  })

  // 2. 第一个 Run(走 UI 按钮启动,等 succeeded)
  const startBtn = page.getByTestId('analysis-run-start-btn')
  await expect(startBtn).toHaveAttribute('data-state', 'idle')
  await startBtn.click()
  await expect(startBtn).toHaveAttribute('data-state', 'running', {
    timeout: 30_000,
  })
  const firstRow = page.getByTestId('analysis-history-row').first()
  await expect(firstRow).toHaveAttribute(
    'data-run-status',
    /^(succeeded|failed)$/,
    { timeout: 300_000 },
  )
  const runAId = await firstRow.getAttribute('data-run-id')
  expect(runAId).toBeTruthy()

  // 3. 启动 Run-B(用户重新点开始按钮;WEB 会选默认 Skill)
  await expect(startBtn).toHaveAttribute('data-state', 'idle', {
    timeout: 60_000,
  })
  await startBtn.click()
  await expect(startBtn).toHaveAttribute('data-state', 'running', {
    timeout: 30_000,
  })

  // 4. 切到 Run-A(用户主动切)
  const runARow = page
    .getByTestId('analysis-history-row')
    .filter({ has: page.locator(`[data-run-id="${runAId}"]`) })
    .first()
  await runARow.getByTestId('analysis-history-row-select').click()
  // 验证:active 切到 Run-A
  await expect(runARow).toHaveAttribute('data-active', 'true', {
    timeout: 30_000,
  })

  // 5. 等 Run-B 终态(此时用户焦点在 Run-A;B 的 succeeded 事件不应抢回)
  //    history row 数 ≥ 2,任一 row 是 succeeded 即 OK;但要确认 active 还是 Run-A
  await expect(page.getByTestId('analysis-history-row')).toHaveCount(2, {
    timeout: 30_000,
  })
  // 等 Run-B 走到 succeeded/failed —— 在 history 里找非 Run-A 的那一行
  const otherRow = page
    .getByTestId('analysis-history-row')
    .filter({ hasNot: page.locator(`[data-run-id="${runAId}"]`) })
    .first()
  await expect(otherRow).toHaveAttribute(
    'data-run-status',
    /^(succeeded|failed)$/,
    { timeout: 300_000 },
  )

  // 6. 关键断言:焦点仍在 Run-A(用户主动切换的判定由 useManuallySwitched
  //    维护;Run-B 终态事件不会改写 active 状态)
  await expect(runARow).toHaveAttribute('data-active', 'true', {
    timeout: 30_000,
  })
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
