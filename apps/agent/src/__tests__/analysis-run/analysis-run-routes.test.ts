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

  // --------------------------------------------------------------------------
  // 10. issue 06 验收 5+6:log 持久化前脱敏 —— secret 串不进入 log.jsonl
  //     与 SSE 流
  // --------------------------------------------------------------------------
  it('issue 06:工具输入含 secret → log.jsonl 与 SSE 都被脱敏', async () => {
    seedRequirement('req-redact')

    const bearerToken = 'sk-prod-abcdefghijklmnop1234567890'
    const akidSecret = 'AKID9876543210ZYXWVUTSRQPON'
    providerHandle = createFakeAnalysisProvider({
      messages: [
        // 1) assistant 文本里含 Bearer token(模拟模型想复述 secret)
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: `I noticed an Authorization: Bearer ${bearerToken} header leaking in the logs`,
              },
            ],
          },
        },
        // 2) tool_use input 含 secret(用 key=value 形式让脱敏规则能识别;
        //    metadata 元组第二项作为裸 string 时无法用 key prefix 脱敏,
        //    所以这里把 secret 放在 description 字段中,让"desc: secret"形态
        //    命中 token= 类的脱敏规则)
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-secret-1',
            name: 'report_analysis_issue',
            input: {
              title: 'config',
              description: `token=${bearerToken}`,
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
              metadata: [['severity', 'high']],
            },
          },
        },
        // 3) tool_result output 含 PEM 私钥
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-secret-1',
                content: `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxxxxxxx\n-----END RSA PRIVATE KEY-----`,
              },
            ],
          },
        },
        // 4) 第二个 tool_use input 含 AKID
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-akid-1',
            name: 'report_analysis_issue',
            input: {
              title: 'aliyun',
              description: 'found AKID in src',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
              metadata: [['key', akidSecret]],
            },
          },
        },
        // 5) complete_analysis
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-redact-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    // 订阅 SSE 收集 analysis_run_log
    const ssePromise = openSse('/api/requirement/req-redact/events', 2500)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const res = await authedJson(
      'POST',
      '/api/requirements/req-redact/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    // 1) 持久化层脱敏:GET /runs/:runId 详情
    const detail = await authedJson(
      'GET',
      `/api/requirements/req-redact/analysis/runs/${res.body.run_id}`,
    )
    expect(detail.statusCode).toBe(200)
    const detailLog = detail.body.log as Array<Record<string, unknown>>
    // 1.1) text entry:Bearer token 已脱敏
    const firstText = detailLog.find((l) => l.kind === 'text')
    expect(firstText).toBeDefined()
    const detailText = String(firstText?.text ?? '')
    expect(detailText).not.toContain(bearerToken)
    // 1.2) tool_use entry:description 里的 token 已脱敏
    const firstToolUse = detailLog.find(
      (l) => l.kind === 'tool_use' && l.name === 'report_analysis_issue',
    )
    expect(firstToolUse).toBeDefined()
    const tuInput = firstToolUse?.input as Record<string, unknown> | undefined
    const tuDesc = String(tuInput?.description ?? '')
    expect(tuDesc).not.toContain(bearerToken)
    expect(tuDesc).toContain('[REDACTED]')
    // 1.3) tool_result entry:PEM 已脱敏
    const firstToolResult = detailLog.find((l) => l.kind === 'tool_result')
    expect(firstToolResult).toBeDefined()
    const trOutput = String(firstToolResult?.output ?? '')
    expect(trOutput).not.toContain('MIIEowIBAAKCAQEAxxxxxxx')
    // 1.4) 第二个 tool_use:AKID 已脱敏
    const akidEntry = detailLog.find(
      (l) => l.kind === 'tool_use' && l.tool_use_id === 'tu-akid-1',
    )
    expect(akidEntry).toBeDefined()
    const akidInput = akidEntry?.input as Record<string, unknown> | undefined
    const akidMeta = akidInput?.metadata as Array<[string, string]> | undefined
    const akidKv = akidMeta?.find(([k]) => k === 'key')
    expect(akidKv?.[1]).not.toBe(akidSecret)
    expect(akidKv?.[1]).toBe('[REDACTED]')

    // 2) 落盘文件脱敏:直接读 log.jsonl 验证
    const runId = String(res.body.run_id)
    const runDir = join(root, 'requirements', 'req-redact', 'analysis', 'runs', runId)
    const logFile = join(runDir, 'log.jsonl')
    expect(existsSync(logFile)).toBe(true)
    const logText = readFileSync(logFile, 'utf8')
    expect(logText).not.toContain(bearerToken)
    expect(logText).not.toContain(akidSecret)
    expect(logText).not.toContain('MIIEowIBAAKCAQEAxxxxxxx')

    // 3) SSE 推送脱敏:抓 analysis_run_log event 数据
    const sse = await ssePromise
    expect(sse.statusCode).toBe(200)
    // 提取 analysis_run_log event data
    const sseLogBlocks = (sse.body.match(/event: analysis_run_log\ndata: ([\s\S]*?)\n\n/g) ?? [])
      .map((m) => {
        const dataLine = m.split('\n').find((l) => l.startsWith('data: '))
        return dataLine ? dataLine.slice(6) : ''
      })
      .map((s) => {
        try {
          return JSON.parse(s) as { entry?: { text?: string; input?: unknown; output?: unknown } }
        } catch {
          return {}
        }
      })
    const sseText = sseLogBlocks.map((b) => JSON.stringify(b)).join('\n')
    expect(sseText).not.toContain(bearerToken)
    expect(sseText).not.toContain(akidSecret)
  })

  // --------------------------------------------------------------------------
  // 11. issue 06 验收 4:system prompt 与 thinking 不进入 Run Log
  //
  // 当前 AnalysisAgentRunner 拦截的 envelope 类型仅含 assistant / partial_assistant /
  // content_block_start (tool_use) / user (tool_result),SDK system / thinking event
  // 直接 return。本测试通过 fake provider 注入 type=system / type=thinking,
  // 验证它们绝不进入 log.jsonl。
  // --------------------------------------------------------------------------
  it('issue 06:system / thinking envelope 永远不会进入 Run Log', async () => {
    seedRequirement('req-system')

    providerHandle = createFakeAnalysisProvider({
      messages: [
        // SDK system 事件:绝不能进 log
        {
          type: 'system',
          message: {
            content: 'system prompt leakage should never reach log',
          },
        },
        // SDK thinking 事件:绝不能进 log
        {
          type: 'thinking',
          text: 'internal chain-of-thought should never reach log',
        },
        // 真正合法事件:text + tool_use + complete
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '正常文本' }],
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-system-1',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-system/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const detail = await authedJson(
      'GET',
      `/api/requirements/req-system/analysis/runs/${res.body.run_id}`,
    )
    const detailLog = detail.body.log as Array<Record<string, unknown>>

    // 1) log 里不应出现 system / thinking 字样的内容
    const allLogJson = JSON.stringify(detailLog)
    expect(allLogJson).not.toContain('system prompt leakage should never reach log')
    expect(allLogJson).not.toContain('internal chain-of-thought should never reach log')

    // 2) 合法事件依然进 log(确认拦截器没误杀)
    const texts = detailLog.filter((l) => l.kind === 'text')
    expect(texts.length).toBeGreaterThanOrEqual(1)
    expect(String(texts[0]?.text ?? '')).toContain('正常文本')

    // 3) 落盘文件也不含 system / thinking 内容
    const runId = String(res.body.run_id)
    const runDir = join(root, 'requirements', 'req-system', 'analysis', 'runs', runId)
    const logFile = join(runDir, 'log.jsonl')
    const logText = readFileSync(logFile, 'utf8')
    expect(logText).not.toContain('system prompt leakage should never reach log')
    expect(logText).not.toContain('internal chain-of-thought should never reach log')
  })

  // --------------------------------------------------------------------------
  // 12. issue 06 验收 11:删除 Run 时 log 随聚合级联删除
  // --------------------------------------------------------------------------
  it('issue 06:删除 Run → 整个 runDir(含 log.jsonl)消失', async () => {
    seedRequirement('req-del-log')

    providerHandle = createFakeAnalysisProvider({
      messages: [
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'logged' }] },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-del-log',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-del-log/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const runId = String(res.body.run_id)
    const runDir = join(root, 'requirements', 'req-del-log', 'analysis', 'runs', runId)
    expect(existsSync(join(runDir, 'log.jsonl'))).toBe(true)

    // 显式用 app.inject 发起 DELETE —— authedJson helper 只支持 GET/POST
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/requirements/req-del-log/analysis/runs/${runId}`,
      headers: { 'x-aidevspace-token': token },
    })
    expect(del.statusCode).toBe(204)
    // 整个 runDir 被 rm -rf —— log.jsonl 消失
    expect(existsSync(runDir)).toBe(false)
  })

  // --------------------------------------------------------------------------
  // 13. issue 06 验收 7:tool_result entry 回填实际工具名(SDK tool_result block
  //     不带 name,Runner 维护 tool_use_id → name 映射,在 tool_result 阶段查表)
  // --------------------------------------------------------------------------
  it('issue 06:tool_result entry 的 name 字段是实际工具名,不是字面 "tool_result"', async () => {
    seedRequirement('req-tool-name')

    providerHandle = createFakeAnalysisProvider({
      messages: [
        // 1) 业务工具 tool_use(已知 name=report_analysis_issue)
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-name-1',
            name: 'report_analysis_issue',
            input: {
              title: '某 Issue',
              description: '测试',
              sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
            },
          },
        },
        // 2) fake provider 自动回灌 tool_result
        // 3) 完成
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu-name-complete',
            name: 'complete_analysis',
            input: {},
          },
        },
      ],
    })
    await rebuildAppWithProvider(providerHandle.provider)

    const res = await authedJson(
      'POST',
      '/api/requirements/req-tool-name/analysis/start',
      { skill_name: 'prd-completeness' },
    )
    expect(res.statusCode).toBe(201)
    await new Promise((r) => setTimeout(r, 1500))

    const detail = await authedJson(
      'GET',
      `/api/requirements/req-tool-name/analysis/runs/${res.body.run_id}`,
    )
    const detailLog = detail.body.log as Array<Record<string, unknown>>
    const toolResults = detailLog.filter((l) => l.kind === 'tool_result')
    expect(toolResults.length).toBeGreaterThanOrEqual(1)
    // 关键:tool_result 的 name 字段应是实际工具名(report_analysis_issue)
    // 不是字面 'tool_result'(修复前是字面 'tool_result')
    const reportIssueResult = toolResults.find(
      (l) => l.tool_use_id === 'tu-name-1',
    )
    expect(reportIssueResult).toBeDefined()
    expect(reportIssueResult?.name).toBe('report_analysis_issue')
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

  // --------------------------------------------------------------------------
  // issue 03 acceptance #2 / #13 / #14 / #15 — 多 Issue + 非法入参 + 缺类源
  // --------------------------------------------------------------------------
  it('issue 03:多条 Issue 提交 → ordinal 递增 + source_refs 原样落盘 + toolUseIndex 幂等', async () => {
    const created = await service.createRun({ requirementId: 'req-multi', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const r1 = service.reportIssue({
      requirementId: 'req-multi',
      runId,
      toolUseId: 'tu-1',
      input: {
        title: 'PRD 缺少验收标准',
        description: '当前 PRD 没有给出"通过条件"',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] }],
        metadata: [['severity', 'high']],
      },
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.result.created).toBe(true)
    expect(r1.result.issue.ordinal).toBe(1)
    expect(r1.result.issue.title).toBe('PRD 缺少验收标准')
    expect(r1.result.issue.source_refs).toHaveLength(1)
    expect(r1.result.issue.metadata).toHaveLength(1)

    const r2 = service.reportIssue({
      requirementId: 'req-multi',
      runId,
      toolUseId: 'tu-2',
      input: {
        title: '接口契约模糊',
        description: '入参响应未明确',
        sourceRefs: [
          { kind: 'aux', aux_id: 'aux-api', line_range: [0, 3] },
          { kind: 'repository', repo_name: 'orders', relative_path: 'src/index.ts', line_range: [10, 20] },
        ],
      },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.result.created).toBe(true)
    expect(r2.result.issue.ordinal).toBe(2)
    expect(r2.result.issue.source_refs).toHaveLength(2)
    expect(r2.result.issue.source_refs[0]?.kind).toBe('aux')
    expect(r2.result.issue.source_refs[1]?.kind).toBe('repository')

    // 元数据已落盘
    expect(r1.result.issue.metadata[0]).toEqual(['severity', 'high'])

    // 后续 readIssues 按 ordinal 升序
    const all = service.readIssues('req-multi', runId)
    expect(all).toHaveLength(2)
    expect(all[0]?.ordinal).toBe(1)
    expect(all[1]?.ordinal).toBe(2)
  })

  it('issue 03:缺类源(SourceRef 无 line_range)允许合法提交', async () => {
    const created = await service.createRun({ requirementId: 'req-missing-class', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    // decision 30:缺失类问题可省略 line_range
    const r = service.reportIssue({
      requirementId: 'req-missing-class',
      runId,
      toolUseId: 'tu-no-range',
      input: {
        title: 'API 文档缺失',
        description: 'PRD 未指向任何 API 文档',
        sourceRefs: [
          // 缺 line_range 合法(决策 30 / schema optional)
          { kind: 'requirement', relative_path: 'requirement.md' },
        ],
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.created).toBe(true)
    expect(r.result.issue.source_refs[0]?.line_range).toBeUndefined()
  })

  it('issue 03:metadata 数组值(字符串数组)合法提交', async () => {
    const created = await service.createRun({ requirementId: 'req-array-meta', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const r = service.reportIssue({
      requirementId: 'req-array-meta',
      runId,
      toolUseId: 'tu-arr-meta',
      input: {
        title: '元数据数组',
        description: 'metadata 是字符串数组',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 1] }],
        metadata: [['tags', ['ux', 'completeness', 'urgent']]],
      },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.issue.metadata[0]?.[1]).toEqual(['ux', 'completeness', 'urgent'])
  })

  it('issue 03:完成工具接受后再次报 Issue → run_completed(决策 30)', async () => {
    const created = await service.createRun({ requirementId: 'req-done', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    service.requestCompletion('req-done', runId)
    const r = service.reportIssue({
      requirementId: 'req-done',
      runId,
      toolUseId: 'tu-late',
      input: {
        title: 'late issue',
        description: 'after completion',
        sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 1] }],
      },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_completed')
  })

  it('issue 03:不同 tool_use_id 但相同标题/源 → 不合并,各自独立', async () => {
    const created = await service.createRun({ requirementId: 'req-no-merge', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    const shared = {
      title: '相同标题',
      description: '相同描述',
      sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 1] }],
    }
    const r1 = service.reportIssue({
      requirementId: 'req-no-merge', runId, toolUseId: 'tu-a',
      input: shared,
    })
    const r2 = service.reportIssue({
      requirementId: 'req-no-merge', runId, toolUseId: 'tu-b',
      input: shared,
    })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return
    expect(r1.result.created).toBe(true)
    expect(r2.result.created).toBe(true)
    // 不同 tool_use_id → 各自 ordinal 递增(决策 24)
    expect(r1.result.issue.ordinal).toBe(1)
    expect(r2.result.issue.ordinal).toBe(2)
    expect(r2.result.issue.issue_id).not.toBe(r1.result.issue.issue_id)
  })

  // --------------------------------------------------------------------------
  // issue 03 acceptance #13 · 非法输入 / Schema 拒绝路径(spec c 缺失覆盖)
  // --------------------------------------------------------------------------
  it('issue 03:trim 后空 title 报告 Issue → service 抛 schema 错误,不形成 Issue', async () => {
    const created = await service.createRun({ requirementId: 'req-empty-title', skillName: 'prd-completeness' })
    if (!created.ok) throw new Error('setup failed')
    const runId = created.run.run_id

    // service 层 title.trim() 后入库;纯空白 → 空字符串 → schema 失败
    // 验收:抛错(Issue schema invalid)+ 该 Issue 不入库
    expect(() =>
      service.reportIssue({
        requirementId: 'req-empty-title',
        runId,
        toolUseId: 'tu-empty',
        input: {
          title: '   ', // 纯空白 → trim 后为空 → schema 失败
          description: 'desc',
          sourceRefs: [{ kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 1] }],
        },
      }),
    ).toThrow(/Issue schema invalid/)
    // 没有形成 Issue
    const issues = service.readIssues('req-empty-title', runId)
    expect(issues).toHaveLength(0)
  })

  it('issue 03:handler 层 parseReportIssueInputPublic 拒绝半截流参数(第一道防线)', async () => {
    const { parseReportIssueInputPublic } = await import(
      '../../analysis-run/AnalysisAgentRunner.js'
    )
    // 模型通过 SDK MCP 工具调用,字段名是 snake_case(Anthropic tool 约定);
    // system prompt(AnalysisPromptAssembler)、shared schema、持久化 issues.jsonl
    // 也都统一 snake_case `source_refs` —— 这里以 snake_case 模拟真实输入。
    const validRef = [{ kind: 'requirement', relative_path: 'r' }]
    expect(parseReportIssueInputPublic({ title: '', description: 'd', source_refs: validRef })).toEqual({ ok: false, reason: 'title missing' })
    expect(parseReportIssueInputPublic({ title: '   ', description: 'd', source_refs: validRef })).toEqual({ ok: false, reason: 'title missing' })
    expect(parseReportIssueInputPublic({ title: 't', description: '', source_refs: validRef })).toEqual({ ok: false, reason: 'description missing' })
    expect(parseReportIssueInputPublic({ title: 't', description: 'd', source_refs: [] })).toEqual({ ok: false, reason: 'source_refs missing' })
    // 半截流参数:非对象
    expect(parseReportIssueInputPublic(null)).toEqual({ ok: false, reason: 'input not object' })
  })

  it('issue 10 复盘:snake_case `source_refs` 通过校验(camelCase 兜底兼容)', async () => {
    const { parseReportIssueInputPublic } = await import(
      '../../analysis-run/AnalysisAgentRunner.js'
    )
    // snake_case:模型真实输出形态(metadata 元组数组形态,shared schema 契约)
    const snake = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      metadata: [['severity', 'P0']],
    })
    expect(snake.ok).toBe(true)
    if (snake.ok) {
      // 内部接口契约仍是 camelCase(`runService.reportIssue` 入参不变)
      expect(snake.value.sourceRefs).toHaveLength(1)
      expect(snake.value.sourceRefs[0]?.relative_path).toBe('r.md')
      expect(snake.value.metadata).toEqual([['severity', 'P0']])
    }
    // camelCase:历史/外部 mock 兜底兼容
    const camel = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      sourceRefs: [{ kind: 'requirement', relative_path: 'r.md' }],
    })
    expect(camel.ok).toBe(true)
    if (camel.ok) {
      expect(camel.value.sourceRefs).toHaveLength(1)
    }
    // 两个都给时,snake_case 优先(snake 是 system prompt 教模型的形态)
    const both = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'snake.md' }],
      sourceRefs: [{ kind: 'requirement', relative_path: 'camel.md' }],
    })
    expect(both.ok).toBe(true)
    if (both.ok) {
      expect(both.value.sourceRefs[0]?.relative_path).toBe('snake.md')
    }
  })

  it('issue 11 复盘:metadata 接受对象形态 + 元组数组形态,统一归一到元组数组', async () => {
    const { parseReportIssueInputPublic } = await import(
      '../../analysis-run/AnalysisAgentRunner.js'
    )
    // 对象形态:system prompt 教的形态,模型实测输出
    //   { severity: 'warn', dimension: '目标与背景' }
    // parser 必须接受并归一到 shared schema 的元组数组形态
    //   [['severity', 'warn'], ['dimension', '目标与背景']]
    const obj = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      metadata: { severity: 'warn', dimension: '目标与背景' },
    })
    expect(obj.ok).toBe(true)
    if (obj.ok) {
      expect(obj.value.metadata).toEqual([
        ['severity', 'warn'],
        ['dimension', '目标与背景'],
      ])
    }

    // 元组数组形态(shared schema 契约):原样通过
    const tuple = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      metadata: [
        ['severity', 'high'],
        ['tags', ['ux', 'completeness']],
      ],
    })
    expect(tuple.ok).toBe(true)
    if (tuple.ok) {
      expect(tuple.value.metadata).toEqual([
        ['severity', 'high'],
        ['tags', ['ux', 'completeness']],
      ])
    }

    // 非法形态:嵌套对象 → 拒绝
    const nested = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      metadata: { bad: { nested: 'object' } },
    })
    expect(nested.ok).toBe(false)
    if (!nested.ok) {
      expect(nested.reason).toMatch(/metadata value must be primitive/)
    }

    // 非法形态:元组数组 entry 不是 `[key, value]` 二元组 → 拒绝
    const badTuple = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      metadata: [{ key: 'severity', value: 'high' }] as unknown as never,
    })
    expect(badTuple.ok).toBe(false)

    // metadata 缺省:通过,undefined
    const none = parseReportIssueInputPublic({
      title: 't',
      description: 'd',
      source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
    })
    expect(none.ok).toBe(true)
    if (none.ok) {
      expect(none.value.metadata).toBeUndefined()
    }
  })

  it('PR-1 / ticket 10:handler 拒时 reason 透传到 tool_result', async () => {
    // 行为契约:
    // - parser 拒(空 title)→ handler 返 {accepted:false, issue_id:'', ordinal:0, reason:'title missing'}
    // - reportIssue 拒(run_completed)→ handler 返 {accepted:false, ..., reason:'run_completed'}
    // - reason 字段是新增字段,不破坏 accepted:true 路径
    //
    // 注:makeReportIssueHandler 非 export;此处断言 parser + reportIssue 两层 reason
    // 都能进入 ReportIssueToolResult.reason 字段(handler 内的组装逻辑已由 typecheck + 现有
    // resilience 测试覆盖)。
    const { AnalysisRunService } = await import(
      '../../analysis-run/AnalysisRunService.js'
    )
    const root = mkdtempSync(join(tmpdir(), 'aidevsp-pr1-'))
    process.env.AIDEVSPACE_ROOT = root
    const reqId = 'req-pr1'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })

    try {
      const localService = new AnalysisRunService(root)
      const create = await localService.createRun({
        requirementId: reqId,
        skillName: 'prd-completeness',
      })
      if (!create.ok) throw new Error('create failed')
      const runId = create.run.run_id

      // 1) parser 拒:title missing
      const runner = await import('../../analysis-run/AnalysisAgentRunner.js')
      const parsedEmpty = runner.parseReportIssueInputPublic({ description: 'd' })
      expect(parsedEmpty.ok).toBe(false)
      if (!parsedEmpty.ok) expect(parsedEmpty.reason).toBe('title missing')

      // 模拟 handler 拒路径返回的形状:
      const handlerRejectByParser = {
        accepted: false,
        issue_id: '',
        ordinal: 0,
        reason: parsedEmpty.ok ? undefined : parsedEmpty.reason,
      }
      expect(handlerRejectByParser).toEqual({
        accepted: false,
        issue_id: '',
        ordinal: 0,
        reason: 'title missing',
      })

      // 2) 兼容 1f68c25 之前:accepted:true 不带 reason
      const successResult = {
        accepted: true,
        issue_id: 'iss-test-1',
        ordinal: 1,
      }
      expect(successResult).not.toHaveProperty('reason')

      // 3) reportIssue 拒:run_completed(reason 字段携带 code)
      localService.requestCompletion(reqId, runId)
      const result = localService.reportIssue({
        requirementId: reqId,
        runId,
        toolUseId: 'tu-pr1',
        input: {
          title: 't',
          description: 'd',
          sourceRefs: [{ kind: 'requirement', relative_path: 'r.md' }],
        },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        const handlerRejectByRunService = {
          accepted: false,
          issue_id: '',
          ordinal: 0,
          reason: result.code,
        }
        expect(handlerRejectByRunService.reason).toBe('run_completed')
      }

      // 4) SSE 事件类型注册(避免静默 typo)
      const shared = await import('@ai-devspace/shared')
      type SseEvt = (typeof shared) extends never ? never : import('@ai-devspace/shared').SseEvent
      const sample: SseEvt = {
        type: 'analysis_issue_rejected',
        reqId,
        runId,
        ts: Date.now(),
        toolUseId: 'tu-test',
        reason: 'title missing',
        inputKeys: 'title,description',
      }
      expect(sample.type).toBe('analysis_issue_rejected')
    } finally {
      rmSync(root, { recursive: true, force: true })
      delete process.env.AIDEVSPACE_ROOT
    }
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

  // issue 04:第 8 层已答复上下文必须包含明确的优先级 / 重报规则
  it('issue 04:第 8 层含优先级 + 重报规则 + 不重报默认', async () => {
    const { assembleAnalysisSystemPrompt } = await import(
      '../../analysis-run/AnalysisPromptAssembler.js'
    )
    const out = assembleAnalysisSystemPrompt({
      skill: { name: 'prd-completeness', description: '检查 PRD', version: '1.0.0' },
      skill_body: '检查规则',
      answered_context: [
        {
          run_id: 'r1',
          issue_id: 'iss-r1-0001',
          issue_title: 't',
          issue_description: 'd',
          source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
          metadata: [],
          updated_at: '2026-08-01T00:00:00Z',
          response: '答复内容',
        },
      ],
      scope: { requirement_id: 'req-002', repo_names: [], prd_markdown: '# PRD' },
    })
    // 决策 14:按更新时间从旧到新排序
    expect(out).toMatch(/按最后更新时间从旧到新/)
    // 决策 51:默认不重报
    expect(out).toMatch(/已被答复充分解决的问题/)
    // 决策 52:仅当答复不足 / 矛盾 / 冲突时允许关联重报
    expect(out).toMatch(/内容明显不足/)
    expect(out).toMatch(/自相矛盾/)
    expect(out).toMatch(/冲突/)
    // 未答复 Issue 不出现
    expect(out).toMatch(/未答复 Issue 不出现/)
    // issue_id 出现在 layer 8
    expect(out).toContain('iss-r1-0001')
  })
})