/**
 * Issue Response 端到端集成测试(issue 04 验收 15 · Testing Decisions 5)
 *
 * 接缝:REST 写入 Response → 启动下一 Run → fake Provider 捕获 SDK query
 * → 断言第 8 层 system prompt 含已答复 Issue + Response 原文,不含未答复 / Run Log。
 *
 * 不依赖真实 SDK;复用 analysis-run-routes.test.ts 的 fakeAnalysisQueryProvider
 * 形态:在 Provider.runAnalysisQuery 内部断言 systemPrompt 字符串内容。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../../auth/TokenManager.js'
import { authPlugin } from '../../auth/authPlugin.js'
import { sseRoutes } from '../../sse/requirementEventsRoute.js'
import { analysisRunRoutes } from '../../routes/analysis-run.js'
import { analysisResponseRoutes } from '../../routes/analysis-response.js'
import { AnalysisRunService } from '../../analysis-run/AnalysisRunService.js'
import { createSseHub, type SseHub } from '../../sse/SseHub.js'
import type { AIProvider } from '../../providers/AIProvider.js'

let app: FastifyInstance
let token: string
let root: string
let hub: SseHub
let capturedSystemPrompt: string | null = null

async function authedJson(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-aidevspace-token': token,
      'content-type': 'application/json',
    },
    payload: body,
  })
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
}

function seedPrd(reqId: string): void {
  const dir = join(root, 'requirements', reqId)
  mkdirSync(dir, { recursive: true })
  // PR-5 (ticket 10):默认 PRD ≥ 50 字符,避免新契约 empty_prd 误伤测试
  writeFileSync(
    join(dir, 'requirement.md'),
    '# E2E PRD\n\n## 业务背景\n\n本需求用于端到端测试 Analysis Run + Issue Response 闭环,描述核心问题与目标用户。\n',
    'utf8',
  )
}

function seedSkill(name: string): void {
  const dir = join(root, 'analysis-skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\nversion: 1.0.0\n---\n\n# ${name}\n\n规则正文\n`,
    'utf8',
  )
}

/**
 * Fake Provider:记录最近一次 query 的 systemPrompt 字符串。
 * 触发一次完整成功的 Run(complete_analysis),让 route 进入 succeeded 终态。
 */
function makeCapturingProvider(): AIProvider {
  return {
    name: 'fake-capture',
    async createSession() {
      throw new Error('not used')
    },
    async shutdown() {},
    async runAnalysisQuery(input) {
      capturedSystemPrompt = input.systemPrompt
      // 直接触发 complete → 让 runner 走成功门禁
      const handler = input.businessTools['complete_analysis']
      await handler?.('tu-complete', {})
      return { ok: true }
    },
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
  process.env.AIDEVSPACE_ROOT = root
  seedSkill('prd-completeness')

  const tm = new TokenManager(root)
  token = await tm.ensure()
  hub = createSseHub({ heartbeatMs: 60_000 })
  const runService = new AnalysisRunService(root)

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(sseRoutes, { hub })
  await app.register(analysisResponseRoutes, { workspaceRoot: root, runService })
  await app.register(analysisRunRoutes, {
    hub,
    provider: makeCapturingProvider(),
    workspaceRoot: root,
  })
  await app.ready()
  capturedSystemPrompt = null
})

afterEach(async () => {
  await app.close()
  await hub.close()
  rmSync(root, { recursive: true, force: true })
  delete process.env.AIDEVSPACE_ROOT
})

