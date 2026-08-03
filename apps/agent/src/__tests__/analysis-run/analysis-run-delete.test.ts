/**
 * Analysis Run 永久删除 — service + REST + 上下文重组(issue 05 · ADR-0021 决策 42)
 *
 * 覆盖验收点:
 * - 8:运行中 Run 服务端拒绝删除(409 / run_still_running)
 * - 9:终态 Run 级联删除 Run + Issue + Response + Log
 * - 10:删除后重新组装上下文时不再出现该 Run 的 Response
 * - 11:删除当前 Run 后 listRuns / listResponses 排除已删除 Run
 * - 12:listRuns 仍按 created_at 倒序;空 Requirement 合法空态
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
import { DEFAULT_PRD_CONTENT } from './__fixtures__/prd.js'
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
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> | null }> {
  // DELETE 通常不带 body;Fastify 在 DELETE 上收到 content-type: application/json
  // + 空 body 会抛 400。我们只对 POST 显式带 body。
  const hasBody = method === 'POST' && body !== undefined
  const res = await app.inject({
    method,
    url,
    headers: {
      'x-aidevspace-token': token,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    payload: hasBody ? body : undefined,
  })
  // 204 没有 body → 不能 res.json()
  if (res.statusCode === 204) return { statusCode: 204, body: null }
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
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: ${name} skill
version: 1.0.0
---

# ${name}

正文
`,
    'utf8',
  )
}

function countEvents(sseBody: string, type: string): number {
  return (sseBody.match(new RegExp(`event: ${type}`, 'g')) ?? []).length
}

/**
 * 直接通过 service 创建一个 succeeded 终态 Run + N 条 Issue + M 条 Response。
 * 用于单元测试 service.deleteRun + 上下文重组(不需要走 fake Provider)。
 */
async function seedTerminalRunWithResponses(opts: {
  reqId: string
  issueCount: number
  responseCount: number
}): Promise<{ runId: string; issueIds: string[]; service: AnalysisRunService }> {
  const service = new AnalysisRunService(root)
  const created = await service.createRun({
    requirementId: opts.reqId,
    skillName: 'prd-completeness',
  })
  if (!created.ok) throw new Error('createRun failed')
  const runId = created.run.run_id
  service.requestCompletion(opts.reqId, runId)
  service.transitionToSucceeded(opts.reqId, runId)
  await new Promise((r) => setTimeout(r, 20)) // 释放 startup lock

  const issueIds: string[] = []
  for (let i = 1; i <= opts.issueCount; i++) {
    const r = service.reportIssue({
      requirementId: opts.reqId,
      runId,
      toolUseId: `tu-${i}`,
      input: {
        title: `Issue ${i}`,
        description: `desc ${i}`,
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
      },
    })
    if (!r.ok) throw new Error('reportIssue failed')
    issueIds.push(r.result.issue.issue_id)
  }
  // 写前 N 条 Response
  for (let i = 0; i < opts.responseCount && i < issueIds.length; i++) {
    const w = service.writeResponse(opts.reqId, runId, issueIds[i]!, `答复 ${i + 1}`, 0)
    if (!w.ok) throw new Error('writeResponse failed')
  }
  return { runId, issueIds, service }
}

// ============================================================================
// Service-level 单测
// ============================================================================

