/**
 * ANALYZING 工位 Agent REST endpoints(ADR-0013 D2 ② · issue 19b/19e/19f)
 *
 * 当前 slice(19b VS2)只覆盖:
 * - POST /api/requirements/:id/analysis/interject —— 用户插话,启动 admission-check
 *   Skill → 产生新 chunks → 通过 SseHub.publish 推给该 reqId 的所有 SSE 订阅者
 *
 * 后续 slice(19e/19f)再扩展:
 * - POST /api/requirements/:id/analysis/regenerate  -- 重扫
 * - POST /api/requirements/:id/analysis/adjudicate  -- 裁决写入 + 应用
 * - POST /api/requirements/:id/analysis/generate-brief -- 生成技术概要
 *
 * 设计要点:
 * - 接受 { text, session_id } body,缺失字段 → 400
 * - 返回 202(Accepted)+ ack —— chunks 是异步通过 SSE 推到客户端的,不阻塞 POST 返回
 * - 当前 mock 阶段没有真实 Skill runtime,模拟 admission-check Skill 收到用户输入后
 *   产生 1-2 条 acknowledgment chunk + 1 条 THINK chunk;真实 Skill 接通后此函数替换为
 *   Skill runner 调用
 */

import type { FastifyPluginAsync } from 'fastify'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SseHub } from '../sse/SseHub.js'

export interface AnalysisRoutesOptions {
  hub: SseHub
}

interface InterjectBody {
  text?: unknown
  session_id?: unknown
}

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** 模拟 admission-check Skill 在收到用户插话后的输出 chunks。
 *  真实 Skill 接通后,此处替换为 Skill runner 调用,返回值不变。 */
function simulateInterjectChunks(params: {
  requirementId: string
  sessionId: string
  userText: string
}): { ts: number; type: 'analysis_chunk'; reqId: string; sessionId: string; chunk: { id: string; ts: string; label: string; kind: 'narration' | 'subproblem' | 'risk' | 'option'; tone: 'info' | 'success' | 'warn' | 'err'; text: string } }[] {
  const now = new Date()
  const tsStr = now.toTimeString().slice(0, 8) // HH:MM:SS
  const minute = now.getMinutes().toString().padStart(2, '0')
  const second = now.getSeconds().toString().padStart(2, '0')
  const stamp = `${now.getHours().toString().padStart(2, '0')}:${minute}:${second}`
  void tsStr
  return [
    {
      ts: Date.now(),
      type: 'analysis_chunk',
      reqId: params.requirementId,
      sessionId: params.sessionId,
      chunk: {
        id: `c-interject-${Date.now()}-ack`,
        ts: stamp,
        label: 'INFER',
        kind: 'narration',
        tone: 'info',
        text: `已接收用户插话:${params.userText.slice(0, 32)}${params.userText.length > 32 ? '…' : ''}`,
      },
    },
    {
      ts: Date.now() + 1,
      type: 'analysis_chunk',
      reqId: params.requirementId,
      sessionId: params.sessionId,
      chunk: {
        id: `c-interject-${Date.now()}-think`,
        ts: stamp,
        label: 'THINK',
        kind: 'narration',
        tone: 'info',
        text: '正在基于用户输入重新评估准入维度...',
      },
    },
  ]
}

