/**
 * E2E: board section 卡片物理删除(issue 04 / ADR-0036)
 *
 * 验收(issue 04 spec checklist):
 * - (a) 正常删除:菜单 ⋯ → 「删除任务」→ ConfirmDialog 输入 DELETE → 提交
 *       → Toast「已删除 <id>」→ 卡片 DOM 消失
 * - (b) Cancel 流:菜单 ⋯ → 「删除任务」→ ConfirmDialog 不输入 → 取消
 *       → 卡片仍在
 * - (c) 子任务 blocker:parent 卡有子卡 → 删除 parent → 弹 BlockerModal
 *       → 点 blocker 项 → 跳详情页
 * - (d) 依赖方 blocker:卡 B depends_on 卡 A → 删除 A → 弹 BlockerModal 显示 B
 *
 * Spec 来源:apps/web/e2e/board.spec.ts(沿用 helper + isWebReachable / isAgentHealthy /
 * bootstrapToken / createRequirement)。
 *
 * 子任务 / 依赖方场景必须先 PATCH /board/cards/:cardId 改 parent_id / depends_on;
 * 该 PATCH 走 `BoardCardPatchSchema` 字段白名单,接受 parent_id / depends_on。
 * 创造完 blocker 条件后,菜单触发物理删除走 DELETE /board/cards/:cardId → 409。
 *
 * Skip 行为(沿用 board.spec.ts · ADR-0020 D11):
 * - web(3333)/agent(7777)不可达 → test.skip(),不 fail
 * - 本 spec 不需要 ANTHROPIC_API_KEY(不发 Run)
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

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
interface CreateCardPayload {
  card: { id: string }
}

const COOKIE_NAME = 'aidevspace_token'

// ---------------------------------------------------------------------------
// helpers(沿用 board.spec.ts + 扩展 PATCH helper 用作 blocker 场景造数据)
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
    const res = await fetch(`${WEB_URL}/api/agent/bootstrap`, {
      redirect: 'manual',
    })
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

async function createCard(
  request: APIRequestContext,
  token: string,
  reqId: string,
  title: string,
): Promise<string> {
  const res = await request.post(
    `${AGENT_URL}/api/requirement/${encodeURIComponent(reqId)}/board/cards`,
    {
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: WEB_URL,
      },
      data: { title },
    },
  )
  if (!res.ok()) {
    throw new Error(`create card failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as CreateCardPayload
  return body.card.id
}

async function patchCard(
  request: APIRequestContext,
  token: string,
  reqId: string,
  cardId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await request.patch(
    `${AGENT_URL}/api/requirement/${encodeURIComponent(reqId)}/board/cards/${encodeURIComponent(cardId)}`,
    {
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: WEB_URL,
      },
      data: body,
    },
  )
  if (!res.ok()) {
    throw new Error(`patch card failed: ${res.status()} ${await res.text()}`)
  }
}

async function authedPage(page: Page, token: string): Promise<void> {
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: new URL(WEB_URL).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ])
}

/**
 * 通用:从 board 页面上,定位指定 title 的卡片并打开菜单。
 * 返回找到的 card Locator。
 */
async function openMenuOnCard(page: Page, cardTitle: string): Promise<void> {
  const card = page.getByTestId('board-card').filter({ hasText: cardTitle })
  await expect(card).toBeVisible({ timeout: 15_000 })
  // menu 按钮在 card-top 里
  await card.getByTestId('board-card-menu').click()
  await expect(page.getByTestId('board-card-menu-dropdown')).toBeVisible()
}

// ---------------------------------------------------------------------------
// spec
// ---------------------------------------------------------------------------

