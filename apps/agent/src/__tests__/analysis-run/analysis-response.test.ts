/**
 * Issue Response service + REST routes tests(issue 04 · ADR-0021)
 *
 * 覆盖验收点:
 * - 1:每条 Issue 最多关联一份 Response;Response 与 Issue 分离保存
 * - 2:任意未删除历史 Run 的 Issue 都可新增或编辑 Response
 * - 3:trim 后非空即视为已答复;不存在草稿/确认/裁决状态
 * - 7:并发保存按单调编辑版本,旧请求不会覆盖更新正文
 * - 9:开始分析前等待全部最新 Response 持久化(服务端 409 stale_response)
 * - 11:新 Run 只注入未删除 Run 中已答复 Issue + Response 原文
 * - 12:未答复 Issue / Run Log / 旧 ANALYZING 产物不进入 prompt
 * - 13:答复按更新时间稳定排序
 * - 14:已充分答复的问题默认不重报(由 prompt 注释保证,服务端只组装)
 * - 15:超预算 → context_overflow;不截断 / 不总结 / 不取最近
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { TokenManager } from '../../auth/TokenManager.js'
import { authPlugin } from '../../auth/authPlugin.js'
import { AnalysisRunService, MAX_ANSWERED_CONTEXT_CHARS } from '../../analysis-run/AnalysisRunService.js'
import { analysisResponseRoutes } from '../../routes/analysis-response.js'

let app: FastifyInstance
let token: string
let root: string

async function authedJson(
  method: 'GET' | 'PUT',
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

/** seed 一个 Requirement 的 PRD + 一个 running Run + N 条 Issue */
async function seedRunWithIssues(opts: {
  reqId: string
  issueCount: number
}): Promise<{ runId: string; issueIds: string[]; service: AnalysisRunService }> {
  const service = new AnalysisRunService(root)
  const reqDir = join(root, 'requirements', opts.reqId)
  mkdirSync(reqDir, { recursive: true })
  writeFileSync(join(reqDir, 'requirement.md'), '# Test PRD\n', 'utf8')

  const created = await service.createRun({
    requirementId: opts.reqId,
    skillName: 'prd-completeness',
  })
  if (!created.ok) throw new Error('createRun failed')
  const runId = created.run.run_id
  // 终结到 succeeded 以便后续可写 Response
  service.requestCompletion(opts.reqId, runId)
  service.transitionToSucceeded(opts.reqId, runId)

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
  return { runId, issueIds, service }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-resp-'))
  process.env.AIDEVSPACE_ROOT = root

  const tm = new TokenManager(root)
  token = await tm.ensure()

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(analysisResponseRoutes, {
    workspaceRoot: root,
    runService: new AnalysisRunService(root),
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
  delete process.env.AIDEVSPACE_ROOT
})

// ============================================================================
// Service-level tests(直接调 AnalysisRunService.writeResponse / readResponse / listResponses / assembleAnsweredContext)
// ============================================================================

describe('AnalysisRunService.writeResponse / readResponse / listResponses', () => {
  it('首写响应 → edit_version=1 + answered=true', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w1', issueCount: 1 })
    const w = service.writeResponse('req-w1', runId, issueIds[0]!, '我的答复', 0)
    expect(w.ok).toBe(true)
    if (!w.ok) return
    expect(w.result.edit_version).toBe(1)
    expect(w.result.answered).toBe(true)
    expect(w.result.created_at).toBe(w.result.updated_at)

    const r = service.readResponse('req-w1', runId, issueIds[0]!)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.response).not.toBeNull()
    expect(r.response!.body).toBe('我的答复')
    expect(r.response!.edit_version).toBe(1)
    expect(r.response!.answered).toBe(true)
  })

  it('空字符串 / 纯空白 → answered=false', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w2', issueCount: 1 })
    const w = service.writeResponse('req-w2', runId, issueIds[0]!, '   \n\n  ', 0)
    expect(w.ok).toBe(true)
    if (!w.ok) return
    expect(w.result.answered).toBe(false)

    const r = service.readResponse('req-w2', runId, issueIds[0]!)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.response!.body).toBe('   \n\n  ')
    expect(r.response!.answered).toBe(false)
  })

  it('并发保存:base 不匹配 → stale_response,不覆盖', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w3', issueCount: 1 })
    const w1 = service.writeResponse('req-w3', runId, issueIds[0]!, 'first', 0)
    expect(w1.ok).toBe(true)
    if (!w1.ok) return
    const v1 = w1.result.edit_version // = 1

    // 模拟客户端 A 用 base=v1 提交
    const wA = service.writeResponse('req-w3', runId, issueIds[0]!, 'from-A', v1)
    expect(wA.ok).toBe(true)
    if (!wA.ok) return
    // 此时版本变为 2
    // 模拟客户端 B 用旧 base=v1 提交(应被拒)
    const wB = service.writeResponse('req-w3', runId, issueIds[0]!, 'from-B', v1)
    expect(wB.ok).toBe(false)
    if (wB.ok) return
    expect(wB.code).toBe('stale_response')
    expect(wB.current?.edit_version).toBe(2)

    // 最终内容是 A 的写入,不是 B 的旧请求
    const r = service.readResponse('req-w3', runId, issueIds[0]!)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.response!.body).toBe('from-A')
    expect(r.response!.edit_version).toBe(2)
  })

  it('同 Issue 多次编辑 → edit_version 单调递增 + updated_at 推进', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w4', issueCount: 1 })
    const w1 = service.writeResponse('req-w4', runId, issueIds[0]!, 'v1', 0)
    if (!w1.ok) throw new Error('w1 failed')
    await new Promise((r) => setTimeout(r, 5))
    const w2 = service.writeResponse('req-w4', runId, issueIds[0]!, 'v2', 1)
    expect(w2.ok).toBe(true)
    if (!w2.ok) return
    expect(w2.result.edit_version).toBe(2)
    expect(w2.result.created_at).toBe(w1.result.created_at)
    expect(w2.result.updated_at > w1.result.updated_at).toBe(true)
  })

  it('响应文件 + meta 分开落盘', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w5', issueCount: 1 })
    service.writeResponse('req-w5', runId, issueIds[0]!, 'hi', 0)
    const responsesDir = join(root, 'requirements', 'req-w5', 'analysis', 'runs', runId, 'responses')
    expect(existsSync(join(responsesDir, `${issueIds[0]}.md`))).toBe(true)
    expect(existsSync(join(responsesDir, `${issueIds[0]}.meta.yaml`))).toBe(true)
    const md = readFileSync(join(responsesDir, `${issueIds[0]}.md`), 'utf8')
    expect(md).toBe('hi')
  })

  it('写响应不会修改 issues.jsonl(原始 Issue 保持不变)', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-w6', issueCount: 1 })
    service.writeResponse('req-w6', runId, issueIds[0]!, 'resp', 0)
    const issues = service.readIssues('req-w6', runId)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.issue_id).toBe(issueIds[0])
    // 原始字段未被改写
    expect(issues[0]!.title).toBe('Issue 1')
  })

  it('issue_not_found:Issue id 不在该 Run → 拒绝', async () => {
    const { runId, service } = await seedRunWithIssues({ reqId: 'req-w7', issueCount: 1 })
    const w = service.writeResponse('req-w7', runId, 'iss-fake', 'x', 0)
    expect(w.ok).toBe(false)
    if (w.ok) return
    expect(w.code).toBe('issue_not_found')
  })

  it('run_not_found:Run 不存在 → 拒绝', async () => {
    const service = new AnalysisRunService(root)
    const w = service.writeResponse('req-missing', 'run-missing', 'iss-x', 'x', 0)
    expect(w.ok).toBe(false)
    if (w.ok) return
    expect(w.code).toBe('run_not_found')
  })

  it('listResponses 仅包含已答复 + 按 updated_at 升序', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-list', issueCount: 3 })
    // 按倒序填写(模拟"后来更新")
    service.writeResponse('req-list', runId, issueIds[2]!, 'r3', 0)
    await new Promise((r) => setTimeout(r, 5))
    service.writeResponse('req-list', runId, issueIds[1]!, 'r2', 0)
    await new Promise((r) => setTimeout(r, 5))
    // issue[0] 不填 → 未答复,不应出现在列表
    const list = service.listResponses('req-list')
    expect(list).toHaveLength(2)
    // 排序:较早的 updated_at 在前
    expect(list[0]!.body).toBe('r3')
    expect(list[1]!.body).toBe('r2')
    expect(list[0]!.updated_at <= list[1]!.updated_at).toBe(true)
  })

  it('listResponses:不同 Run 的已答复按 updated_at 升序合并', async () => {
    const service = new AnalysisRunService(root)
    mkdirSync(join(root, 'requirements', 'req-multi'), { recursive: true })
    writeFileSync(join(root, 'requirements', 'req-multi', 'requirement.md'), '# x', 'utf8')

    const r1 = await service.createRun({ requirementId: 'req-multi', skillName: 'prd-completeness' })
    if (!r1.ok) throw new Error('c1')
    service.requestCompletion('req-multi', r1.run.run_id)
    service.transitionToSucceeded('req-multi', r1.run.run_id)
    await new Promise((r) => setTimeout(r, 20)) // 等待 fire-and-forget 释放 startup lock
    const r1id = r1.run.run_id
    const i1 = service.reportIssue({
      requirementId: 'req-multi', runId: r1id, toolUseId: 'tu-1',
      input: { title: 'A', description: 'd', sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }] },
    })
    if (!i1.ok) throw new Error('i1')
    service.writeResponse('req-multi', r1id, i1.result.issue.issue_id, 'first-run', 0)

    const r2 = await service.createRun({ requirementId: 'req-multi', skillName: 'prd-completeness' })
    if (!r2.ok) throw new Error(`c2 failed: ${r2.code}`)
    service.requestCompletion('req-multi', r2.run.run_id)
    service.transitionToSucceeded('req-multi', r2.run.run_id)
    await new Promise((r) => setTimeout(r, 20))
    const r2id = r2.run.run_id
    const i2 = service.reportIssue({
      requirementId: 'req-multi', runId: r2id, toolUseId: 'tu-2',
      input: { title: 'B', description: 'd', sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }] },
    })
    if (!i2.ok) throw new Error('i2')
    await new Promise((r) => setTimeout(r, 10))
    service.writeResponse('req-multi', r2id, i2.result.issue.issue_id, 'second-run', 0)

    const list = service.listResponses('req-multi')
    expect(list).toHaveLength(2)
    expect(list[0]!.body).toBe('first-run')
    expect(list[1]!.body).toBe('second-run')
  })
})

