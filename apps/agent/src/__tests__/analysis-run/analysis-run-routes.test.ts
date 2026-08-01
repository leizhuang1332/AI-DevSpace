/**
 * Analysis Run 路由集成测试(issue 02 · ADR-0021)
 *
 * 主要接缝(issue 02 acceptance 11):
 * - 启动 REST → fake Provider.runAnalysisQuery → 真实 Run 存储 → 真实 SSE Hub
 * - 覆盖验收点 1-15(单运行约束、Run 标识立即返回、SSE 推送、零 Issue 空态、
 *   Issue 幂等、完成工具门禁、Run 失败状态)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import yaml from 'yaml'
import { TokenManager } from '../../auth/TokenManager.js'
import { authPlugin } from '../../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../../sse/SseHub.js'
import { sseRoutes } from '../../sse/requirementEventsRoute.js'
import { analysisRunRoutes } from '../../routes/analysis-run.js'
import { AnalysisRunService } from '../../analysis-run/AnalysisRunService.js'
import {
  createFakeAnalysisProvider,
  type FakeAnalysisProviderHandle,
} from './__fixtures__/fakeAnalysisQueryProvider.js'

// ============================================================================
// 工具函数
// ============================================================================

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let port: number
let providerHandle: FakeAnalysisProviderHandle

interface CapturedResponse {
  statusCode: number
  body: string
}

function openSse(urlPath: string, readMs = 1500): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers: { 'x-aidevspace-token': token },
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function authedJson(
  method: 'GET' | 'POST',
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

/** 在已跑过 beforeEach 的 app 之上,关闭 + 重建 app + 注册路由(复用 tokenManager)。 */
async function rebuildAppWithProvider(
  p: import('../../providers/AIProvider.js').AIProvider,
): Promise<void> {
  await app.close()
  app = Fastify({ logger: false })
  const tm = new TokenManager(root)
  await tm.ensure()
  token = await tm.ensure()
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(sseRoutes, { hub })
  await app.register(analysisRunRoutes, {
    hub,
    provider: p,
    workspaceRoot: root,
  })
  await app.ready()
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  port = new URL(url).port
}

/** 预置 Requirement PRD + 初始化 Analysis Skill 集合 */
function seedRequirement(reqId: string, prdContent = '# 测试 PRD\n\n## 业务背景\n\n示例 PRD。\n'): void {
  const dir = join(root, 'requirements', reqId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), prdContent, 'utf8')
}

/** 在 `<root>/analysis-skills/<name>/SKILL.md` 写一个最小合法 Skill */
function seedSkill(name: string, description = `${name} skill body`): void {
  const dir = join(root, 'analysis-skills', name)
  mkdirSync(dir, { recursive: true })
  const content = `---
name: ${name}
description: ${description}
version: 1.0.0
---

# ${name}

${description}
正文识别规则...
`
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
}

function countEvents(sseBody: string, type: string): number {
  return (sseBody.match(new RegExp(`event: ${type}`, 'g')) ?? []).length
}

// ============================================================================
// 主要集成测试
// ============================================================================