describe('Run-A 写 Response → Run-B 启动:贯通端到端', () => {
  it('启动第二个 Run 后,新 prompt 第 8 层含已答复 Issue + Response 原文', async () => {
    seedPrd('req-e2e')

    // 1. 第一个 Run(走 service 直接创建 + 报 issue + 写 Response,绕 REST 减少噪音)
    const runService = new AnalysisRunService(root)
    const created = await runService.createRun({
      requirementId: 'req-e2e',
      skillName: 'prd-completeness',
    })
    if (!created.ok) throw new Error('createRun failed')
    const runIdA = created.run.run_id
    runService.requestCompletion('req-e2e', runIdA)
    runService.transitionToSucceeded('req-e2e', runIdA)
    await new Promise((r) => setTimeout(r, 20)) // 等 startup lock 释放
    const issueA = runService.reportIssue({
      requirementId: 'req-e2e',
      runId: runIdA,
      toolUseId: 'tu-A',
      input: {
        title: '历史 Issue 标题',
        description: '历史 Issue 描述内容',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    if (!issueA.ok) throw new Error('reportIssue failed')
    const wrote = runService.writeResponse(
      'req-e2e',
      runIdA,
      issueA.result.issue.issue_id,
      '用户答复:这里有完整的背景说明',
      0,
    )
    expect(wrote.ok).toBe(true)

    // 2. 第二个 Issue 不答复(应不进 prompt)
    // 用唯一字符串(避免与 Layer 8 优先级规则解释中"未答复 Issue 不出现"
    // 这类 policy 文案撞车)
    const UNIQUE_UNANSWERED = 'zXyzUnansweredMarker-7e3a'
    const issueB = runService.reportIssue({
      requirementId: 'req-e2e',
      runId: runIdA,
      toolUseId: 'tu-B',
      input: {
        title: '这是一条从未被答复的 Issue',
        description: `${UNIQUE_UNANSWERED}:描述中带独有 marker 用于断言`,
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    if (!issueB.ok) throw new Error('reportIssue B failed')

    // 3. 启动第二 Run(走 REST 入口)→ 应把已答复 context 注入 systemPrompt
    const start = await authedJson(
      'POST',
      '/api/requirements/req-e2e/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(201)

    // 等 SDK query 完成(capturedSystemPrompt 在 runAnalysisQuery 同步设置)
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedSystemPrompt).not.toBeNull()
    const prompt = capturedSystemPrompt!
    // 第 8 层 — 决策 11/14:原文 + 排序 + 优先级
    expect(prompt).toContain('## 已答复需求上下文')
    expect(prompt).toContain('历史 Issue 标题')
    expect(prompt).toContain('用户答复:这里有完整的背景说明')
    expect(prompt).toContain(runIdA)
    // 决策 14:同层稳定排序提示
    expect(prompt).toMatch(/按最后更新时间从旧到新/)
    // 决策 51:默认不重报
    expect(prompt).toMatch(/已被答复充分解决的问题/)
    // 未答复 Issue 不进入(issue 04 验收 11)
    expect(prompt).not.toContain(UNIQUE_UNANSWERED)
  })

  it('context_overflow → 启动被显式拒绝,不创建 Run', async () => {
    seedPrd('req-over')

    const runService = new AnalysisRunService(root)
    const created = await runService.createRun({
      requirementId: 'req-over',
      skillName: 'prd-completeness',
    })
    if (!created.ok) throw new Error('c1')
    const runId = created.run.run_id
    runService.requestCompletion('req-over', runId)
    runService.transitionToSucceeded('req-over', runId)
    await new Promise((r) => setTimeout(r, 20))

    const issue = runService.reportIssue({
      requirementId: 'req-over',
      runId,
      toolUseId: 'tu',
      input: {
        title: 't',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    if (!issue.ok) throw new Error('issue')
    // 写一个超大答复触发 overflow
    runService.writeResponse(
      'req-over',
      runId,
      issue.result.issue.issue_id,
      'x'.repeat(200_000),
      0,
    )

    const start = await authedJson(
      'POST',
      '/api/requirements/req-over/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(409)
    expect(start.body.error).toBe('context_overflow')
    expect(typeof start.body.total_chars).toBe('number')
    // 决策 15:超预算 → 阻止创建 Run;验证 overflow 时不会启动 SDK query
    // (即 capturedSystemPrompt 不会被第二轮 Run 设置)
    capturedSystemPrompt = null
    await new Promise((r) => setTimeout(r, 100))
    expect(capturedSystemPrompt).toBeNull()
  })
})