describe('AnalysisRunService.deleteRun(issue 05)', () => {
  let service: AnalysisRunService
  let reqDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-del-'))
    process.env.AIDEVSPACE_ROOT = root
    reqDir = join(root, 'requirements', 'req-del')
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(join(reqDir, 'requirement.md'), '# PRD', 'utf8')
    service = new AnalysisRunService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
  })

  it('running 状态 Run → deleteRun 拒绝 run_still_running', async () => {
    const created = await service.createRun({
      requirementId: 'req-del',
      skillName: 'prd-completeness',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const r = service.deleteRun('req-del', created.run.run_id)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_still_running')

    // 文件仍存在
    const runDir = join(
      root,
      'requirements',
      'req-del',
      'analysis',
      'runs',
      created.run.run_id,
    )
    expect(existsSync(join(runDir, 'meta.yaml'))).toBe(true)
  })

  it('succeeded Run → deleteRun 成功 + 整个 runs/<id>/ 目录消失', async () => {
    const { runId } = await seedTerminalRunWithResponses({
      reqId: 'req-del',
      issueCount: 2,
      responseCount: 1,
    })
    const runDir = join(root, 'requirements', 'req-del', 'analysis', 'runs', runId)
    expect(existsSync(join(runDir, 'meta.yaml'))).toBe(true)
    expect(existsSync(join(runDir, 'issues.jsonl'))).toBe(true)
    expect(existsSync(join(runDir, 'log.jsonl'))).toBe(true)
    expect(existsSync(join(runDir, 'responses'))).toBe(true)

    const r = service.deleteRun('req-del', runId)
    expect(r.ok).toBe(true)

    // 整个目录消失
    expect(existsSync(runDir)).toBe(false)
    // listRuns 不再列出
    expect(service.listRuns('req-del').find((x) => x.run_id === runId)).toBeUndefined()
  })

  it('failed Run → deleteRun 同样允许', async () => {
    const created = await service.createRun({
      requirementId: 'req-failed',
      skillName: 'prd-completeness',
    })
    if (!created.ok) throw new Error('setup failed')
    const t = service.transitionToFailed('req-failed', created.run.run_id, 'simulated')
    expect(t.ok).toBe(true)

    const r = service.deleteRun('req-failed', created.run.run_id)
    expect(r.ok).toBe(true)
  })

  it('Run 不存在 → run_not_found', () => {
    const r = service.deleteRun('req-del', 'run-ghost')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_not_found')
  })

  it('级联删除后,Response / Issue / Log 文件都不存在', async () => {
    const { runId } = await seedTerminalRunWithResponses({
      reqId: 'req-cascade',
      issueCount: 2,
      responseCount: 2,
    })
    const runDir = join(root, 'requirements', 'req-cascade', 'analysis', 'runs', runId)
    const responsesDir = join(runDir, 'responses')
    const filesBefore = existsSync(responsesDir)
      ? readdirSync(responsesDir)
      : []
    expect(filesBefore.length).toBeGreaterThan(0)

    service.deleteRun('req-cascade', runId)
    expect(existsSync(runDir)).toBe(false)
  })

  it('删除后 listResponses 不再包含该 Run 的 Response', async () => {
    const { runId, issueIds, service: svc } = await seedTerminalRunWithResponses({
      reqId: 'req-after-del',
      issueCount: 2,
      responseCount: 2,
    })
    expect(svc.listResponses('req-after-del')).toHaveLength(2)

    svc.deleteRun('req-after-del', runId)

    expect(svc.listResponses('req-after-del')).toHaveLength(0)
    // 防御:删除后 readResponse 也应返 null
    expect(svc.readResponse('req-after-del', runId, issueIds[0]!).ok).toBe(true)
    if (!svc.readResponse('req-after-del', runId, issueIds[0]!).ok) return
    expect(svc.readResponse('req-after-del', runId, issueIds[0]!).response).toBeNull()
  })

  it('删除后 assembleAnsweredContext 不再包含该 Run 的 Response', async () => {
    const { runId, service: svc } = await seedTerminalRunWithResponses({
      reqId: 'req-asm',
      issueCount: 1,
      responseCount: 1,
    })
    const before = svc.assembleAnsweredContext('req-asm', 100_000)
    expect(before.ok).toBe(true)
    if (!before.ok) return
    expect(before.items).toHaveLength(1)

    svc.deleteRun('req-asm', runId)

    const after = svc.assembleAnsweredContext('req-asm', 100_000)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.items).toHaveLength(0)
    expect(after.totalChars).toBe(0)
  })

  it('多 Run 删除其一:其他 Run 不受影响 + 列表保持倒序', async () => {
    const svc = new AnalysisRunService(root)
    // Run A
    const a = await svc.createRun({ requirementId: 'req-multi', skillName: 'prd-completeness' })
    if (!a.ok) throw new Error('a')
    svc.requestCompletion('req-multi', a.run.run_id)
    svc.transitionToSucceeded('req-multi', a.run.run_id)
    await new Promise((r) => setTimeout(r, 20))
    const ia = svc.reportIssue({
      requirementId: 'req-multi',
      runId: a.run.run_id,
      toolUseId: 'tu-a',
      input: { title: 'A', description: 'd', sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }] },
    })
    if (!ia.ok) throw new Error('ia')
    svc.writeResponse('req-multi', a.run.run_id, ia.result.issue.issue_id, 'A 答复', 0)

    // Run B(更晚)
    const b = await svc.createRun({ requirementId: 'req-multi', skillName: 'prd-completeness' })
    if (!b.ok) throw new Error('b')
    svc.requestCompletion('req-multi', b.run.run_id)
    svc.transitionToSucceeded('req-multi', b.run.run_id)
    await new Promise((r) => setTimeout(r, 20))
    const ib = svc.reportIssue({
      requirementId: 'req-multi',
      runId: b.run.run_id,
      toolUseId: 'tu-b',
      input: { title: 'B', description: 'd', sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }] },
    })
    if (!ib.ok) throw new Error('ib')
    svc.writeResponse('req-multi', b.run.run_id, ib.result.issue.issue_id, 'B 答复', 0)

    expect(svc.listRuns('req-multi')).toHaveLength(2)
    expect(svc.listResponses('req-multi')).toHaveLength(2)

    // 删除 A
    svc.deleteRun('req-multi', a.run.run_id)

    // B 仍在 + 列表按 created_at 倒序(B 更晚 → 在前)
    const remaining = svc.listRuns('req-multi')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.run_id).toBe(b.run.run_id)
    expect(svc.listResponses('req-multi')).toHaveLength(1)
    expect(svc.listResponses('req-multi')[0]?.body).toBe('B 答复')
  })

  it('删除后 readMeta / readIssues / readLog 都返回空', async () => {
    const { runId, service: svc } = await seedTerminalRunWithResponses({
      reqId: 'req-empty',
      issueCount: 1,
      responseCount: 1,
    })
    svc.deleteRun('req-empty', runId)
    expect(svc.readMeta('req-empty', runId)).toBeNull()
    expect(svc.readIssues('req-empty', runId)).toEqual([])
    expect(svc.readLog('req-empty', runId)).toEqual([])
  })
})