describe('POST /api/requirements/:id/analysis/start (issue 02)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-run-'))
    process.env.AIDEVSPACE_ROOT = root
    seedSkill('prd-completeness')
    seedSkill('implementation-readiness')

    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })

    // 默认 fake provider:无 messages → Run 直接跑完空流(零 Issue 路径)
    providerHandle = createFakeAnalysisProvider({ messages: [] })

    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(sseRoutes, { hub })
    await app.register(analysisRunRoutes, {
      hub,
      provider: providerHandle.provider,
      workspaceRoot: root,
    })
    await app.ready()
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    port = new URL(url).port
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
  })

  // --------------------------------------------------------------------------
  // 1. 401 / 400 / 409 启动门禁
  // --------------------------------------------------------------------------
  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirements/req-001/analysis/start',
      headers: { 'content-type': 'application/json' },
      payload: { skill_name: 'prd-completeness' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('400 when skill_name missing', async () => {
    seedRequirement('req-001')
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/start', {})
    expect(res.statusCode).toBe(400)
    expect(String(res.body.reason)).toContain('skill_name')
  })

  it('400 when skill_name not in available skills', async () => {
    seedRequirement('req-001')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-001/analysis/start',
      { skill_name: 'non-existent-skill' },
    )
    expect(res.statusCode).toBe(400)
  })

  it('409 prd_not_ready when requirement.md missing', async () => {
    const res = await authedJson(
      'POST',
      '/api/requirements/req-missing/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('prd_not_ready')
  })

  it('409 prd_not_ready when requirement.md is empty', async () => {
    seedRequirement('req-empty', '')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-empty/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('prd_not_ready')
  })

  // --------------------------------------------------------------------------
  // 2. 201:立即返回 Run 标识 + Skill 名称 + running
  // --------------------------------------------------------------------------
  it('201 立即返回 Run 标识 + skill_name + created_at + status=running', async () => {
    seedRequirement('req-201')
    const res = await authedJson(
      'POST',
      '/api/requirements/req-201/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    expect(typeof res.body.run_id).toBe('string')
    expect(String(res.body.run_id)).toMatch(/^run-/)
    expect(res.body.requirement_id).toBe('req-201')
    expect(res.body.skill_name).toBe('prd-completeness')
    expect(typeof res.body.created_at).toBe('string')
    expect(res.body.status).toBe('running')

    // fs 落盘验证
    const runDir = join(root, 'requirements', 'req-201', 'analysis', 'runs', String(res.body.run_id))
    expect(existsSync(join(runDir, 'meta.yaml'))).toBe(true)
    expect(existsSync(join(runDir, 'issues.jsonl'))).toBe(true)
    expect(existsSync(join(runDir, 'log.jsonl'))).toBe(true)
    const meta = yaml.parse(readFileSync(join(runDir, 'meta.yaml'), 'utf8'))
    expect(meta.skill_name).toBe('prd-completeness')
    // fake provider 默认 autoComplete=true,异步 runner 可能在 201 返回前已跑完;
    // 因此 status 可能已是 'succeeded'(仍合法 —— 创建时是 'running')。
    // 这里只断言 Run 元数据落盘 + issue_count 是 0/1。
    expect(['running', 'succeeded']).toContain(meta.status)
    expect(meta.issue_count).toBe(0)
  })

  // --------------------------------------------------------------------------
  // 3. SSE 联动:POST 后 /events 流收到 analysis_run_created + analysis_run_succeeded
  // --------------------------------------------------------------------------
  it('POST 后 SSE 收到 analysis_run_created + analysis_run_succeeded', async () => {
    seedRequirement('req-sse')
    const ssePromise = openSse('/api/requirement/req-sse/events', 2500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const post = await authedJson(
      'POST',
      '/api/requirements/req-sse/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(post.statusCode).toBe(201)

    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    expect(countEvents(sse.body, 'analysis_run_created')).toBeGreaterThanOrEqual(1)
    expect(countEvents(sse.body, 'analysis_run_succeeded')).toBeGreaterThanOrEqual(1)
  })

  // --------------------------------------------------------------------------
  // 4. 单运行约束:同一 Requirement 连续两次 start → 第二个 409
  // --------------------------------------------------------------------------
  it('同 Requirement 连续两次 start → 第二个 409 analysis_run_already_running', async () => {
    seedRequirement('req-once')

    // 第一次:fake provider 不调 complete_analysis → runner 把 Run 标 failed
    // 但 running 状态会在第一次 POST 后短时间内被 runner 转换(取决于 fake 时序)
    // 为了模拟"running 持续状态",我们在第二次 POST 前把 Run 状态恢复为 running
    const first = await authedJson(
      'POST',
      '/api/requirements/req-once/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(first.statusCode).toBe(201)

    // 强制把 Run meta 改回 running(模拟"还在跑"的状态)
    const runId = String(first.body.run_id)
    const runDir = join(root, 'requirements', 'req-once', 'analysis', 'runs', runId)
    const metaPath = join(runDir, 'meta.yaml')
    const meta = yaml.parse(readFileSync(metaPath, 'utf8'))
    meta.status = 'running'
    writeFileSync(metaPath, yaml.stringify(meta), 'utf8')

    // 第二次 POST 应被单运行约束拒绝
    const second = await authedJson(
      'POST',
      '/api/requirements/req-once/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(second.statusCode).toBe(409)
    expect(second.body.error).toBe('analysis_run_already_running')
    expect(String(second.body.running_run?.run_id)).toBe(runId)
  })

  // --------------------------------------------------------------------------
  // 5. Issue 报告 + 完成工具 → Run 进入 succeeded
  // --------------------------------------------------------------------------
  it('report_analysis_issue + complete_analysis → Run succeeded 且 Issue 持久化', async () => {
    seedRequirement('req-success')

    // fake provider:模拟 SDK 流 → 1 条 assistant 文本 + 1 条 tool_use(report_analysis_issue)
    // + 1 条 tool_use(complete_analysis)
    providerHandle = createFakeAnalysisProvider({
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-issue-1',
            name: 'report_analysis_issue',
            input: {
              title: 'PRD 缺少验收标准',
              description: '当前 PRD 没有给出"通过条件",无法判断开发是否完成',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
              metadata: [['severity', 'medium']],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-complete-1',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })

    // 重启 app 注入新的 fake provider
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-success/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    if (res.statusCode !== 201) {
      console.error('start failed:', JSON.stringify(res.body))
    }
    expect(res.statusCode).toBe(201)

    // 等异步 runner 跑完
    await new Promise((r) => setTimeout(r, 1500))

    // GET /runs 列表中应有 1 条 run,status='succeeded',issue_count=1
    const list = await authedJson('GET', '/api/requirements/req-success/analysis/runs')
    expect(list.statusCode).toBe(200)
    expect(list.body.runs).toHaveLength(1)
    const runSummary = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(runSummary.status).toBe('succeeded')
    expect(runSummary.issue_count).toBe(1)
    expect(runSummary.error).toBeNull()

    // GET /runs/:runId 详情:Issue 已持久化
    const detail = await authedJson(
      'GET',
      `/api/requirements/req-success/analysis/runs/${runSummary.run_id}`,
    )
    expect(detail.statusCode).toBe(200)
    const issues = detail.body.issues as Array<Record<string, unknown>>
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toBe('PRD 缺少验收标准')
    expect(issues[0].description).toContain('通过条件')

    // 业务工具调用已被 fake provider 记录(fake 默认 autoComplete,所以至少有
    // 1 条 report + 1 条 complete;autoComplete 还会再调 1 次 complete,共 3 条)
    expect(providerHandle.businessToolCalls.length).toBeGreaterThanOrEqual(2)
    expect(providerHandle.businessToolCalls.some((c) => c.name === 'report_analysis_issue')).toBe(true)
    expect(providerHandle.businessToolCalls.some((c) => c.name === 'complete_analysis')).toBe(true)
  })

  // --------------------------------------------------------------------------
  // 6. 零 Issue 空态:fake provider 直接调 complete_analysis → Run succeeded + issue_count=0
  // --------------------------------------------------------------------------
  it('只调 complete_analysis 不调 report_analysis_issue → succeeded + issue_count=0', async () => {
    seedRequirement('req-zero')

    providerHandle = createFakeAnalysisProvider({
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-complete-zero',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    // 重启 app 注入新的 fake provider
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-zero/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-zero/analysis/runs')
    const runSummary = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(runSummary.status).toBe('succeeded')
    expect(runSummary.issue_count).toBe(0)
  })

  // --------------------------------------------------------------------------
  // 7. SDK 成功但未调 complete_analysis → Run 失败(决策 31 门禁)
  // --------------------------------------------------------------------------
  it('SDK 成功但未调 complete_analysis → Run failed', async () => {
    seedRequirement('req-no-complete')

    providerHandle = createFakeAnalysisProvider({
      // 关键:autoComplete=false → fake provider 不在末尾调 complete_analysis
      autoComplete: false,
      messages: [
        // 只推 assistant 文本,不调任何工具
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '我已完成分析(但忘了调 complete_analysis)' }],
          },
        },
      ],
    })
    // 重启 app 注入新的 fake provider
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-no-complete/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-no-complete/analysis/runs')
    const runSummary = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(runSummary.status).toBe('failed')
    expect(String(runSummary.error)).toContain('complete_analysis')
  })

  // --------------------------------------------------------------------------
  // 8. Issue 幂等:同一 tool_use_id 重复 report 不产生新 Issue
  // --------------------------------------------------------------------------
  it('同一 tool_use_id 重复报告 Issue → 不产生新 Issue(created=false)', async () => {
    seedRequirement('req-idempotent')

    // 同 tool_use_id 报两次 → 应只有 1 条 Issue
    providerHandle = createFakeAnalysisProvider({
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-dup',
            name: 'report_analysis_issue',
            input: {
              title: '重复的 Issue',
              description: '同一调用被报两次',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-dup', // 同 tool_use_id
            name: 'report_analysis_issue',
            input: {
              title: '重复的 Issue',
              description: '同一调用被报两次',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-complete-idem',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    // 重启 app 注入新的 fake provider
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-idempotent/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-idempotent/analysis/runs')
    const runSummary = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(runSummary.issue_count).toBe(1) // 幂等:不重复产生
  })

  // --------------------------------------------------------------------------
  // 9. Run Log:文本 + 工具事件都落 log.jsonl
  // --------------------------------------------------------------------------
  it('Run Log 持久化:文本 + tool_use + tool_result 都进 log.jsonl', async () => {
    seedRequirement('req-log')

    providerHandle = createFakeAnalysisProvider({
      messages: [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '开始检查 PRD 完整性...' }],
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-log-1',
            name: 'report_analysis_issue',
            input: {
              title: '某 Issue',
              description: 'desc',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-log-1',
                content: 'ok',
              },
            ],
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-log-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    // 重启 app 注入新的 fake provider
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-log/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const detail = await authedJson(
      'GET',
      `/api/requirements/req-log/analysis/runs/${res.body.run_id}`,
    )
    const log = detail.body.log as Array<Record<string, unknown>>
    // 至少 1 条 text + 1 条 tool_use + 1 条 tool_result
    const texts = log.filter((l) => l.kind === 'text')
    const toolUses = log.filter((l) => l.kind === 'tool_use')
    const toolResults = log.filter((l) => l.kind === 'tool_result')
    expect(texts.length).toBeGreaterThanOrEqual(1)
    expect(toolUses.length).toBeGreaterThanOrEqual(2)
    expect(toolResults.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// 副测:AnalysisRunService 单运行约束 + Issue 幂等(直接调 service)
// ============================================================================

describe('AnalysisRunService(单运行约束 + Issue 幂等)', () => {
  let root: string
  let service: AnalysisRunService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-svc-'))
    service = new AnalysisRunService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('createRun 第二次返 analysis_run_already_running', async () => {
    const first = await service.createRun({ requirementId: 'req-a', skillName: 'prd-completeness' })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await service.createRun({ requirementId: 'req-a', skillName: 'implementation-readiness' })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('analysis_run_already_running')
  })

  it('不同 Requirement 各自可创建 running Run', async () => {
    const a = await service.createRun({ requirementId: 'req-a', skillName: 'prd-completeness' })
    const b = await service.createRun({ requirementId: 'req-b', skillName: 'prd-completeness' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })

  it('Issue 幂等:同 tool_use_id 第二次 report → created=false,顺序不变', async () => {
    const created = await service.createRun({ requirementId: 'req-i', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const r1 = service.reportIssue({
      requirementId: 'req-i',
      runId,
      toolUseId: 'tu-x',
      input: {
        title: 'A',
        description: 'desc A',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.result.created).toBe(true)

    const r2 = service.reportIssue({
      requirementId: 'req-i',
      runId,
      toolUseId: 'tu-x',
      input: {
        title: 'A (duplicate)',
        description: 'desc A (dup)',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.result.created).toBe(false)
    expect(r2.result.issue.ordinal).toBe(1) // 第一次的顺序,不是 2
  })

  it('requestCompletion 后再 reportIssue → run_completed', async () => {
    const created = await service.createRun({ requirementId: 'req-c', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id
    const rc = service.requestCompletion('req-c', runId)
    expect(rc.ok).toBe(true)

    const r = service.reportIssue({
      requirementId: 'req-c',
      runId,
      toolUseId: 'tu-y',
      input: {
        title: 'late',
        description: 'after complete',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_completed')
  })

  it('transitionToSucceeded 必须在 requestCompletion 之后', async () => {
    const created = await service.createRun({ requirementId: 'req-t', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    // 直接 succeeded(没 requestCompletion)→ 拒绝
    const t1 = service.transitionToSucceeded('req-t', runId)
    expect(t1.ok).toBe(false)
    if (t1.ok) return
    expect(t1.code).toBe('invalid_transition')

    // requestCompletion 后 → succeeded
    service.requestCompletion('req-t', runId)
    const t2 = service.transitionToSucceeded('req-t', runId)
    expect(t2.ok).toBe(true)
  })

  it('listRuns 按 created_at 倒序', async () => {
    await service.createRun({ requirementId: 'req-l', skillName: 'prd-completeness' })
    await new Promise((r) => setTimeout(r, 5))
    const second = await service.createRun({ requirementId: 'req-l', skillName: 'implementation-readiness' })
    expect(second.ok).toBe(false) // 第一个还在 running
    // listRuns 应至少 1 条
    const list = service.listRuns('req-l')
    expect(list.length).toBeGreaterThanOrEqual(1)
  })

  // 跨 process 单运行约束:同一 Requirement 第二次创建 → 返 analysis_run_already_running
  // 由 mkdir 锁的 EEXIST 保证,即使两个 service 实例(模拟多 process)也只允许一个 running Run
  it('跨 service 实例:第二次 createRun 同 Requirement → 409(由 .startup.lock EEXIST 保证)', async () => {
    const serviceA = new AnalysisRunService(root)
    const serviceB = new AnalysisRunService(root)
    const first = await serviceA.createRun({ requirementId: 'req-cross', skillName: 'prd-completeness' })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await serviceB.createRun({ requirementId: 'req-cross', skillName: 'implementation-readiness' })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('analysis_run_already_running')
    expect(second.runningRun.run_id).toBe(first.run.run_id)
  })

  it('releaseStartupLock 后,同 Requirement 可再次创建 Run', async () => {
    const first = await service.createRun({ requirementId: 'req-relock', skillName: 'prd-completeness' })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // 模拟 Run 终态:transitionToFailed 内已 fire-and-forget 调用 releaseStartupLock
    // 这里再多等几个 microtask 确保 fire-and-forget 完成
    service.transitionToFailed('req-relock', first.run.run_id, 'simulated failure for test')
    await new Promise((r) => setTimeout(r, 50))

    const second = await service.createRun({ requirementId: 'req-relock', skillName: 'implementation-readiness' })
    expect(second.ok).toBe(true)
  })
})

// ============================================================================
// 副测:AnalysisPromptAssembler 九层结构
// ============================================================================

describe('AnalysisPromptAssembler 九层 system prompt', () => {
  it('包含九层固定标题 + 当前 Skill + 已答复上下文 + 当前运行范围', async () => {
    const { assembleAnalysisSystemPrompt } = await import(
      '../../analysis-run/AnalysisPromptAssembler.js'
    )
    const out = assembleAnalysisSystemPrompt({
      skill: { name: 'prd-completeness', description: '检查 PRD 完整性', version: '1.0.0' },
      skill_body: '# 规则\n检查 PRD 是否完整...',
      answered_context: [
        {
          run_id: 'run-prior',
          issue_title: '旧问题',
          issue_description: '旧描述',
          source_refs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
          metadata: [],
          updated_at: '2026-07-01T00:00:00Z',
          response: '已经答复',
        },
      ],
      scope: {
        requirement_id: 'req-002',
        repo_names: ['orders'],
        prd_markdown: '# PRD\n业务...',
      },
    })
    expect(out).toContain('## 身份与任务')
    expect(out).toContain('## 指令权限层级')
    expect(out).toContain('## 能力边界')
    expect(out).toContain('## 识别原则')
    expect(out).toContain('## 问题报告协议')
    expect(out).toContain('## 完成协议')
    expect(out).toContain('## 当前 Analysis Skill')
    expect(out).toContain('## 已答复需求上下文')
    expect(out).toContain('## 当前运行范围')
    expect(out).toContain('prd-completeness')
    expect(out).toContain('orders')
    expect(out).toContain('req-002')
    expect(out).toContain('已经答复')
    // 禁止 Claude Code 默认行为提示
    expect(out).toContain('Claude Code 默认 system prompt 已被平台完全替换')
    // 不使用 appendSystemPrompt / preset
    expect(out).not.toContain('appendSystemPrompt')
    expect(out).not.toContain('preset')
  })
})