test.describe('board-card-delete e2e (issue 04 / ADR-0036)', () => {
  test.beforeEach(async ({ request }) => {
    const webOk = await isWebReachable()
    const agentOk = await isAgentHealthy(request)
    test.skip(!webOk, SKIP_REASON_NO_WEB)
    test.skip(!agentOk, SKIP_REASON_NO_AGENT)
  })

  test('(a) 正常删除:菜单 → 输入 DELETE → 提交 → Toast + 卡片消失', async ({
    page,
    request,
  }) => {
    const token = await bootstrapToken(request)
    const reqId = await createRequirement(
      request,
      token,
      `board-delete-a-${Date.now()}`,
    )
    await authedPage(page, token)

    // 1. 创卡 + 导航到 board
    const cardTitle = `to-delete-${Date.now()}`
    await createCard(request, token, reqId, cardTitle)
    await page.goto(`${WEB_URL}/requirements/${encodeURIComponent(reqId)}/board/`)
    await expect(page.getByTestId('board-section')).toBeVisible({
      timeout: 30_000,
    })

    const card = page.getByTestId('board-card').filter({ hasText: cardTitle })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // 2. 菜单 → 「删除任务」→ ConfirmDialog 出现
    await openMenuOnCard(page, cardTitle)
    await page.getByTestId('board-card-menu-delete').click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeVisible()

    // 3. ConfirmDialog 输入 DELETE → 确认按钮 enabled
    const confirmBtn = page.getByTestId('confirm-delete-dialog-confirm')
    await expect(confirmBtn).toBeDisabled()
    await page
      .getByTestId('confirm-delete-dialog-input')
      .fill('DELETE')
    await expect(confirmBtn).toBeEnabled()

    // 4. 提交 → dialog 关闭 + Toast「已删除 …」+ 卡片 DOM 消失
    await confirmBtn.click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeHidden({
      timeout: 10_000,
    })
    await expect(page.getByTestId('toast-host')).toContainText('已删除', {
      timeout: 5_000,
    })
    await expect(card).toBeHidden({ timeout: 10_000 })
  })

  test('(b) Cancel 流:菜单 → 打开 ConfirmDialog → 取消 → 卡片仍在', async ({
    page,
    request,
  }) => {
    const token = await bootstrapToken(request)
    const reqId = await createRequirement(
      request,
      token,
      `board-delete-b-${Date.now()}`,
    )
    await authedPage(page, token)

    const cardTitle = `to-keep-${Date.now()}`
    await createCard(request, token, reqId, cardTitle)
    await page.goto(`${WEB_URL}/requirements/${encodeURIComponent(reqId)}/board/`)
    await expect(page.getByTestId('board-section')).toBeVisible({
      timeout: 30_000,
    })

    const card = page.getByTestId('board-card').filter({ hasText: cardTitle })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // 1. 菜单 → 「删除任务」→ ConfirmDialog 出现
    await openMenuOnCard(page, cardTitle)
    await page.getByTestId('board-card-menu-delete').click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeVisible()

    // 2. 确认按钮 disabled(空输入)
    await expect(page.getByTestId('confirm-delete-dialog-confirm')).toBeDisabled()

    // 3. 点取消 → dialog 关闭 + 卡片仍在
    await page.getByTestId('confirm-delete-dialog-cancel').click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeHidden()
    await expect(card).toBeVisible()
  })

  test('(c) 子任务 blocker:子卡的 parent_id = target → 删除 target → BlockerModal', async ({
    page,
    request,
  }) => {
    const token = await bootstrapToken(request)
    const reqId = await createRequirement(
      request,
      token,
      `board-delete-c-${Date.now()}`,
    )
    await authedPage(page, token)

    // 1. 创 parent + child + 把 child.parent_id PATCH 成 parent.id
    const parentTitle = `parent-${Date.now()}`
    const childTitle = `child-${Date.now()}`
    const parentId = await createCard(request, token, reqId, parentTitle)
    const childId = await createCard(request, token, reqId, childTitle)
    await patchCard(request, token, reqId, childId, { parent_id: parentId })

    // 2. 导航 board
    await page.goto(`${WEB_URL}/requirements/${encodeURIComponent(reqId)}/board/`)
    await expect(page.getByTestId('board-section')).toBeVisible({
      timeout: 30_000,
    })

    // 3. 菜单 → 「删除任务」→ ConfirmDialog 输入 DELETE → 提交
    await openMenuOnCard(page, parentTitle)
    await page.getByTestId('board-card-menu-delete').click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeVisible()
    await page
      .getByTestId('confirm-delete-dialog-input')
      .fill('DELETE')
    await page.getByTestId('confirm-delete-dialog-confirm').click()

    // 4. ConfirmDialog 关闭 + BlockerModal 出现,显示 1 个子任务 blocker
    await expect(page.getByTestId('confirm-delete-dialog')).toBeHidden({
      timeout: 5_000,
    })
    await expect(page.getByTestId('blocker-modal')).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId('blocker-modal-subtasks')).toBeVisible()
    await expect(page.getByTestId('blocker-modal-subtask-item')).toHaveCount(1)
    await expect(
      page.getByTestId('blocker-modal-subtask-item').first(),
    ).toContainText(childTitle)

    // 5. parent 卡仍在(board 没被删)
    const parentCard = page.getByTestId('board-card').filter({
      hasText: parentTitle,
    })
    await expect(parentCard).toBeVisible()
  })

  test('(d) 依赖方 blocker:card B depends_on 上 target → 删 target → BlockerModal', async ({
    page,
    request,
  }) => {
    const token = await bootstrapToken(request)
    const reqId = await createRequirement(
      request,
      token,
      `board-delete-d-${Date.now()}`,
    )
    await authedPage(page, token)

    // 1. 创 target + dependent → PATCH dependent.depends_on = [target.id]
    const targetTitle = `target-${Date.now()}`
    const dependentTitle = `dependent-${Date.now()}`
    const targetId = await createCard(request, token, reqId, targetTitle)
    const dependentId = await createCard(request, token, reqId, dependentTitle)
    await patchCard(request, token, reqId, dependentId, {
      depends_on: [targetId],
    })

    // 2. 导航 board
    await page.goto(`${WEB_URL}/requirements/${encodeURIComponent(reqId)}/board/`)
    await expect(page.getByTestId('board-section')).toBeVisible({
      timeout: 30_000,
    })

    // 3. 菜单 → 「删除任务」→ ConfirmDialog 输入 DELETE → 提交
    await openMenuOnCard(page, targetTitle)
    await page.getByTestId('board-card-menu-delete').click()
    await expect(page.getByTestId('confirm-delete-dialog')).toBeVisible()
    await page
      .getByTestId('confirm-delete-dialog-input')
      .fill('DELETE')
    await page.getByTestId('confirm-delete-dialog-confirm').click()

    // 4. ConfirmDialog 关闭 + BlockerModal 出现,显示 1 个依赖方 blocker
    await expect(page.getByTestId('confirm-delete-dialog')).toBeHidden({
      timeout: 5_000,
    })
    await expect(page.getByTestId('blocker-modal')).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.getByTestId('blocker-modal-dependents')).toBeVisible()
    await expect(page.getByTestId('blocker-modal-dependent-item')).toHaveCount(1)
    await expect(
      page.getByTestId('blocker-modal-dependent-item').first(),
    ).toContainText(dependentTitle)

    // 5. target 卡仍在
    const targetCard = page.getByTestId('board-card').filter({
      hasText: targetTitle,
    })
    await expect(targetCard).toBeVisible()
  })
})
