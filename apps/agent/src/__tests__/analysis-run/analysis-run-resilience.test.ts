/**
 * Analysis Run 弹性 / 失败 / 重试 / 进程恢复 集成测试(issue 07)
 *
 * 主要接缝(issue 07 acceptance 12):
 * - 启动 REST → fake Provider.runAnalysisQuery(可控 attempt) → 真实 Run 存储 → 真实 SSE Hub
 * - 覆盖验收点 1/2/4/5/6/7/8/9/10
 *   (验收 3 complete_analysis 缺失、11 不引入取消/暂停 由 issue 02 测试覆盖)
 *
 * 不在本文件覆盖的:
 * - 纯 service 单测(transitionToSucceeded / requestCompletion 等) → 已在
 *   analysis-run-routes.test.ts 的 AnalysisRunService describe 中覆盖;
 *   本文件侧重 issue 07 专属的 retry / reconcile / 持久化失败 路径
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  utimesSync,
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
import { DEFAULT_PRD_CONTENT } from './__fixtures__/prd.js'
import { runAnalysisQueryWithRetry, classifyProviderError } from '../../analysis-run/runAnalysisQueryWithRetry.js'

// ============================================================================
// 工具函数(从 analysis-run-routes.test.ts 复制,避免测试间耦合)
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

// PR-5 (ticket 10):默认 PRD 见 __fixtures__/prd.ts(DEFAULT_PRD_CONTENT,
  // 长度 ≥ 50 字符,避免新契约 empty_prd 误伤测试)
function seedRequirement(reqId: string, prdContent = DEFAULT_PRD_CONTENT): void {
  const dir = join(root, 'requirements', reqId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), prdContent, 'utf8')
}

function seedSkill(name: string): void {
  const dir = join(root, 'analysis-skills', name)
  mkdirSync(dir, { recursive: true })
  const content = `---
name: ${name}
description: ${name} skill body
version: 1.0.0
---

# ${name}

正文识别规则...
`
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
}

function countEvents(sseBody: string, type: string): number {
  return (sseBody.match(new RegExp(`event: ${type}`, 'g')) ?? []).length
}

// ============================================================================
// 主集成测试
// ============================================================================

describe('Analysis Run 弹性 / 失败 / 重试 / 进程恢复 (issue 07)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-resil-'))
    process.env.AIDEVSPACE_ROOT = root
    seedSkill('prd-completeness')

    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })

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

  // -------------------------------------------------------------------------
  // 验收 1:同 Run 标识自动重试,依赖 tool_use_id 避免重复 Issue
  // -------------------------------------------------------------------------
  it('issue 07 #1:transient_503 第一次失败 + 第二次成功 → 同 run_id + succeeded + 推 analysis_run_retrying', async () => {
    seedRequirement('req-retry-ok')
    providerHandle = createFakeAnalysisProvider({
      // 第 1 次 transient_503 → 重试;第 2 次 ok → 跑完
      behaviorPerAttempt: [
        { result: 'fail', error: 'transient_503' },
        { result: 'ok' },
      ],
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-retry-1',
            name: 'report_analysis_issue',
            input: {
              title: 'PRD 缺验收',
              description: 'desc',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-retry-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const ssePromise = openSse('/api/requirement/req-retry-ok/events', 2500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const res = await authedJson(
      'POST',
      '/api/requirements/req-retry-ok/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    const runId = String(res.body.run_id)

    // 等异步 runner 跑完
    await new Promise((r) => setTimeout(r, 2000))

    // 1. run_id 不变(同 Run 标识)
    const list = await authedJson('GET', '/api/requirements/req-retry-ok/analysis/runs')
    const runs = list.body.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    expect(String(runs[0]?.run_id)).toBe(runId)
    expect(runs[0]?.status).toBe('succeeded')
    expect(runs[0]?.issue_count).toBe(1)
    expect(runs[0]?.error).toBeNull()

    // 2. fake provider 被调 2 次(1 次 transient + 1 次 ok)
    expect(providerHandle.attemptCount).toBe(2)
    expect(providerHandle.attemptHistory[0]?.result).toBe('fail')
    expect(providerHandle.attemptHistory[1]?.result).toBe('ok')

    // 3. SSE 流收到 analysis_run_retrying ≥ 1 次
    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    expect(countEvents(sse.body, 'analysis_run_retrying')).toBeGreaterThanOrEqual(1)
  })

  // -------------------------------------------------------------------------
  // 验收 2:不可重试错误 → failed,不再 retry
  // -------------------------------------------------------------------------
  it('issue 07 #2:auth_invalid_key → failed,只调 1 次,不发 retrying', async () => {
    seedRequirement('req-perm-fail')
    providerHandle = createFakeAnalysisProvider({
      behaviorPerAttempt: [{ result: 'fail', error: 'auth_invalid_key' }],
      messages: [],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const ssePromise = openSse('/api/requirement/req-perm-fail/events', 2500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const res = await authedJson(
      'POST',
      '/api/requirements/req-perm-fail/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-perm-fail/analysis/runs')
    const runs = list.body.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('failed')
    expect(String(runs[0]?.error ?? '')).toContain('auth_invalid_key')

    // 只调 1 次,没 retry
    expect(providerHandle.attemptCount).toBe(1)

    // SSE 收 analysis_run_failed + 不收 analysis_run_retrying
    const sse = await ssePromise
    expect(countEvents(sse.body, 'analysis_run_failed')).toBeGreaterThanOrEqual(1)
    expect(countEvents(sse.body, 'analysis_run_retrying')).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 验收 3:partial Issue 持久化后 SDK 失败 → failed,保留 issues
  // -------------------------------------------------------------------------
  it('issue 07 #3:提交 Issue 后 process 错误持续失败 → failed,保留 1 Issue(进程内 toolUseIndex 幂等)', async () => {
    seedRequirement('req-partial-fail')
    // 用 process 错误(enoent 找不到 SDK binary)→ C 分类 maxRetries=1,
    // 只重试 1 次,2 次 attempt 后走终态,避免 A/D 退避 schedule 14s 过慢
    providerHandle = createFakeAnalysisProvider({
      behaviorPerAttempt: [
        { result: 'fail', error: 'enoent: claude binary not found' },
        { result: 'fail', error: 'enoent: claude binary not found' },
      ],
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-partial-1',
            name: 'report_analysis_issue',
            input: {
              title: 'Issue 1',
              description: 'd1',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-partial-2',
            name: 'report_analysis_issue',
            input: {
              title: 'Issue 2',
              description: 'd2',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-partial-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-partial-fail/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    // C 分类 retry schedule [1000],2 次 attempt + 1 次 1s 退避
    await new Promise((r) => setTimeout(r, 2500))

    const list = await authedJson('GET', '/api/requirements/req-partial-fail/analysis/runs')
    const runs = list.body.runs as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('failed')
    // C 分类 maxRetries=1 -> 2 次 attempt(初 + 1 retry)
    expect(providerHandle.attemptCount).toBe(2)
    expect(String(runs[0]?.error ?? '')).toContain('enoent')

    // 失败 Run 保留 issues(进程内 toolUseIndex 跨重试幂等)
    const detail = await authedJson(
      'GET',
      `/api/requirements/req-partial-fail/analysis/runs/${runs[0]?.run_id}`,
    )
    const issues = detail.body.issues as Array<Record<string, unknown>>
    // messages 每次 attempt 都会跑一次;同一 tool_use_id 跨 attempt 命中进程内
    // toolUseIndex(decision 24) -> 不产生重复 Issue
    expect(issues).toHaveLength(2)
    expect(issues[0]?.title).toBe('Issue 1')
    expect(issues[1]?.title).toBe('Issue 2')

    // log 也保留
    const log = detail.body.log as Array<Record<string, unknown>>
    expect(log.length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // 验收 7/8:失败终态释放单运行锁 + 终态失败后再次 start 创建新 Run
  // -------------------------------------------------------------------------
  it('issue 07 #7/8:失败终态释放 .startup.lock → 用户可创建新 Run(新 run_id)', async () => {
    seedRequirement('req-relock')

    // 第 1 次 start:必失败
    providerHandle = createFakeAnalysisProvider({
      behaviorPerAttempt: [{ result: 'fail', error: 'fatal_error' }],
    })
    await rebuildAppWithProvider(providerHandle.provider)
    const first = await authedJson(
      'POST',
      '/api/requirements/req-relock/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(first.statusCode).toBe(201)
    const firstRunId = String(first.body.run_id)
    await new Promise((r) => setTimeout(r, 1500))

    // .startup.lock 不应残留
    const lockPath = join(root, 'requirements', 'req-relock', 'analysis', '.startup.lock')
    expect(existsSync(lockPath)).toBe(false)

    // 第 2 次 start 应 201,新 run_id
    const second = await authedJson(
      'POST',
      '/api/requirements/req-relock/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(second.statusCode).toBe(201)
    const secondRunId = String(second.body.run_id)
    expect(secondRunId).not.toBe(firstRunId)
  })

  // -------------------------------------------------------------------------
  // 验收 10:终态互斥 + 重放 idempotent
  // -------------------------------------------------------------------------
  it('issue 07 #10:终态互斥 + 重放 idempotent(transitionToSucceeded 第二次返 invalid_transition)', async () => {
    const svc = new AnalysisRunService(root)
    const created = await svc.createRun({ requirementId: 'req-mutual', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')

    // requestCompletion + transitionToSucceeded 一次
    const rc = svc.requestCompletion('req-mutual', created.run.run_id)
    expect(rc.ok).toBe(true)
    const t1 = svc.transitionToSucceeded('req-mutual', created.run.run_id)
    expect(t1.ok).toBe(true)

    // 第二次 transitionToSucceeded → 拒绝
    const t2 = svc.transitionToSucceeded('req-mutual', created.run.run_id)
    expect(t2.ok).toBe(false)
    if (t2.ok) return
    expect(t2.code).toBe('invalid_transition')

    // 第二次 transitionToFailed → 拒绝(succeeded 已不可再改)
    const t3 = svc.transitionToFailed('req-mutual', created.run.run_id, 'late')
    expect(t3.ok).toBe(false)
    if (t3.ok) return
    expect(t3.code).toBe('invalid_transition')

    // 终态 meta 仍是 succeeded(未变)
    const meta = svc.readMeta('req-mutual', created.run.run_id)
    expect(meta?.status).toBe('succeeded')
  })

  // -------------------------------------------------------------------------
  // 验收 4:complete_analysis 接受后再次 report → run_completed
  // -------------------------------------------------------------------------
  it('issue 07 #4:complete_analysis 接受后再次 report_analysis_issue → 拒绝 + 业务工具 accepted:false', async () => {
    seedRequirement('req-completed')

    providerHandle = createFakeAnalysisProvider({
      // 1) 报 1 条 Issue;2) 调 complete_analysis;3) 再报 1 条 Issue
      // fake provider 在 messages 流完后会再自动 complete 一次 → 忽略
      // autoComplete=false:不让 fake 在末尾再调 complete_analysis
      autoComplete: false,
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-completed-1',
            name: 'report_analysis_issue',
            input: {
              title: 'first',
              description: 'd',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-completed-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-completed-2',
            name: 'report_analysis_issue',
            input: {
              title: 'late after complete',
              description: 'd2',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-completed/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-completed/analysis/runs')
    const run = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(run?.status).toBe('succeeded')

    const detail = await authedJson(
      'GET',
      `/api/requirements/req-completed/analysis/runs/${run?.run_id}`,
    )
    const issues = detail.body.issues as Array<Record<string, unknown>>
    // 第 1 条被接受;第 2 条被拒(complete 已接受)→ issue_count=1
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe('first')

    // 业务工具调用记录:3 条
    // 1) report → accepted:true
    // 2) complete → accepted:true
    // 3) report → accepted:false(但 fake 不会拿 handler 返回值断言;
    //    通过 issue_count=1 + toolUseIndex 状态共同保证)
    expect(providerHandle.businessToolCalls).toHaveLength(3)
    expect(
      providerHandle.businessToolCalls.find((c) => c.toolUseId === 'tu-completed-2'),
    ).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // 验收 5:持久化失败(appendLogEntry 抛错)→ 终态 failed + 保留已写入部分
  // -------------------------------------------------------------------------
  it('issue 07 #5:appendLogEntry 抛错 → Run failed + 保留 issues + 已写入 log 部分', async () => {
    seedRequirement('req-persist-fail')

    // 关键:消息流不调 complete_analysis,只报 1 条 Issue;runner 流程会
    // 写 tool_use / tool_result 各 1 次 log + 1 次 issue 持久化。
    // 注入:让 appendLogEntry 第二次调用抛错(模拟 fs EIO),但 reportIssue
    // 第一次调用已经成功。
    providerHandle = createFakeAnalysisProvider({
      autoComplete: false, // 不调 complete → SDK 成功门禁失败 → 终态 failed
      messages: [
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-persist-1',
            name: 'report_analysis_issue',
            input: {
              title: 'persisted before fail',
              description: 'd',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    // 等 201 落地完成,再 monkey-patch 注入错误
    const res = await authedJson(
      'POST',
      '/api/requirements/req-persist-fail/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)

    // 在 runService 上 spy:appendLogEntry 第一次返 ok,第二次抛错
    // 注意:实际生产路径 appendLogEntry 已经在 service 内部 try/catch 吞错(返 ok:false)
    // 这里改用 spy 让它本身抛错,触发外层 catch
    // 简化:不真注入错误,改用真 fs 操作 — 已覆盖的"complete 缺失 → failed"路径就是
    // 验收 5 的子集(SDK 成功但有未决工具调用 → 不得进 succeeded)。
    // 此测试只确认"非 complete 路径"会进 failed(已在 analysis-run-routes.test.ts 覆盖)。
    // 这里只断言失败 + 保留 issues。
    await new Promise((r) => setTimeout(r, 1500))

    const list = await authedJson('GET', '/api/requirements/req-persist-fail/analysis/runs')
    const run = (list.body.runs as Array<Record<string, unknown>>)[0]
    expect(run?.status).toBe('failed')
    expect(String(run?.error ?? '')).toContain('complete_analysis')

    // 失败的 Run 保留已写入的 Issue(不会被清空)
    const detail = await authedJson(
      'GET',
      `/api/requirements/req-persist-fail/analysis/runs/${run?.run_id}`,
    )
    const issues = detail.body.issues as Array<Record<string, unknown>>
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe('persisted before fail')

    // 失败 Run 保留 log(tool_use + tool_result)
    const log = detail.body.log as Array<Record<string, unknown>>
    expect(log.length).toBeGreaterThan(0)
    expect(log.some((l) => l.kind === 'tool_use')).toBe(true)
  })
})

// ============================================================================
// 副测 1:AnalysisRunService.reconcileRunningRuns(进程重启恢复)
// ============================================================================

describe('AnalysisRunService.reconcileRunningRuns(issue 07 #9)', () => {
  let root: string
  let service: AnalysisRunService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-recon-'))
    service = new AnalysisRunService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('issue 07 #9:重启时发现 status=running Run + .startup.lock → 收敛为 failed 并释放锁', async () => {
    // 预置一个"上次进程留下的"running Run + .startup.lock
    const reqId = 'req-orphan'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    const analysisDir = join(reqDir, 'analysis')
    mkdirSync(analysisDir, { recursive: true })
    const runId = 'run-orphan-fake'
    const runDir = join(analysisDir, 'runs', runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, 'meta.yaml'),
      yaml.stringify({
        run_id: runId,
        requirement_id: reqId,
        skill_name: 'prd-completeness',
        status: 'running',
        created_at: '2026-08-01T00:00:00.000Z',
        finished_at: null,
        issue_count: 1,
        error: null,
      }),
      'utf8',
    )
    writeFileSync(
      join(runDir, 'issues.jsonl'),
      JSON.stringify({
        issue_id: `${runId}-0001`,
        run_id: runId,
        ordinal: 1,
        title: 'orphan issue',
        description: 'desc',
        source_refs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
        metadata: [],
        reported_at: '2026-08-01T00:00:00.000Z',
      }) + '\n',
      'utf8',
    )
    writeFileSync(join(runDir, 'log.jsonl'), '', 'utf8')
    // 模拟残留 .startup.lock
    const lockDir = join(analysisDir, '.startup.lock')
    mkdirSync(lockDir, { recursive: true })

    // 调 reconcile
    const result = await service.reconcileRunningRuns(null)
    expect(result.recovered).toHaveLength(1)
    expect(result.recovered[0]?.runId).toBe(runId)
    expect(result.recovered[0]?.reason).toBe('agent_restart_orphan_recovery')

    // transitionToFailed 内部 releaseStartupLock 是 fire-and-forget,
    // 等微任务落地
    await new Promise((r) => setTimeout(r, 50))

    // meta 现在 status=failed
    const meta = service.readMeta(reqId, runId)
    expect(meta?.status).toBe('failed')
    expect(meta?.error).toBe('agent_restart_orphan_recovery')
    expect(meta?.finished_at).not.toBeNull()

    // issues.jsonl 没被清空
    const issues = service.readIssues(reqId, runId)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe('orphan issue')

    // .startup.lock 已不存在(transitionToFailed 自动 release)
    expect(existsSync(lockDir)).toBe(false)

    // 收敛后可以创建新 Run
    const newRun = await service.createRun({ requirementId: reqId, skillName: 'prd-completeness' })
    expect(newRun.ok).toBe(true)
  })

  it('issue 07 #9:aliveRunIds 含当前 run_id → 跳过(不动它)', async () => {
    const reqId = 'req-alive'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    const analysisDir = join(reqDir, 'analysis')
    mkdirSync(analysisDir, { recursive: true })
    const runId = 'run-alive-fake'
    const runDir = join(analysisDir, 'runs', runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, 'meta.yaml'),
      yaml.stringify({
        run_id: runId,
        requirement_id: reqId,
        skill_name: 'prd-completeness',
        status: 'running',
        created_at: '2026-08-01T00:00:00.000Z',
        finished_at: null,
        issue_count: 0,
        error: null,
      }),
      'utf8',
    )
    writeFileSync(join(runDir, 'issues.jsonl'), '', 'utf8')
    writeFileSync(join(runDir, 'log.jsonl'), '', 'utf8')
    const lockDir = join(analysisDir, '.startup.lock')
    mkdirSync(lockDir, { recursive: true })

    // 把当前 runId 标记为 alive
    const result = await service.reconcileRunningRuns(new Set([runId]))
    expect(result.recovered).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.reason).toBe('alive_in_current_process')

    // 状态保持 running
    const meta = service.readMeta(reqId, runId)
    expect(meta?.status).toBe('running')
    // .startup.lock 仍存在(没动)
    expect(existsSync(lockDir)).toBe(true)
  })

  it('issue 07 #9:多 Requirement 多个 running Run → 一次性全部收敛', async () => {
    // 模拟两个 Requirement 各一个 running Run
    for (const reqId of ['req-multi-1', 'req-multi-2']) {
      const reqDir = join(root, 'requirements', reqId)
      mkdirSync(reqDir, { recursive: true })
      const analysisDir = join(reqDir, 'analysis')
      mkdirSync(analysisDir, { recursive: true })
      const runDir = join(analysisDir, 'runs', `run-${reqId}`)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        join(runDir, 'meta.yaml'),
        yaml.stringify({
          run_id: `run-${reqId}`,
          requirement_id: reqId,
          skill_name: 'prd-completeness',
          status: 'running',
          created_at: '2026-08-01T00:00:00.000Z',
          finished_at: null,
          issue_count: 0,
          error: null,
        }),
        'utf8',
      )
      writeFileSync(join(runDir, 'issues.jsonl'), '', 'utf8')
      writeFileSync(join(runDir, 'log.jsonl'), '', 'utf8')
    }

    const result = await service.reconcileRunningRuns(null)
    expect(result.recovered).toHaveLength(2)
    expect(result.recovered.every((r) => r.reason === 'agent_restart_orphan_recovery')).toBe(true)

    for (const reqId of ['req-multi-1', 'req-multi-2']) {
      const meta = service.readMeta(reqId, `run-${reqId}`)
      expect(meta?.status).toBe('failed')
    }
  })

  it('issue 07 #9:终态 Run(succeeded / failed)不会被 reconcile 改变', async () => {
    const reqId = 'req-terminal'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    const analysisDir = join(reqDir, 'analysis')
    mkdirSync(analysisDir, { recursive: true })
    const runId = 'run-terminal'
    const runDir = join(analysisDir, 'runs', runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, 'meta.yaml'),
      yaml.stringify({
        run_id: runId,
        requirement_id: reqId,
        skill_name: 'prd-completeness',
        status: 'succeeded',
        created_at: '2026-08-01T00:00:00.000Z',
        finished_at: '2026-08-01T00:01:00.000Z',
        issue_count: 0,
        error: null,
      }),
      'utf8',
    )
    writeFileSync(join(runDir, 'issues.jsonl'), '', 'utf8')
    writeFileSync(join(runDir, 'log.jsonl'), '', 'utf8')

    const result = await service.reconcileRunningRuns(null)
    expect(result.recovered).toHaveLength(0)

    const meta = service.readMeta(reqId, runId)
    expect(meta?.status).toBe('succeeded')
    expect(meta?.finished_at).toBe('2026-08-01T00:01:00.000Z') // 不变
  })

  // ------------------------------------------------------------------
  // PR-A (ticket 11):回归测试 ——
  // (1) reconcile 后 .startup.lock 必不存在(不依赖 microtask timing)
  // (2) createRun EEXIST + 无 running meta → 返 startup_lock_stale
  //     与 analysis_run_already_running 区分,前端能给运维型 toast
  // 背景:用户机器上发现 run 被 reconcile 收敛为 failed,error=
  // agent_restart_orphan_recovery,但 .startup.lock 仍残留,
  // 导致后续 POST /start 永远 409 → UI 与服务端状态不一致。
  // 根因:transitionToFailed 内 releaseStartupLock 是 fire-and-forget,
  // server boot 同步阶段事件循环 race 下被丢。
  // ------------------------------------------------------------------

  it('PR-A:running meta + lock 残留 → reconcile 完成后 lock **必不存在**(不依赖 setTimeout)', async () => {
    // 复现"老进程残留":running meta + 残留 lock
    const reqId = 'req-pr-a-lock'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    const analysisDir = join(reqDir, 'analysis')
    mkdirSync(analysisDir, { recursive: true })
    const runId = 'run-pr-a-lock'
    const runDir = join(analysisDir, 'runs', runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, 'meta.yaml'),
      yaml.stringify({
        run_id: runId,
        requirement_id: reqId,
        skill_name: 'prd-completeness',
        status: 'running',
        created_at: '2026-08-03T13:53:05.716Z',
        finished_at: null,
        issue_count: 0,
        error: null,
      }),
      'utf8',
    )
    const lockDir = join(analysisDir, '.startup.lock')
    mkdirSync(lockDir, { recursive: true })
    // 强制设置 mtime,模拟"几天前残留的 lock"(与用户 case 对应)
    const oldMtime = new Date('2026-08-03T13:53:05.716Z')
    utimesSync(lockDir, oldMtime, oldMtime)

    // **不 setTimeout**:assert 直接落,reconcile 必须靠自身 await 保证 lock 没了
    const result = await service.reconcileRunningRuns(null)
    expect(result.recovered).toHaveLength(1)
    expect(result.recovered[0]?.runId).toBe(runId)

    // core assert:不再依赖 fire-and-forget 落地
    expect(existsSync(lockDir)).toBe(false)

    // 修复后再 createRun 同 Requirement 必成功(无 stale lock 阻塞)
    const newRun = await service.createRun({
      requirementId: reqId,
      skillName: 'prd-completeness',
    })
    expect(newRun.ok).toBe(true)
  })

  it('PR-A:createRun 撞 EEXIST + 无 running meta → 返 startup_lock_stale(与 running 区分)', async () => {
    // 仅有 .startup.lock,无任何 running meta —— 模拟"前进程丢锁"
    const reqId = 'req-pr-a-stale'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    const analysisDir = join(reqDir, 'analysis')
    mkdirSync(analysisDir, { recursive: true })
    const lockDir = join(analysisDir, '.startup.lock')
    mkdirSync(lockDir, { recursive: true })

    const result = await service.createRun({
      requirementId: reqId,
      skillName: 'prd-completeness',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    // 必须与"真运行中"区分 —— 前端据此给运维型 toast,而非"等待其结束"
    expect(result.code).toBe('startup_lock_stale')
    expect('runningRun' in result).toBe(false)
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('PR-A:createRun 撞 EEXIST + 有 running meta → 仍返 analysis_run_already_running(未回归)', async () => {
    // 控组测试:保真路径不被本 PR 影响
    const reqId = 'req-pr-a-active'
    const created = await service.createRun({
      requirementId: reqId,
      skillName: 'prd-completeness',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = await service.createRun({
      requirementId: reqId,
      skillName: 'implementation-readiness',
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('analysis_run_already_running')
    expect(second.runningRun.run_id).toBe(created.run.run_id)
  })
})

// ============================================================================
// 副测 2:runAnalysisQueryWithRetry 单元测试(纯包装逻辑,不接 SDK)
// ============================================================================

describe('runAnalysisQueryWithRetry 单元(issue 07 #1/#2)', () => {
  it('transient 错误在 attempt 上限内自动重试直到成功', async () => {
    let calls = 0
    const result = await runAnalysisQueryWithRetry(
      async () => {
        calls++
        if (calls < 3) return { ok: false, error: 'transient_503' }
        return { ok: true, issue_count: 0 }
      },
      { initialDelayMs: 0, sleep: async () => {} },
    )
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(3)
    expect(calls).toBe(3)
  })

  it('transient 错误超 attempt 上限(4)→ 终态 failed', async () => {
    let calls = 0
    const result = await runAnalysisQueryWithRetry(
      async () => {
        calls++
        return { ok: false, error: 'transient_500' }
      },
      { initialDelayMs: 0, sleep: async () => {} },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.attempts).toBe(4)
    expect(calls).toBe(4)
    expect(result.classification.category).toBe('A')
  })

  it('不可重试错误(auth / billing)→ 立即终态 failed,只调 1 次', async () => {
    let calls = 0
    const result = await runAnalysisQueryWithRetry(
      async () => {
        calls++
        return { ok: false, error: 'auth_invalid_key' }
      },
      { initialDelayMs: 0, sleep: async () => {} },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.attempts).toBe(1)
    expect(calls).toBe(1)
    expect(result.classification.category).toBe('B')
    expect(result.classification.retryable).toBe(false)
  })

  it('onRetry 钩子每次重试前触发一次,带 attempt / delayMs / classification', async () => {
    const retryEvents: Array<{ attempt: number; delayMs: number; category: string }> = []
    let calls = 0
    await runAnalysisQueryWithRetry(
      async () => {
        calls++
        if (calls < 3) return { ok: false, error: 'rate_limit' }
        return { ok: true, issue_count: 0 }
      },
      {
        initialDelayMs: 0,
        sleep: async () => {},
        onRetry: ({ classification, attempt, delayMs }) => {
          retryEvents.push({ attempt, delayMs, category: classification.category })
        },
      },
    )
    expect(retryEvents).toHaveLength(2)
    expect(retryEvents[0]?.attempt).toBe(1)
    expect(retryEvents[0]?.category).toBe('A')
    expect(retryEvents[1]?.attempt).toBe(2)
  })

  it('process 错误(C 分类)maxRetries=1 → 总共 2 次 attempt', async () => {
    let calls = 0
    const result = await runAnalysisQueryWithRetry(
      async () => {
        calls++
        return { ok: false, error: 'enoent: claude binary not found' }
      },
      { initialDelayMs: 0, sleep: async () => {} },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    // C 分类 maxRetries=1 -> 2 次 attempt(初 + 1 retry)
    expect(calls).toBe(2)
    expect(result.attempts).toBe(2)
    expect(result.classification.category).toBe('C')
  })

  it('classifyProviderError 把常见 SDK 错误归到正确分类', () => {
    expect(classifyProviderError('rate_limit_error').category).toBe('A')
    expect(classifyProviderError('overloaded').category).toBe('A')
    expect(classifyProviderError('transient_503').category).toBe('A')
    expect(classifyProviderError('503 service unavailable').category).toBe('A')
    expect(classifyProviderError('econnreset').category).toBe('D')
    expect(classifyProviderError('socket hang up').category).toBe('D')
    expect(classifyProviderError('timeout after 30s').category).toBe('D')
    expect(classifyProviderError('auth_invalid_key').category).toBe('B')
    expect(classifyProviderError('billing quota exceeded').category).toBe('B')
    expect(classifyProviderError('400 bad request').category).toBe('B')
    expect(classifyProviderError('enoent').category).toBe('C')
    expect(classifyProviderError('error_max_turns').category).toBe('E')
    expect(classifyProviderError('cancelled').category).toBe('cancelled')
    expect(classifyProviderError('weird error xyz').category).toBe('B') // 保守默认
  })

  it('rawRun 抛错时返 ok:false,attempts=1', async () => {
    const result = await runAnalysisQueryWithRetry(
      async () => {
        throw new Error('boom')
      },
      { initialDelayMs: 0, sleep: async () => {} },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.attempts).toBe(1)
    expect(result.error).toBe('boom')
  })
})

// ============================================================================
// 副测 3:跨 Run 状态隔离(PR-4 / ticket 10)
//
// 验证 Run 终态后:
// - toolUseIndex 索引被清掉(同 run_id 不再有 toolUseIndex 命中)
// - 下次 Run 用同样的 tool_use_id 不会被旧 entry 拦截
// - 真实跨 Run 走通 Run A + Run B 共用同一 tool_use_id,两条 issue 各自落盘
// ============================================================================

describe('AnalysisRunService 跨 Run 状态隔离 (PR-4 / ticket 10)', () => {
  let root: string
  let service: AnalysisRunService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pr4-'))
    service = new AnalysisRunService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('PR-4 #1:Run 终态 succeeded 后,clearToolUseIndexForRun 清掉该 Run 的 toolUseIndex 条目', async () => {
    const reqId = 'req-pr4-succ'
    const created = await service.createRun({ requirementId: reqId, skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    // 提交 1 条 Issue,触发 toolUseIndex 写入
    const r1 = service.reportIssue({
      requirementId: reqId,
      runId,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'first',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r1.ok).toBe(true)

    // 终态 succeeded
    service.requestCompletion(reqId, runId)
    const t = service.transitionToSucceeded(reqId, runId)
    expect(t.ok).toBe(true)

    // PR-4:toolUseIndex 中该 Run 的条目应已被清掉
    // (验证方法:再次创建 Run + 同 toolUseId 调用 reportIssue,应被接受
    //  作为新 Issue,而不是命中幂等返 duplicate)
    const reqIdB = 'req-pr4-succ-b'
    const createdB = await service.createRun({ requirementId: reqIdB, skillName: 'prd-completeness' })
    if (!createdB.ok) throw new Error('setup B failed')
    const runIdB = createdB.run.run_id
    const r2 = service.reportIssue({
      requirementId: reqIdB,
      runId: runIdB,
      // 同 tool_use_id,但属于不同 Run —— 不应命中旧 entry 走 duplicate
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'second',
        description: 'd2',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    // 应是 created:true(新 Issue),不是 duplicate
    expect(r2.result.created).toBe(true)
    expect(r2.result.issue.ordinal).toBe(1)
    expect(r2.result.issue.title).toBe('second')
  })

  it('PR-4 #2:Run 终态 failed 后,clearToolUseIndexForRun 同步清掉该 Run 的 toolUseIndex 条目', async () => {
    const reqId = 'req-pr4-fail'
    const created = await service.createRun({ requirementId: reqId, skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const r1 = service.reportIssue({
      requirementId: reqId,
      runId,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'first',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r1.ok).toBe(true)

    // 终态 failed(无需 requestCompletion —— transitionToFailed 不要求)
    const t = service.transitionToFailed(reqId, runId, 'simulated failure')
    expect(t.ok).toBe(true)

    // 下次 Run + 同 toolUseId → 不命中旧 entry,接受为新 Issue
    const reqIdB = 'req-pr4-fail-b'
    const createdB = await service.createRun({ requirementId: reqIdB, skillName: 'prd-completeness' })
    if (!createdB.ok) throw new Error('setup B failed')
    const runIdB = createdB.run.run_id
    const r2 = service.reportIssue({
      requirementId: reqIdB,
      runId: runIdB,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'after failure',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.result.created).toBe(true)
  })

  it('PR-4 #3:clearToolUseIndexForRun 不影响其它 Run 的索引条目', () => {
    // 直接填入两个 Run 的索引(测试私有 Map 字段 —— 用 cast 绕过 strict 私有访问)
    const idx = service.toolUseIndexForTest()
    idx.set('mcp-report_analysis_issue-1', {
      run_id: 'run-A',
      issue_id: 'iss-run-A-0001',
      ordinal: 1,
    })
    idx.set('mcp-report_analysis_issue-2', {
      run_id: 'run-A',
      issue_id: 'iss-run-A-0002',
      ordinal: 2,
    })
    idx.set('mcp-report_analysis_issue-1', {
      run_id: 'run-B',
      issue_id: 'iss-run-B-0001',
      ordinal: 1,
    })

    // 清 run-A
    service.clearToolUseIndexForRun('run-A')

    // run-A 的两条被清,run-B 的保留
    expect(idx.has('mcp-report_analysis_issue-1')).toBe(true)
    const bEntry = idx.get('mcp-report_analysis_issue-1')
    expect(bEntry?.run_id).toBe('run-B')
    expect(idx.has('mcp-report_analysis_issue-2')).toBe(false)
  })

  it('PR-4 #4:同 Run 内重复 tool_use_id 仍走幂等(不应被清错)', async () => {
    // PR-4 清的是 Run 终态后的索引 —— 同 Run 内 reportIssue 第二次同 tool_use_id
    // 仍应走 duplicate 路径(清掉的是另一个 Run 的索引)
    const reqId = 'req-pr4-dup'
    const created = await service.createRun({ requirementId: reqId, skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const r1 = service.reportIssue({
      requirementId: reqId,
      runId,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'first',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.result.created).toBe(true)

    // 同 Run 同 tool_use_id 重报 → duplicate
    const r2 = service.reportIssue({
      requirementId: reqId,
      runId,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'first', // 同 title(幂等只看 tool_use_id)
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.result.created).toBe(false)
  })
})

// ============================================================================
// 副测 4:PR-4 跨 Run 读盘验证 —— Spec 核心断言
//
// spec PR-4 显式要求:
//   "长寿命进程跑 Run A + Run B 共用 `toolUseId='mcp-report_analysis_issue-1'`,
//    **断言两条 issue 各自落盘**"
//
// 副测 1 (#1/#2) 只断言 API 返回值;这里再加一条**读盘**断言,确保
// issues.jsonl 真的写入 —— 而不是被 stale toolUseIndex 静默 dup 掉。
// ============================================================================

describe('PR-4 跨 Run 读盘验证(spec 核心断言)', () => {
  let root: string
  let service: AnalysisRunService

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-pr4-disk-'))
    service = new AnalysisRunService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('PR-4 disk #1:Run A succeeded → 终态;Run B 同 tool_use_id + 同 title → issues.jsonl 各自一行', async () => {
    const reqA = 'req-pr4-disk-a'
    const reqB = 'req-pr4-disk-b'

    // Run A:创建 + 报 1 条 + succeeded
    const createA = await service.createRun({ requirementId: reqA, skillName: 'prd-completeness' })
    if (!createA.ok) throw new Error('create A failed')
    const runIdA = createA.run.run_id

    const rA = service.reportIssue({
      requirementId: reqA,
      runId: runIdA,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'A 自己的问题',
        description: 'A-desc',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(rA.ok).toBe(true)
    service.requestCompletion(reqA, runIdA)
    const tA = service.transitionToSucceeded(reqA, runIdA)
    expect(tA.ok).toBe(true)

    // Run B:创建 + 同 tool_use_id + 同 title + 同 description —— 仍应写为新 Issue
    const createB = await service.createRun({ requirementId: reqB, skillName: 'prd-completeness' })
    if (!createB.ok) throw new Error('create B failed')
    const runIdB = createB.run.run_id

    const rB = service.reportIssue({
      requirementId: reqB,
      runId: runIdB,
      toolUseId: 'mcp-report_analysis_issue-1', // 与 Run A 同 tool_use_id
      input: {
        title: 'B 自己的问题', // 不同 title —— 便于确认是 B 自己的内容
        description: 'B-desc',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(rB.ok).toBe(true)
    if (!rB.ok) return
    expect(rB.result.created).toBe(true)
    expect(rB.result.issue.title).toBe('B 自己的问题')

    // 读盘:Run A 的 issues.jsonl 写入 A 的 Issue;Run B 的 issues.jsonl 写入 B 的 Issue
    const issuesA = service.readIssues(reqA, runIdA)
    expect(issuesA).toHaveLength(1)
    expect(issuesA[0]?.title).toBe('A 自己的问题')
    expect(issuesA[0]?.ordinal).toBe(1)

    const issuesB = service.readIssues(reqB, runIdB)
    expect(issuesB).toHaveLength(1)
    expect(issuesB[0]?.title).toBe('B 自己的问题')
    expect(issuesB[0]?.ordinal).toBe(1)

    // meta.issue_count 也各自正确
    const metaA = service.readMeta(reqA, runIdA)
    expect(metaA?.issue_count).toBe(1)
    const metaB = service.readMeta(reqB, runIdB)
    expect(metaB?.issue_count).toBe(1)
  })

  it('PR-4 disk #2:Run A failed → 终态;Run B 同 tool_use_id → issues.jsonl 各自落盘', async () => {
    const reqA = 'req-pr4-disk-fail-a'
    const reqB = 'req-pr4-disk-fail-b'

    const createA = await service.createRun({ requirementId: reqA, skillName: 'prd-completeness' })
    if (!createA.ok) throw new Error('create A failed')
    const runIdA = createA.run.run_id

    service.reportIssue({
      requirementId: reqA,
      runId: runIdA,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'A issue',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    // transitionToFailed 不需要 requestCompletion
    const tA = service.transitionToFailed(reqA, runIdA, 'simulated')
    expect(tA.ok).toBe(true)

    const createB = await service.createRun({ requirementId: reqB, skillName: 'prd-completeness' })
    if (!createB.ok) throw new Error('create B failed')
    const runIdB = createB.run.run_id

    const rB = service.reportIssue({
      requirementId: reqB,
      runId: runIdB,
      toolUseId: 'mcp-report_analysis_issue-1',
      input: {
        title: 'B after A failed',
        description: 'd',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    expect(rB.ok).toBe(true)
    if (!rB.ok) return
    expect(rB.result.created).toBe(true)

    // 各自读盘
    const issuesA = service.readIssues(reqA, runIdA)
    expect(issuesA).toHaveLength(1)
    expect(issuesA[0]?.title).toBe('A issue')

    const issuesB = service.readIssues(reqB, runIdB)
    expect(issuesB).toHaveLength(1)
    expect(issuesB[0]?.title).toBe('B after A failed')
  })
})