export const analysisRoutes: FastifyPluginAsync<AnalysisRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { hub } = opts

  fastify.post<{
    Params: { id: string }
    Body: InterjectBody
  }>('/api/requirements/:id/analysis/interject', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    if (!isNonEmptyString(body.text)) {
      return reply.code(400).send(badRequest('text is required and must be non-empty'))
    }
    if (!isNonEmptyString(body.session_id)) {
      return reply.code(400).send(badRequest('session_id is required and must be non-empty'))
    }

    const userText = body.text
    const sessionId = body.session_id

    // 模拟 admission-check Skill 收到用户输入,产出新 chunks;通过 SseHub 推送
    const chunks = simulateInterjectChunks({
      requirementId: id,
      sessionId,
      userText,
    })
    for (const ev of chunks) {
      hub.publish(id, ev)
    }

    return reply.code(202).send({
      status: 'accepted',
      requirementId: id,
      sessionId,
      chunksQueued: chunks.length,
    })
  })

  // ============================================================================
  // POST /api/requirements/:id/analysis/generate-brief
  // 双产物落盘(ADR-0013 D8 + 决策 71)
  // 启动 tech-brief-scaffold Skill(本期 mock)→ 写 technical-brief.md + modules.yaml
  // 写前自动 snapshot(决策 47 + ADR-0009 第 4 层)
  // 失败回滚:snapshot 文件可被 StatusBar [↶↶ 回滚本次会话全部] 找回
  // ============================================================================

  fastify.post<{
    Params: { id: string }
    Body: GenerateBriefBody
  }>('/api/requirements/:id/analysis/generate-brief', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    if (!isNonEmptyString(body.session_id)) {
      return reply.code(400).send(badRequest('session_id is required and must be non-empty'))
    }
    const sessionId = body.session_id

    // 1. 计算 analysis 目录:AIDEVSPACE_ROOT/requirements/<id>/analysis
    const root = process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()
    const analysisDir = join(root, 'requirements', id, 'analysis')
    if (!existsSync(analysisDir)) {
      mkdirSync(analysisDir, { recursive: true })
    }

    // 2. 写前 snapshot(决策 47 + ADR-0009 第 4 层)
    //    一次 generate-brief 操作共享同一 ts 目录(snapshot-bundle),便于回滚
    const snapshotTs = new Date().toISOString().replace(/[:.]/g, '-')
    snapshotBeforeWriteAgent(analysisDir, 'technical-brief.md', snapshotTs)
    snapshotBeforeWriteAgent(analysisDir, 'modules.yaml', snapshotTs)

    // 3. 启动 tech-brief-scaffold Skill(本期 mock)→ 生成双产物
    const artifacts = buildMockBriefArtifacts(sessionId)

    // 4. 写双文件(直接覆盖,无版本号,决策 71)
    //    任一文件写失败 → 整个操作失败,旧版靠 snapshot 找回(决策 46 第 3 层)
    const briefPath = join(analysisDir, 'technical-brief.md')
    const modulesPath = join(analysisDir, 'modules.yaml')
    try {
      writeFileSync(briefPath, artifacts.brief, 'utf8')
      writeFileSync(modulesPath, serializeModulesYamlForAgent(artifacts.modules), 'utf8')
    } catch (err) {
      fastify.log.error(
        { err, requirementId: id, analysisDir },
        'generate-brief write failed; old versions retrievable via snapshot',
      )
      return reply.code(500).send({
        ok: false,
        error: 'write_failed',
        reason: err instanceof Error ? err.message : String(err),
        hint: '已通过 snapshot 保留生成前版本;可通过 StatusBar [↶↶ 回滚本次会话全部] 找回',
      })
    }

    // 5. 返回路径与时间戳(ISO 8601)
    const generatedAt = new Date().toISOString()
    return reply.code(200).send({
      ok: true,
      requirementId: id,
      sessionId,
      brief_path: briefPath,
      modules_path: modulesPath,
      generated_at: generatedAt,
    })
  })
}

// ============================================================================
// 双产物生成 helpers(本期 mock — 真实 Skill 接通后整体替换)
// ============================================================================

interface GenerateBriefBody {
  session_id?: unknown
}

interface MockModule {
  id: string
  name: string
  description: string
  deps: string[]
  complexity: 'low' | 'medium' | 'high'
  clarifying_questions?: {
    id: string
    question: string
    options?: string[]
    required?: boolean
  }[]
}

interface MockArtifacts {
  brief: string
  modules: { modules: MockModule[] }
}

/** 模拟 tech-brief-scaffold Skill 输出(本期替代真实 Skill runtime)。
 *  真实 Skill 接通后,此函数整体替换为 Skill runner 调用,接口不变。 */
