/**
 * E2E: workspace root 可编辑 + restart banner (ADR-0037 / issue 07)
 *
 * 验收(issue 07 spec 4 case):
 *  1. happy path:settings workspace section → 编辑 dataRoot → 三档校验绿 → 保存 → banner 出现
 *  2. 路径不存在:E_WS_ROOT_PATH_NOT_EXISTS → 红边 + 文案 + 保存按钮禁用
 *  3. 路径无 workspace 痕迹:E_WS_ROOT_PATH_NOT_WORKSPACE → 黄边 + 文案 + 保存按钮禁用
 *  4. restart banner:收到 agent-restarting SSE → 顶部出现「🔄 Agent 正在重启…」toast
 *
 * Skip 行为(沿用 board.spec.ts · ADR-0020 D11):
 *  - web(3333)/agent(7777)不可达 → test.skip(),不 fail
 *  - 本 spec 不需要 ANTHROPIC_API_KEY(不发 Run)
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3333'
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:7777'
const SKIP_REASON_NO_WEB = `Web server not reachable at ${WEB_URL}; e2e SKIPPED (启动: pnpm dev)`
const SKIP_REASON_NO_AGENT = `Agent server not reachable at ${AGENT_URL}; e2e SKIPPED (启动: pnpm agent:start)`

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

test.beforeAll(async () => {
  if (!(await isWebReachable())) {
    test.skip(true, SKIP_REASON_NO_WEB)
  }
})

async function gotoSettings(page: Page): Promise<void> {
  await page.goto(`${WEB_URL}/settings`)
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('section-workspace').waitFor({ timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// case 1: happy path
// ---------------------------------------------------------------------------

test('case 1: 编辑 dataRoot → 三档绿 → 保存 → banner 出现', async ({
  page,
  request,
}) => {
  if (!(await isAgentHealthy(request))) test.skip(true, SKIP_REASON_NO_AGENT)

  // 准备一个合法 workspace 子目录(含 requirements/)
  const validDir = mkdtempSync(join(tmpdir(), 'aidev-e2e-valid-'))
  mkdirSync(join(validDir, 'requirements'), { recursive: true })
  test.afterAll(() => rmSync(validDir, { recursive: true, force: true }))

  await gotoSettings(page)

  await page.getByTestId('edit-workspace-root').click()
  const input = page.getByTestId('workspace-root')
  await input.fill(validDir)

  // 等 validate 异步校验通过(300ms debounce + 网络往返)
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(
        '[data-testid="save-workspace-root"]',
      ) as HTMLButtonElement | null
      return btn !== null && !btn.disabled
    },
    undefined,
    { timeout: 5_000 },
  )

  await page.getByTestId('save-workspace-root').click()
  await expect(page.getByTestId('saved-banner')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('restart-agent-btn')).toBeVisible()
})

// ---------------------------------------------------------------------------
// case 2: E_WS_ROOT_PATH_NOT_EXISTS
// ---------------------------------------------------------------------------

test('case 2: 输入不存在路径 → 红边 + 文案 + 保存禁用', async ({ page, request }) => {
  if (!(await isAgentHealthy(request))) test.skip(true, SKIP_REASON_NO_AGENT)

  await gotoSettings(page)

  await page.getByTestId('edit-workspace-root').click()
  await page.getByTestId('workspace-root').fill('/no-such-aidevspace-path-zzz-9999')

  await expect(page.getByTestId('workspace-validation-message')).toContainText(
    /不存在/,
    { timeout: 5_000 },
  )

  const saveBtn = page.getByTestId('save-workspace-root')
  await expect(saveBtn).toBeDisabled()
})

// ---------------------------------------------------------------------------
// case 3: E_WS_ROOT_PATH_NOT_WORKSPACE
// ---------------------------------------------------------------------------

test('case 3: 输入无 workspace 痕迹的目录 → 黄边 + 文案 + 保存禁用', async ({
  page,
  request,
}) => {
  if (!(await isAgentHealthy(request))) test.skip(true, SKIP_REASON_NO_AGENT)

  // 空目录(无 requirements / knowledge / skills / analysis-skills)
  const emptyDir = mkdtempSync(join(tmpdir(), 'aidev-e2e-empty-'))
  test.afterAll(() => rmSync(emptyDir, { recursive: true, force: true }))

  await gotoSettings(page)

  await page.getByTestId('edit-workspace-root').click()
  await page.getByTestId('workspace-root').fill(emptyDir)

  await expect(page.getByTestId('workspace-validation-message')).toContainText(
    /workspace 痕迹/,
    { timeout: 5_000 },
  )

  const saveBtn = page.getByTestId('save-workspace-root')
  await expect(saveBtn).toBeDisabled()
})

// ---------------------------------------------------------------------------
// case 4: restart banner 收到 agent-restarting 后显示
// ---------------------------------------------------------------------------

test('case 4: 收到 agent-restarting SSE → 顶部 banner 显示', async ({
  page,
  request,
}) => {
  if (!(await isAgentHealthy(request))) test.skip(true, SKIP_REASON_NO_AGENT)

  await gotoSettings(page)

  // 触发 agent restart(走真实 SSE 广播路径)
  const tokenRes = await request.get(`${AGENT_URL}/api/agent/bootstrap`, {
    headers: { origin: WEB_URL },
  })
  if (!tokenRes.ok()) test.skip(true, SKIP_REASON_NO_AGENT)
  const { token } = (await tokenRes.json()) as { token: string }

  const restartRes = await request.post(`${AGENT_URL}/api/agent/restart`, {
    headers: {
      origin: WEB_URL,
      'x-aidevspace-token': token,
      'content-type': 'application/json',
    },
    data: { reason: 'workspaceRoot-changed' },
  })
  // restart 成功 202;agent 进程 200ms 内会真退,这里容忍 200 / 202 / 5xx
  expect([200, 202]).toContain(restartRes.status())

  // 重启前 SSE 已 publishAll,web banner 立刻可见 —— 但 agent 退出后
  // EventSource 也会断,导致后续 open/recovered 行为不可控。本测试只验证
  // **收到 restarting 后短暂可见**。
  await expect(page.getByTestId('agent-restart-banner')).toBeVisible({
    timeout: 3_000,
  })
  await expect(page.getByTestId('agent-restart-banner')).toHaveAttribute(
    'data-state',
    /restarting|recovered/,
  )
})