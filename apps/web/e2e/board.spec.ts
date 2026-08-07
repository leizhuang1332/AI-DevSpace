/**
 * E2E: board section 看板页 + Card 形态(issue 07 / ADR-0027)
 *
 * 验收(issue 07 spec checklist):
 * - 创建 Requirement → 切到 board section → 看到 5 列看板
 * - 点 [+ 新任务] → 填表 → 提交 → 卡片出现在 backlog 列(默认 status=backlog)
 * - 5 列看板显示该卡(board-card testid + data-status=backlog)
 * - toolbar 4 filter chips 切换(全部/我的/高优先级/PRD 拆)
 * - [+ 从 PRD 拆] 按钮本期 disabled(灰显,留 ticket 08)
 *
 * 不触发 Run(守门 zero-touch,ADR-0023);manual 卡创建直接 POST /board/cards。
 *
 * Skip 行为(沿用 analyzing-real-run.spec.ts · ADR-0020 D11):
 * - web(3333)/agent(7777)不可达 → test.skip(),不 fail
 * - 本 spec 不需要 ANTHROPIC_API_KEY(不发 Run)
 */

import { test, expect, type APIRequestContext } from '@playwright/test'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3333'
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:7777'
const SKIP_REASON_NO_WEB = `Web server not reachable at ${WEB_URL}; e2e SKIPPED (启动: pnpm dev)`
const SKIP_REASON_NO_AGENT = `Agent server not reachable at ${AGENT_URL}; e2e SKIPPED (启动: pnpm agent:start)`

interface BootstrapPayload {
  token: string
  cookieName: string
}
interface CreateRequirementPayload {
  id: string
  title: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// 健康检查 + bootstrap + 创建需求 helper(沿用 analyzing-real-run.spec.ts)
// ---------------------------------------------------------------------------

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

async function isWebReachable(): Promise<boolean> {
  try {
    const res = await fetch(WEB_URL, { redirect: 'manual' })
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

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

// ---------------------------------------------------------------------------
// spec
// ---------------------------------------------------------------------------

test.describe('board section e2e', () => {
  test.beforeEach(async ({ request }) => {
    const webOk = await isWebReachable()
    const agentOk = await isAgentHealthy(request)
    test.skip(!webOk, SKIP_REASON_NO_WEB)
    test.skip(!agentOk, SKIP_REASON_NO_AGENT)
  })

  test('创建 Requirement → 切 board → 创建 manual 卡 → 5 列显示该卡', async ({
    page,
    request,
  }) => {
    const token = await bootstrapToken(request)
    const reqId = await createRequirement(
      request,
      token,
      `board-e2e-${Date.now()}`,
    )

    // 注入 token cookie(让 web 端 fetch agent 通过鉴权)
    const cookieName = 'aidevspace_token'
    await page.context().addCookies([
      {
        name: cookieName,
        value: token,
        domain: new URL(WEB_URL).hostname,
        path: '/',
        httpOnly: false,
        sameSite: 'Lax',
      },
    ])

    // 1. 导航到 board section
    await page.goto(`${WEB_URL}/requirements/${encodeURIComponent(reqId)}/board/`)

    // 2. board section 渲染 + 5 列
    await expect(page.getByTestId('board-section')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('board-toolbar')).toBeVisible()
    const columns = page.getByTestId('board-column')
    await expect(columns).toHaveCount(5)

    // 5 列顺序:backlog / todo / in_progress / in_review / done
    await expect(columns.nth(0)).toHaveAttribute('data-status', 'backlog')
    await expect(columns.nth(1)).toHaveAttribute('data-status', 'todo')
    await expect(columns.nth(2)).toHaveAttribute('data-status', 'in_progress')
    await expect(columns.nth(3)).toHaveAttribute('data-status', 'in_review')
    await expect(columns.nth(4)).toHaveAttribute('data-status', 'done')

    // 3. [+ 从 PRD 拆] 按钮 disabled(本期灰显)
    const splitBtn = page.getByTestId('board-split-from-prd')
    await expect(splitBtn).toBeDisabled()

    // 4. 点 [+ 新任务] → 填表 → 提交
    await page.getByTestId('board-new-task').click()
    await expect(page.getByTestId('board-new-task-modal')).toBeVisible()
    const cardTitle = `e2e-card-${Date.now()}`
    await page.getByTestId('board-new-task-title').fill(cardTitle)
    await page.getByTestId('board-new-task-content').fill('e2e 测试卡片内容')
    await page.getByTestId('board-new-task-priority').selectOption('high')
    await page.getByTestId('board-new-task-submit').click()

    // 5. modal 关闭 + 卡片出现在 backlog 列(默认 status=backlog)
    await expect(page.getByTestId('board-new-task-modal')).toBeHidden({
      timeout: 10_000,
    })
    const card = page.getByTestId('board-card').filter({
      hasText: cardTitle,
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-status', 'backlog')
    await expect(card).toHaveAttribute('data-priority', 'high')

    // 6. backlog 列 count = 1
    const backlogColumn = columns.nth(0)
    await expect(backlogColumn).toHaveAttribute('data-count', '1')

    // 7. filter chip 切换:点高优先级 → 该卡仍在(priority=high 命中)
    await page.getByTestId('board-filter-chip-high-priority').click()
    await expect(page.getByTestId('board-section')).toHaveAttribute(
      'data-filter',
      'high-priority',
    )
    await expect(card).toBeVisible()

    // 8. 点 PRD 拆 filter → 无卡(source 非 prd_split)
    await page.getByTestId('board-filter-chip-prd-split').click()
    await expect(page.getByTestId('board-section')).toHaveAttribute(
      'data-filter',
      'prd-split',
    )
    await expect(page.getByTestId('board-card')).toHaveCount(0)

    // 9. 回全部 filter → 卡重新可见
    await page.getByTestId('board-filter-chip-all').click()
    await expect(card).toBeVisible()
  })
})