function buildMockBriefArtifacts(sessionId: string): MockArtifacts {
  void sessionId
  const brief = [
    '# 退款功能优化 · 技术概要',
    '',
    '## 1. 业务背景与目标',
    '本需求围绕"退款功能优化"展开,核心目标:',
    '- 单笔退款金额上限 5000 元;超过需走人工审核',
    '- 退款失败时回滚优惠券 / 库存',
    '- 退款幂等键基于订单号 + 时间窗口',
    '- 部分退款支持单笔最多 3 次',
    '',
    '## 2. 架构选型',
    '推荐方案 B:异步多阶段事件驱动。理由:',
    '- 单阶段同步方案在 5 跳微服务调用下 P99 > 800ms',
    '- 事件驱动可将退款入口 RT 控制在 80ms 内',
    '- 失败回滚通过补偿事件自然收敛',
    '',
    '## 3. 技术栈',
    '- 事件总线:Kafka',
    '- 幂等存储:Redis(TTL 24h)',
    '- 分布式锁:ZooKeeper',
    '- 异步任务调度:XXL-Job',
    '',
    '## 4. 风险与缓解',
    '详见 modules.yaml 的 deps / complexity 字段。当前识别 4 个核心模块。',
    '',
  ].join('\n')

  const modules: { modules: MockModule[] } = {
    modules: [
      {
        id: 'm-idempotent-gateway',
        name: '幂等网关',
        description: '全局幂等键校验,防重复创建退款单',
        deps: ['refund-service'],
        complexity: 'high',
        clarifying_questions: [
          {
            id: 'q-1',
            question: '幂等键设计规则?',
            options: ['订单号+时间戳', '全局自增序列', 'UUID v4'],
            required: true,
          },
          { id: 'q-2', question: '重试窗口期多长?', options: ['5min', '30min', '24h'] },
        ],
      },
      {
        id: 'm-refund-core',
        name: '退款核心逻辑',
        description: '退款单状态机:创建 → 校验 → 调用支付 → 完结/失败',
        deps: ['m-idempotent-gateway', 'payment-gateway'],
        complexity: 'medium',
        clarifying_questions: [
          { id: 'q-3', question: '退款状态机是否需要补偿事件?', required: true },
        ],
      },
      {
        id: 'm-rollback-handler',
        name: '回滚处理器',
        description: '退款失败时回滚优惠券 / 库存 / 积分',
        deps: ['m-refund-core', 'coupon-service', 'inventory-service'],
        complexity: 'medium',
        clarifying_questions: [
          { id: 'q-4', question: '部分回滚 vs 全量回滚策略?' },
        ],
      },
      {
        id: 'm-notification',
        name: '通知中心',
        description: '退款结果通过 webhook 通知商家 + 短信通知用户',
        deps: ['m-refund-core'],
        complexity: 'low',
      },
    ],
  }
  return { brief, modules }
}

/** 极简 YAML 序列化(与 Web 端 tech-brief.ts 的 serializeModulesYaml 契约一致)。 */
function serializeModulesYamlForAgent(modules: MockArtifacts['modules']): string {
  if (modules.modules.length === 0) return 'modules: []\n'
  const lines: string[] = ['modules:']
  for (const m of modules.modules) {
    lines.push(`  - id: ${m.id}`)
    lines.push(`    name: ${m.name}`)
    if (m.description) lines.push(`    description: ${m.description}`)
    if (m.deps.length > 0) {
      lines.push('    deps:')
      for (const d of m.deps) lines.push(`      - ${d}`)
    } else {
      lines.push('    deps: []')
    }
    lines.push(`    complexity: ${m.complexity}`)
    if (m.clarifying_questions && m.clarifying_questions.length > 0) {
      lines.push('    clarifying_questions:')
      for (const q of m.clarifying_questions) {
        lines.push(`      - id: ${q.id}`)
        lines.push(`        question: ${q.question}`)
        if (q.options && q.options.length > 0) {
          lines.push('        options:')
          for (const o of q.options) lines.push(`          - ${o}`)
        }
        if (q.required !== undefined) {
          lines.push(`        required: ${q.required ? 'true' : 'false'}`)
        }
      }
    }
  }
  return lines.join('\n') + '\n'
}

/** 写前 snapshot hook(decision 47 · ADR-0009 第 4 层)。失败静默(best-effort)。
 *  同一 generate-brief 操作的两个文件共享同一 ts 目录(由 caller 传入),便于回滚。 */
function snapshotBeforeWriteAgent(
  analysisDir: string,
  fileName: string,
  sharedTs: string,
): void {
  const snapshotDir = process.env.AIDEVSPACE_SNAPSHOT_DIR
  if (!snapshotDir) return
  try {
    const reqId = extractRequirementIdFromAgent(analysisDir)
    const snapDir = join(snapshotDir, reqId, sharedTs)
    mkdirSync(snapDir, { recursive: true })
    const source = join(analysisDir, fileName)
    if (existsSync(source)) {
      const target = join(snapDir, fileName)
      writeFileSync(target, readFileSync(source))
    }
  } catch {
    /* best-effort */
  }
}

function extractRequirementIdFromAgent(analysisDir: string): string {
  const parts = analysisDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 2] ?? 'unknown'
}

function defaultAgentRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { homedir } = require('node:os') as typeof import('node:os')
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}