describe('AnalysisRunService.assembleAnsweredContext', () => {
  it('无答复 → 空列表 + totalChars=0', async () => {
    const service = new AnalysisRunService(root)
    mkdirSync(join(root, 'requirements', 'req-empty'), { recursive: true })
    writeFileSync(join(root, 'requirements', 'req-empty', 'requirement.md'), '# x', 'utf8')
    const r = service.assembleAnsweredContext('req-empty', 1000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toHaveLength(0)
    expect(r.totalChars).toBe(0)
  })

  it('含答复 → items 携带原始 Issue + Response + source_refs + metadata', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-asm', issueCount: 1 })
    service.writeResponse('req-asm', runId, issueIds[0]!, '详细答复内容', 0)
    const r = service.assembleAnsweredContext('req-asm', 100_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toHaveLength(1)
    const item = r.items[0]!
    expect(item.run_id).toBe(runId)
    expect(item.issue_id).toBe(issueIds[0])
    expect(item.issue_title).toBe('Issue 1')
    expect(item.issue_description).toBe('desc 1')
    expect(item.response).toBe('详细答复内容')
    expect(item.source_refs).toHaveLength(1)
    expect(item.source_refs[0]!.kind).toBe('requirement')
  })

  it('超过预算 → context_overflow,绝不截断 / 不取最近', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-over', issueCount: 1 })
    service.writeResponse('req-over', runId, issueIds[0]!, '短答复', 0)
    const r = service.assembleAnsweredContext('req-over', 10)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('context_overflow')
    expect(r.maxChars).toBe(10)
    expect(r.totalChars).toBeGreaterThan(10)
  })

  it('排序稳定:同时间戳 → 按 issue_id 字典序', async () => {
    const { runId, issueIds, service } = await seedRunWithIssues({ reqId: 'req-sort', issueCount: 2 })
    // 在同一毫秒窗口写入两次
    service.writeResponse('req-sort', runId, issueIds[0]!, 'A', 0)
    service.writeResponse('req-sort', runId, issueIds[1]!, 'B', 0)
    const r = service.assembleAnsweredContext('req-sort', 100_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toHaveLength(2)
    // issue_ids 一般是 iss-runId-0001 / 0002 → 按字典序 A 在前
    expect(r.items[0]!.issue_id < r.items[1]!.issue_id).toBe(true)
  })

  it('MAX_ANSWERED_CONTEXT_CHARS 默认值是合理上限', () => {
    // 决策 15:Claude 当前 model 上限 ~200k token;答复一层 80k 字符 ≈ 25-30k token 的安全预算
    expect(MAX_ANSWERED_CONTEXT_CHARS).toBe(80_000)
  })
})

// ============================================================================
// REST route tests
// ============================================================================

describe('Issue Response REST endpoints', () => {
  it('401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req/analysis/responses',
    })
    expect(res.statusCode).toBe(401)
  })

  it('GET 单条 Response(未填)→ body="", edit_version=0, answered=false', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-g1', issueCount: 1 })
    const res = await authedJson(
      'GET',
      `/api/requirements/req-g1/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.body).toBe('')
    expect(res.body.edit_version).toBe(0)
    expect(res.body.answered).toBe(false)
  })

  it('PUT 首写 → 200 + edit_version=1', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-p1', issueCount: 1 })
    const res = await authedJson(
      'PUT',
      `/api/requirements/req-p1/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: '第一次答复', base_edit_version: 0 },
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.edit_version).toBe(1)
    expect(res.body.answered).toBe(true)
  })

  it('PUT base 不匹配 → 409 stale_response + current 信息', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-p2', issueCount: 1 })
    // 第一次
    await authedJson(
      'PUT',
      `/api/requirements/req-p2/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: 'first', base_edit_version: 0 },
    )
    // 第二次用旧 base=0 提交 → 409
    const res = await authedJson(
      'PUT',
      `/api/requirements/req-p2/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: 'stale', base_edit_version: 0 },
    )
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('stale_response')
    expect((res.body.current as { edit_version: number }).edit_version).toBe(1)
  })

  it('PUT 递增 base → 200', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-p3', issueCount: 1 })
    await authedJson(
      'PUT',
      `/api/requirements/req-p3/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: 'v1', base_edit_version: 0 },
    )
    const res = await authedJson(
      'PUT',
      `/api/requirements/req-p3/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: 'v2', base_edit_version: 1 },
    )
    expect(res.statusCode).toBe(200)
    expect(res.body.edit_version).toBe(2)
  })

  it('PUT 缺 body → 400 bad_request', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-p4', issueCount: 1 })
    const res = await authedJson(
      'PUT',
      `/api/requirements/req-p4/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { base_edit_version: 0 },
    )
    expect(res.statusCode).toBe(400)
  })

  it('PUT Issue 不存在 → 404 analysis_issue_not_found', async () => {
    const { runId } = await seedRunWithIssues({ reqId: 'req-p5', issueCount: 1 })
    const res = await authedJson(
      'PUT',
      `/api/requirements/req-p5/analysis/runs/${runId}/issues/iss-fake/response`,
      { body: 'x', base_edit_version: 0 },
    )
    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('analysis_issue_not_found')
  })

  it('PUT Run 不存在 → 404 analysis_run_not_found', async () => {
    const res = await authedJson(
      'PUT',
      '/api/requirements/req-p6/analysis/runs/run-bad/issues/iss-x/response',
      { body: 'x', base_edit_version: 0 },
    )
    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('analysis_run_not_found')
  })

  it('GET 列响应 → 仅含已答复', async () => {
    const { runId, issueIds } = await seedRunWithIssues({ reqId: 'req-list-r', issueCount: 3 })
    await authedJson(
      'PUT',
      `/api/requirements/req-list-r/analysis/runs/${runId}/issues/${issueIds[0]}/response`,
      { body: 'r1', base_edit_version: 0 },
    )
    await authedJson(
      'PUT',
      `/api/requirements/req-list-r/analysis/runs/${runId}/issues/${issueIds[1]}/response`,
      { body: '', base_edit_version: 0 }, // 空字符串 → 未答复
    )
    const res = await authedJson('GET', '/api/requirements/req-list-r/analysis/responses')
    expect(res.statusCode).toBe(200)
    const list = res.body.responses as Array<Record<string, unknown>>
    expect(list).toHaveLength(1)
    expect(list[0]!.body).toBe('r1')
  })
})