// ============================================================================
// REST endpoint 集成测试
// ============================================================================

describe('DELETE /api/requirements/:id/analysis/runs/:runId (issue 05)', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-del-rest-'))
    process.env.AIDEVSPACE_ROOT = root
    seedSkill('prd-completeness')
    seedSkill('implementation-readiness')

    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })

    // 默认 fake:无 messages → 自动 complete → 0 Issue 成功态
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

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/requirements/req-401/analysis/runs/run-x',
    })
    expect(res.statusCode).toBe(401)
  })

  it('404 when run does not exist', async () => {
    seedRequirement('req-404')
    const res = await authedJson(
      'DELETE',
      '/api/requirements/req-404/analysis/runs/run-ghost',
    )
    expect(res.statusCode).toBe(404)
    expect(res.body?.error).toBe('analysis_run_not_found')
  })

  it('204 成功删除 + 物理级联 meta/issues/log/responses', async () => {
    seedRequirement('req-del-ok')
    // 创建 Run(默认 fake 自动 complete → succeeded)
    const start = await authedJson(
      'POST',
      '/api/requirements/req-del-ok/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(201)
    const runId = String(start.body?.run_id)

    // 等异步 runner 完成
    await new Promise((r) => setTimeout(r, 500))

    const runDir = join(
      root,
      'requirements',
      'req-del-ok',
      'analysis',
      'runs',
      runId,
    )
    expect(existsSync(join(runDir, 'meta.yaml'))).toBe(true)

    // DELETE
    const del = await authedJson(
      'DELETE',
      `/api/requirements/req-del-ok/analysis/runs/${runId}`,
    )
    expect(del.statusCode).toBe(204)
    expect(del.body).toBeNull()

    // 目录消失
    expect(existsSync(runDir)).toBe(false)

    // GET /runs 不再列出
    const list = await authedJson('GET', '/api/requirements/req-del-ok/analysis/runs')
    expect(list.statusCode).toBe(200)
    const ids = (list.body?.runs as Array<{ run_id: string }>).map((r) => r.run_id)
    expect(ids).not.toContain(runId)
  })

  it('409 when run is still running', async () => {
    seedRequirement('req-running')

    // fake provider 不自动 complete → Run 长期 running(实际由 runner 在最终失败前保持)
    providerHandle = createFakeAnalysisProvider({
      autoComplete: false,
      messages: [], // 不推任何消息,Runner 不会调 complete
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const start = await authedJson(
      'POST',
      '/api/requirements/req-running/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(201)
    const runId = String(start.body?.run_id)

    // 立即强制把状态写回 running(避免 fake timing 让 runner 已经把状态改完)
    const metaPath = join(
      root,
      'requirements',
      'req-running',
      'analysis',
      'runs',
      runId,
      'meta.yaml',
    )
    const meta = yaml.parse(readFileSync(metaPath, 'utf8'))
    meta.status = 'running'
    writeFileSync(metaPath, yaml.stringify(meta), 'utf8')

    const del = await authedJson(
      'DELETE',
      `/api/requirements/req-running/analysis/runs/${runId}`,
    )
    expect(del.statusCode).toBe(409)
    expect(del.body?.error).toBe('analysis_run_still_running')

    // 文件仍存在(未被删除)
    expect(existsSync(metaPath)).toBe(true)
  })

  it('成功删除 → SSE 推送 analysis_run_deleted', async () => {
    seedRequirement('req-del-sse')
    const ssePromise = openSse('/api/requirement/req-del-sse/events', 2500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const start = await authedJson(
      'POST',
      '/api/requirements/req-del-sse/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(201)
    const runId = String(start.body?.run_id)

    // 等异步 runner 完成
    await new Promise((r) => setTimeout(r, 500))

    const del = await authedJson(
      'DELETE',
      `/api/requirements/req-del-sse/analysis/runs/${runId}`,
    )
    expect(del.statusCode).toBe(204)

    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    expect(countEvents(sse.body, 'analysis_run_deleted')).toBeGreaterThanOrEqual(1)
  })

  it('删除当前选中 Run → 下一次启动已删除 Run 的 Response 不再进 context', async () => {
    seedRequirement('req-cleanup')

    // 1. 第一 Run 写入 Response(走 service 简化噪音)
    const svc = new AnalysisRunService(root)
    const first = await svc.createRun({
      requirementId: 'req-cleanup',
      skillName: 'prd-completeness',
    })
    if (!first.ok) throw new Error('c1')
    svc.requestCompletion('req-cleanup', first.run.run_id)
    svc.transitionToSucceeded('req-cleanup', first.run.run_id)
    await new Promise((r) => setTimeout(r, 20))
    const i1 = svc.reportIssue({
      requirementId: 'req-cleanup',
      runId: first.run.run_id,
      toolUseId: 'tu-1',
      input: { title: '历史问题', description: '历史问题描述', sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }] },
    })
    if (!i1.ok) throw new Error('i1')
    svc.writeResponse('req-cleanup', first.run.run_id, i1.result.issue.issue_id, '用户答复内容', 0)

    // 2. REST 删除该 Run
    const del = await authedJson(
      'DELETE',
      `/api/requirements/req-cleanup/analysis/runs/${first.run.run_id}`,
    )
    expect(del.statusCode).toBe(204)

    // 3. 启动新 Run(走 REST 完整路径,触发上下文预检)
    const start = await authedJson(
      'POST',
      '/api/requirements/req-cleanup/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(start.statusCode).toBe(201)

    // 4. assembleAnsweredContext → 应为空
    const after = svc.assembleAnsweredContext('req-cleanup', 100_000)
    expect(after.ok).toBe(true)
    if (!after.ok) return
    expect(after.items).toHaveLength(0)
  })
})