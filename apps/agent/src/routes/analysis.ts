/**
 * ANALYZING 工位 Agent REST endpoints(ADR-0013 D2 ② · issue 19b/19e/19f)
 *
 * 当前 slice(19b VS2)只覆盖:
 * - POST /api/requirements/:id/analysis/interject —— 用户插话,启动 admission-check
 *   Skill → 产生新 chunks → 通过 SseHub.publish 推给该 reqId 的所有 SSE 订阅者
 *
 * ticket 01 (ADR-0020 D8):start handler 单 session 双 turn 真接 SDK
 *   - turn-1:admission-check Skill 装填,system prompt 注入 Skill body
 *   - turn-2:requirement-brainstorm Skill 装填(同 session,SDK 自动保留 turn-1 history)
 *   - chunks 实时落 jsonl + SSE 推送,turn-done 由 SDK 流关闭事件表达
 *
 * 后续 slice(19e/19f)再扩展:
 * - POST /api/requirements/:id/analysis/regenerate  -- 重扫
 * - POST /api/requirements/:id/analysis/adjudicate  -- 裁决写入 + 应用
 * - POST /api/requirements/:id/analysis/generate-brief -- 生成技术概要
 *
 * 设计要点:
 * - 接受 { text, session_id } body,缺失字段 → 400
 * - 返回 202(Accepted)+ ack —— chunks 是异步通过 SSE 推到客户端的,不阻塞 POST 返回
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SseHub } from '../sse/SseHub.js'
import type { AIProvider } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'
import { createSystemPromptAssembler, type SystemPromptAssembler } from '../prompt/SystemPromptAssembler.js'
import { createSkillLoader, type Skill } from '../prompt/SkillLoader.js'
import {
  SESSION_SNAPSHOT_IDS,
  isSessionSnapshotId,
  listSessionSnapshots,
  removeSessionSnapshot,
  restoreSnapshot,
  takeSessionSnapshot,
  type SessionSnapshotId,
  type SnapshotOptions,
} from './analysis-snapshot.js'
import {
  createAnalysisTextParser,
  type ParsedAnalysisChunk,
  type SourceRef as ParsedSourceRef,
} from './analysis-chunk-parser.js'

export interface AnalysisRoutesOptions {
  hub: SseHub
  /**
   * 与 reposRoutes / workspaceRoutes 对齐:分析路由操作 `<root>/requirements/<id>/{requirement.md,analysis/}`。
   * buildServer 注入;未设时退化到 `process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()`,
   * 保留历史 fallback 兼容 dev 终端直接跑脚本的场景(ticket 00 baseline 校正)。
   */
  workspaceRoot?: string
  /**
   * ticket 01 (ADR-0020 D8):start handler 真接 SDK,需要 AIProvider 实例 —— 由
   * buildServer 在 `createClaudeCodeProvider(...)` 之后注入。测试可通过
   * BuildServerOptions.provider 覆盖为 fake。
   */
  provider: AIProvider
}

interface InterjectBody {
  text?: unknown
  session_id?: unknown
}

// ============================================================================
// SourceRef(ADR-0017 D3 · ticket 06)
//
// 与 web 端 `apps/web/src/lib/analyzing.ts` 的 `SourceRef` discriminated
// union 镜像;**agent 端内联定义** —— 避免反向 import web 端(决策 36 +
// package 边界)。web/agent 两端类型一致性靠集成测试守护
// (`apps/web/src/lib/__tests__/analyzing-source-refs.test.ts` +
// `apps/agent/src/__tests__/analysis-source-refs.test.ts`)。
//
// 三种子形态:
// - `{kind:'prd', lineRange:[start,end], quote?}`  → PRD 文本段
// - `{kind:'aux', auxId, lineRange:[start,end], quote?}` → AuxFile 文本段
// - `{kind:'asset', assetId}`  → PRD 解出的图片
//
// lineRange 是 0-based 半开区间 [start, end),对齐 `extractPrdAnchors`
// (packages/shared/src/drafting.ts) 既有约定。
//
// audit-2026-07-26 #2 之后:类型的**单一定义点**已移到
// `./analysis-chunk-parser.ts`(SDK 文本解析层同样要产出 SourceRef),
// 本文件只 re-import,避免两份同名结构漂移。
// ============================================================================
type SourceRef = ParsedSourceRef

/** Agent 端内部 SSE chunk 形态:在 shared `SseEvent['analysis_chunk'].chunk`
 *  基础上扩展 `source_refs` 字段。narration chunk 一律不设该字段;只有
 *  subproblem / risk / option 类型可能携带。
 *
 *  共享事件在调 `hub.publish(id, ev)` 时通过 readonly unknown[] 形态
 *  (见 shared/sse.ts) 序列化,SSE 订阅侧拿到 chunk 对象即可读到 source_refs。
 */
interface AnalysisChunkPayload {
  id: string
  ts: string
  label: string
  kind: 'narration' | 'subproblem' | 'risk' | 'option'
  tone: 'info' | 'success' | 'warn' | 'err'
  text: string
  source_refs?: readonly SourceRef[]
  /** ADR-0020 D8:`[DIM]` / `[VERDICT]` 解析出的准入侧信息(见 shared/sse.ts) */
  admission?: {
    dim?: string
    verdict?: 'pass' | 'warn' | 'fail'
    overall?: 'pass' | 'pending' | 'fail'
    pendingCount?: number
  }
}

interface AnalysisChunkEvent {
  ts: number
  type: 'analysis_chunk'
  reqId: string
  sessionId: string
  chunk: AnalysisChunkPayload
}

/** 与 web 端 `apps/web/src/lib/analyzing.ts` 同形 — 后端 inline,避免反向 import web。 */
type AnalysisSessionAngle = 'architecture' | 'data' | 'interface' | 'custom'
interface AnalysisSession {
  id: string
  label: string
  angle: AnalysisSessionAngle
  detectedCount: number
  isStreaming: boolean
}

interface StartBody {
  angle?: unknown
  label?: unknown
  session_id?: unknown
}

const ANALYSIS_ANGLES: readonly AnalysisSessionAngle[] = ['architecture', 'data', 'interface', 'custom']
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

function badRequest(reason: string): { error: 'bad_request'; reason: string } {
  return { error: 'bad_request', reason }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function angleToDefaultLabel(angle: AnalysisSessionAngle): string {
  const m: Record<AnalysisSessionAngle, string> = {
    architecture: '架构',
    data: '数据',
    interface: '接口',
    custom: '自定义',
  }
  return m[angle]
}

/** 模拟 admission-check Skill 在收到用户插话后的输出 chunks。
 *  真实 Skill 接通后,此处替换为 Skill runner 调用,返回值不变。
 *
 *  返回的 2 条均为 **narration** chunk(INFER + THINK)—— narration 类 chunk
 *  按 ADR-0017 D3 契约**禁止**带 `source_refs`,所以这里 chunk 不设字段
 *  (ticket 06 显式约束:`simulateInterjectChunks()` 输出的 2 条 narration
 *  → **不带** `source_refs`)。JSONL 序列化层也只在 chunk.source_refs 存在
 *  时才写入字段,narration 行 JSON 体积不受影响。 */
function simulateInterjectChunks(params: {
  requirementId: string
  sessionId: string
  userText: string
}): AnalysisChunkEvent[] {
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
  // 优先用 server 注入的 workspaceRoot(test/dev 通过 buildServer({ workspaceRoot }) 覆盖);
  // 未设时退化到 env / 默认 ~/.aidevspace,保留旧行为。
  const resolveRoot = (): string => opts.workspaceRoot ?? process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()

  /**
   * 本路由使用的 snapshot 注入项(ADR-0020 D10 · audit-2026-07-26 #4)。
   *
   * **snapshot 默认开启** —— 未显式配置 `AIDEVSPACE_SNAPSHOT_DIR` 时落到
   * `<workspaceRoot>/snapshots/analysis`。审计前的行为是"env 未设 → 全程 no-op",
   * 于是正常启动应用时:不生成 snapshot、列表恒空、StatusBar 回滚入口永不出现、
   * restore 恒返 `snapshot_dir_unset` —— ticket 06 的能力等于没上线。
   *
   * `workspaceRoot` 同样显式注入,让 restore 写回**本路由的** workspace,
   * 而不是 helper 各自读 env(多 workspace / 测试隔离下会写错目录)。
   */
  const snapshotOpts = (): SnapshotOptions => ({
    snapshotRoot:
      process.env.AIDEVSPACE_SNAPSHOT_DIR ?? join(resolveRoot(), 'snapshots', 'analysis'),
    workspaceRoot: resolveRoot(),
  })

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
  // POST /api/requirements/:id/analysis/start
  // 显式启动首个会话(决策 3)+ ticket 01 (ADR-0020 D8) 真接 SDK
  // - 校验 angle 白名单 + 可选 session_id 格式
  // - 必须 requirement.md 已存在(否则 409 prd_not_ready,引导用户回 DRAFTING)
  // - 落盘顺序:sessions/<sid>/ → appendSessionToIndex → 启动 AISession 跑双 turn
  // - 双 turn(turn-1 admission-check / turn-2 requirement-brainstorm)单 session 串行
  //   执行;每个 turn 的 SDK text 事件实时落 chunks.jsonl + 推 SseHub
  // - handler 不另造 done chunk 标记;turn-done 由 SDK sendMessage 流关闭事件表达
  // - 单 turn 失败时 jsonl 保留部分行(session 半成品状态),ticket 06 提供 snapshot 防御
  // ============================================================================
  fastify.post<{
    Params: { id: string }
    Body: StartBody
  }>('/api/requirements/:id/analysis/start', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}

    // 1. angle 必填 + 白名单
    const angle = body.angle
    if (typeof angle !== 'string' || !ANALYSIS_ANGLES.includes(angle as AnalysisSessionAngle)) {
      return reply
        .code(400)
        .send(badRequest('angle must be one of architecture|data|interface|custom'))
    }
    const angleTyped = angle as AnalysisSessionAngle

    // 2. label 可选,非空字符串(trim)
    let labelText: string = angleToDefaultLabel(angleTyped)
    if (body.label !== undefined && body.label !== null && body.label !== '') {
      if (typeof body.label !== 'string' || body.label.trim().length === 0) {
        return reply.code(400).send(badRequest('label must be non-empty string'))
      }
      labelText = body.label.trim()
    }

    // 3. session_id 可选,正则校验
    let sessionId: string
    if (body.session_id !== undefined && body.session_id !== null && body.session_id !== '') {
      if (typeof body.session_id !== 'string' || !SESSION_ID_RE.test(body.session_id)) {
        return reply.code(400).send(badRequest('session_id format invalid'))
      }
      sessionId = body.session_id
    } else {
      sessionId = `sess-${angleTyped}-${Date.now().toString(36)}`
    }

    // 4. root 解析(沿用 generate-brief 同款):优先 server 注入,fallback env / ~/.aidevspace
    const root = resolveRoot()
    const requirementMdPath = join(root, 'requirements', id, 'requirement.md')
    if (!existsSync(requirementMdPath)) {
      return reply.code(409).send({
        error: 'prd_not_ready',
        reason: 'requirement.md does not exist; please finish DRAFTING first',
      })
    }

    const analysisDir = join(root, 'requirements', id, 'analysis')
    const sessionsDir = join(analysisDir, 'sessions')
    const sessionDir = join(sessionsDir, sessionId)
    if (existsSync(sessionDir)) {
      return reply.code(409).send({
        error: 'session_already_exists',
        reason: `session ${sessionId} already exists at ${sessionDir}`,
      })
    }

    // 5. 预落盘:sessions/<sid>/ + _index.yaml(沿用既有契约)
    mkdirSync(sessionDir, { recursive: true })

    const startedAt = new Date().toISOString()
    appendSessionToIndex({
      sessionsDir,
      sessionId,
      angle: angleTyped,
      label: labelText,
      startedAt,
    })

    // 6. 预创建空 chunks.jsonl —— 双 turn 启动前先建立文件,后续 appendFileSync 流式写
    //    (空文件头也是 web loadSessionChunks() 的合法形态:0 行解析为 [])
    const chunksPath = join(sessionDir, 'chunks.jsonl')
    writeFileSync(chunksPath, '', 'utf8')

    // 7. 加载 Skills(union by name,user-wins)—— handler 硬过滤 active Skills。
    //    built-in dir 不存在(本 PR 之前 ticket 02 才落 SKILL.md)→ empty;handler 仍跑,
    //    降级到不含 Skill body 的 system prompt(ticket 02 落地后自然包含)。
    const skillsByName = await loadSkillsUnion({
      builtinDir: resolveBuiltinSkillsDir(),
      userDir: resolveUserSkillsDir(),
    })
    const admissionSkill = skillsByName.get('admission-check')
    const brainstormSkill = skillsByName.get('requirement-brainstorm')

    // 8. PRD 全文 → turn-1 user message
    const prdContent = readFileSync(requirementMdPath, 'utf8')
    const turn1UserMessage = buildTurn1UserMessage({ prdContent, angle: angleTyped, label: labelText })

    // 9. 构造 stateful dual-turn assembler —— turn-1 / turn-2 各装入对应 Skill body
    const baseAssembler = createSystemPromptAssembler({
      skillsRoots: [resolveBuiltinSkillsDir(), resolveUserSkillsDir()],
    })
    const dualTurnAssembler = createDualTurnAssembler({ base: baseAssembler, skillsByName })

    // 10. 异步跑双 turn(POST 不等 turn 跑完即返回 201)—— chunks 通过 SseHub + jsonl 实时落
    //    fire-and-forget:runDualTurnAnalysis 内部 await session.send() 可能
    //    耗时数秒到数十秒,不能让 POST 阻塞。失败时只 log,不阻断 201 返回。
    void runDualTurnAnalysis({
      provider: opts.provider,
      reqId: id,
      sessionId,
      sessionDir,
      analysisDir,
      angle: angleTyped,
      label: labelText,
      turn1UserMessage,
      dualTurnAssembler,
      admissionSkillBody: admissionSkill?.body ?? null,
      brainstormSkillBody: brainstormSkill?.body ?? null,
      hub,
      fastify,
      snapshotOpts: snapshotOpts(),
    }).catch((err: unknown) => {
      // 防御:createSession 抛错 → log;session 目录已落,后续清理走 ticket 06 snapshot 路径
      const message = err instanceof Error ? err.message : String(err)
      fastify.log.error({ err, reqId: id, sessionId }, 'analysis start createSession failed')
    })

    // 11. POST 立即 201(session 目录已落,async turn 失败由 ticket 06 snapshot 兜底)
    return reply.code(201).send({
      ok: true,
      requirementId: id,
      sessionId,
      index_path: join(sessionsDir, '_index.yaml'),
      chunks_path: chunksPath,
      started_at: startedAt,
    })
  })

  // ============================================================================
  // ticket 06 (ADR-0020 D10):snapshot list + restore 端点
  //
  // GET  /api/requirements/:id/analysis/snapshots
  //   列出该 req 下 turn-bounded snapshot(id ∈ {before_admission, before_brainstorm})
  //   + sidecar 写入的 session_id(tell 前端这 snapshot 来自哪条 session)
  //
  // POST /api/requirements/:id/analysis/restore
  //   body: { snapshot_id: 'before_admission' | 'before_brainstorm' }
  //   还原到 latest session 的 chunks.jsonl(不挑 sid —— snapshot 是按 req-id 维度命名,
  //   restore 目标永远 = mtime 最新 session,语义"回滚到一个已知 good 状态")
  // ============================================================================

  fastify.get<{
    Params: { id: string }
  }>('/api/requirements/:id/analysis/snapshots', async (req, reply) => {
    const { id } = req.params
    const snapshots = listSessionSnapshots(id, snapshotOpts())
    return reply.code(200).send({ snapshots })
  })

  fastify.post<{
    Params: { id: string }
    Body: { snapshot_id?: unknown }
  }>('/api/requirements/:id/analysis/restore', async (req, reply) => {
    const { id } = req.params
    const body = req.body ?? {}
    const snapshotIdRaw = body.snapshot_id
    if (!isSessionSnapshotId(snapshotIdRaw)) {
      return reply.code(400).send(
        badRequest(
          `snapshot_id must be one of ${SESSION_SNAPSHOT_IDS.join('|')}`,
        ),
      )
    }
    const result = restoreSnapshot(id, snapshotIdRaw, snapshotOpts())
    if (!result.ok) {
      // snapshot_not_found / snapshot_dir_unset → 404
      // no_active_session → 409(状态不允许)
      const status = result.error === 'no_active_session' ? 409 : 404
      return reply.code(status).send({
        ok: false,
        error: result.error,
        reason: result.reason ?? '',
      })
    }
    return reply.code(200).send(result)
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

    // 1. 计算 analysis 目录:优先 server 注入的 workspaceRoot,fallback env / ~/.aidevspace
    const root = resolveRoot()
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
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

// ============================================================================
// start 端点 helpers(issue 19g · 决策 3)
// ============================================================================

/** 接受 AnalysisSession[],输出 web 端 parseSessionsIndexYaml 能解析的格式(snake_case)。 */
function serializeSessionsIndexYaml(sessions: AnalysisSession[]): string {
  if (sessions.length === 0) return 'sessions: []\n'
  const lines: string[] = ['sessions:']
  for (const s of sessions) {
    lines.push(`  - id: ${s.id}`)
    lines.push(`    label: ${s.label}`)
    lines.push(`    angle: ${s.angle}`)
    lines.push(`    detected_count: ${s.detectedCount}`)
    lines.push(`    is_streaming: ${s.isStreaming ? 'true' : 'false'}`)
  }
  return lines.join('\n') + '\n'
}

/** 极简解析器:从 _index.yaml 读出已有 sessions(id/label/angle 三个字段),
 *  对齐 web 端 parseSessionsIndexYaml 的 assignField 行为(忽略 detected_count / is_streaming 等)。 */
function parseSimpleIndexYaml(indexPath: string): AnalysisSession[] {
  if (!existsSync(indexPath)) return []
  const text = readFileSync(indexPath, 'utf8')
  const lines = text.split('\n')
  const result: AnalysisSession[] = []
  let current: Partial<AnalysisSession> | null = null
  for (const line of lines) {
    const cleaned = line.replace(/#.*$/, '').trim()
    if (!cleaned) continue
    const listStart = /^\s*-\s+/.exec(cleaned)
    if (listStart) {
      if (current && current.id) result.push(current as AnalysisSession)
      current = {}
      const afterDash = cleaned.slice(listStart[0].length).trim()
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) {
          assignField(current, kv[1], kv[2].trim())
        }
      }
      continue
    }
    if (current) {
      // 注:不要求 leading \s+ —— 上面的 line.replace(/#.*$/, '').trim() 已吃掉首尾空白
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
      if (kv) {
        assignField(current, kv[1], kv[2].trim())
      }
    }
  }
  if (current && current.id) result.push(current as AnalysisSession)
  return result
}

function assignField(
  current: Partial<AnalysisSession>,
  key: string,
  value: string,
): void {
  if (key === 'id') current.id = value
  else if (key === 'label') current.label = value
  else if (key === 'angle') current.angle = value as AnalysisSessionAngle
  else if (key === 'detected_count') current.detectedCount = Number(value) || 0
  else if (key === 'is_streaming') current.isStreaming = value === 'true'
}

/** 极简辅助:仅解析 `- id: <sid>` 行用于去重检查。 */
function readExistingSessionIds(indexPath: string): Set<string> {
  if (!existsSync(indexPath)) return new Set()
  const ids = new Set<string>()
  for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
    const m = /^\s*-\s+id:\s*(\S+)\s*$/.exec(line)
    if (m) ids.add(m[1])
  }
  return ids
}

/** read-modify-write 模式 append session 到 _index.yaml。
 *  先去重检查 → 已读旧 sessions → 拼新 list → 整文件覆写。 */
function appendSessionToIndex(params: {
  sessionsDir: string
  sessionId: string
  angle: AnalysisSessionAngle
  label: string
  startedAt: string
}): void {
  void params.startedAt
  const indexPath = join(params.sessionsDir, '_index.yaml')
  const existing = readExistingSessionIds(indexPath)
  if (existing.has(params.sessionId)) {
    throw new Error(`duplicate session_id ${params.sessionId}`)
  }
  const existingSessions = parseSimpleIndexYaml(indexPath)
  const next: AnalysisSession[] = [
    ...existingSessions,
    {
      id: params.sessionId,
      label: params.label,
      angle: params.angle,
      detectedCount: 0,
      isStreaming: true,
    },
  ]
  writeFileSync(indexPath, serializeSessionsIndexYaml(next), 'utf8')
}

/** 双 turn 跑完后回写 `_index.yaml` 的 `detected_count` / `is_streaming`。
 *
 *  fix(识别产物为空):`appendSessionToIndex` 起手固定写 `detected_count: 0` +
 *  `is_streaming: true`,而**此前全仓库没有任何地方回写这两个字段** —— 会话跑完
 *  后索引仍显示 0 条产物 + 永久"流式中",StatusBar / 会话切换器据此渲染会一直
 *  停在错误状态。
 *
 *  best-effort:索引缺失 / session 不在索引里 / 写盘失败都静默跳过 —— 收尾回写
 *  不应该把一次成功的分析 turn 变成失败。 */
function finalizeSessionInIndex(params: {
  sessionsDir: string
  sessionId: string
  detectedCount: number
}): void {
  try {
    const indexPath = join(params.sessionsDir, '_index.yaml')
    if (!existsSync(indexPath)) return
    const sessions = parseSimpleIndexYaml(indexPath)
    let touched = false
    const next = sessions.map((s) => {
      if (s.id !== params.sessionId) return s
      touched = true
      return { ...s, detectedCount: params.detectedCount, isStreaming: false }
    })
    if (!touched) return
    writeFileSync(indexPath, serializeSessionsIndexYaml(next), 'utf8')
  } catch {
    /* best-effort:收尾回写失败不影响已落盘的 chunks */
  }
}

/** 把首批 analysis_chunk 列表序列化为 jsonl,写入 sessions/<sid>/chunks.jsonl。
 *  web 端 loadSessionChunks() 的解析契约:每行 JSON 包含 id/ts/label/text/kind/tone/session_id。
 *
 *  ADR-0017 D3 · ticket 06:`source_refs` 字段**仅在存在时**追加在末尾(避免
 *  narration 行 JSON 膨胀,与 web 端 ticket 01 的 JSONL 兼容性约束一致);
 *  narration chunk 不会进到这条 spread 分支(它们的 `source_refs` 为
 *  undefined),字段顺序保持 id → ts → label → tone → text → kind →
 *  session_id → [可选 source_refs]。 */
function appendChunksToJsonl(params: { sessionDir: string; chunks: AnalysisChunkEvent[] }): void {
  const file = join(params.sessionDir, 'chunks.jsonl')
  const lines: string[] = []
  for (const ev of params.chunks) {
    if (ev.type === 'analysis_chunk') {
      const serialized: Record<string, unknown> = {
        id: ev.chunk.id,
        ts: ev.chunk.ts,
        label: ev.chunk.label,
        tone: ev.chunk.tone,
        text: ev.chunk.text,
        kind: ev.chunk.kind,
        session_id: ev.sessionId,
      }
      if (ev.chunk.source_refs !== undefined) {
        serialized.source_refs = ev.chunk.source_refs
      }
      lines.push(JSON.stringify(serialized))
    }
  }
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}


// ============================================================================
// ticket 01 (ADR-0020 D8):start handler 真接 SDK —— 双 turn 编排 helpers
//
// 范围:仅 start handler 内部使用,不影响 interject / generate-brief 既有 mock 路径。
// 设计原则:
//   - 沿用 ClaudeCodeProvider / AISession 既有路径,**不**引入 MockClaudeProvider 抽象层
//   - chunks 实时落 jsonl(appendFileSync 流式)+ 同步推 SseHub
//   - 单 turn 失败 → jsonl 保留部分行,session 半成品状态由 ticket 06 snapshot 兜底
// ============================================================================

/** built-in Skills 根目录 —— ADR-0020 D5。
 *  与 `apps/agent/src/` 平行的 `skills/built-in/`,运行时通过相对
 *  `apps/agent/dist/routes/analysis.js` 的路径推断。dev 模式走 `src/` 同级 `skills/`,
 *  编译后走 `dist/` 同级 `skills/`(package.json 留空 — 部署时由 tsc 拷贝)。 */
function resolveBuiltinSkillsDir(): string {
  const candidates: string[] = []
  // dev: dist/routes/analysis.js → ../../skills/built-in ; src/routes/analysis.ts → ../../skills/built-in
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(here, '..', '..', 'skills', 'built-in'))
  } catch {
    /* import.meta.url 不可用 → 退到 process.cwd() */
  }
  // dev 终端直跑:src/routes/analysis.ts → ../../skills/built-in (相对 process.cwd())
  candidates.push(join(process.cwd(), 'apps', 'agent', 'skills', 'built-in'))
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0] ?? join(process.cwd(), 'apps', 'agent', 'skills', 'built-in')
}

/** user Skills 根目录 —— ADR-0020 D5。
 *  跟随 `~/.aidevspace/skills/` 约定;不存在 → 创建空目录(loadAll 返回 [])。 */
function resolveUserSkillsDir(): string {
  try {
    return join(homedir(), '.aidevspace', 'skills')
  } catch {
    return join(process.cwd(), '.aidevspace', 'skills')
  }
}

/** ADR-0020 D5:union by name,user-wins。空目录 / 不存在 → 安静返回空 map。
 *  handler 硬过滤只关心 admission-check + requirement-brainstorm 两个 name。 */
async function loadSkillsUnion(opts: {
  builtinDir: string
  userDir: string
}): Promise<Map<string, Skill>> {
  const loader = createSkillLoader()
  const builtin = await loader.loadAll(opts.builtinDir)
  const user = await loader.loadAll(opts.userDir)
  const out = new Map<string, Skill>()
  // 先 built-in
  for (const s of builtin) out.set(s.name, s)
  // user-wins:同名 Skill 覆盖 built-in
  for (const s of user) out.set(s.name, s)
  return out
}

/** Stateful dual-turn assembler —— ADR-0020 D8。
 *
 *  行为:turn-1 setActiveSkill('admission-check') → assembleBase 返回
 *  `platformPhilosophy + admission-check body`;turn-2 setActiveSkill('requirement-brainstorm')
 *  → 切到 brainstorm body。AISession 内部对 `assembleBase` 按 session.id 缓存,
 *  turn 间切换时**必须**调 `resetBaseCache()` 让 base 重算。
 *
 *  `assembleDynamic` 透传 base assembler —— dynamic 段不随 Skill 切换。
 *
 *  Skill body 缺失(本 PR 之前 ticket 02 才落 SKILL.md)→ assembleBase 退化为
 *  仅 platform philosophy,handler 仍跑、turn 仍执行,只是 prompt 缺少 Skill 提示。
 */
interface DualTurnAssembler extends SystemPromptAssembler {
  setActiveSkill(name: string | null): void
}

function createDualTurnAssembler(opts: {
  base: SystemPromptAssembler
  skillsByName: Map<string, Skill>
}): DualTurnAssembler {
  let activeSkillName: string | null = null

  return {
    async assembleBase(session) {
      const base = await opts.base.assembleBase(session)
      if (!activeSkillName) return base
      const skill = opts.skillsByName.get(activeSkillName)
      if (!skill || skill.body.length === 0) return base
      return `${base}\n\n### ${activeSkillName}\n${skill.body}`
    },
    async assembleDynamic(input) {
      return opts.base.assembleDynamic(input)
    },
    resetBaseCache() {
      opts.base.resetBaseCache()
    },
    setActiveSkill(name: string | null) {
      activeSkillName = name
    },
  }
}

/** turn-1 user message —— ADR-0020 D8 描述:PRD 全文 + "请按 5 维度做准入"。
 *
 *  措辞注意(fix:识别产物为空):**不要**出现 "基于 xx Skill" 字样 —— Claude Code
 *  默认 system prompt 自带 Skill 注册表,模型会把这句话理解成"去调用一个已注册的
 *  Skill 工具",查不到就自行发挥、输出自由 markdown,导致 `[DIM ...]` 标记全部丢失。
 *  这里只引用 "system prompt 中约定的输出格式",把模型拉回 appendSystemPrompt 里的
 *  Skill body。 */
function buildTurn1UserMessage(params: {
  prdContent: string
  angle: AnalysisSessionAngle
  label: string
}): string {
  return [
    `PRD 全文如下,请完成 5 维度准入校验:`,
    '',
    '<prd>',
    params.prdContent,
    '</prd>',
    '',
    `当前会话角度 = ${params.angle},label = ${params.label}。`,
    '请按 5 维度(loss_prevention / performance / arch_conflict / business_reasonable / context_query)',
    '输出每个维度的判断与依据。',
    '',
    '严格遵循 system prompt 中约定的输出格式:5 个 `[DIM <维度key>]` 段 + 1 个 `[VERDICT]` 段,',
    '标记独占一行、顶格,段间空行分隔。不要输出 markdown 标题 / 表格 / 列表 / 导语 / 总结。',
  ].join('\n')
}

/** turn-2 user message —— ADR-0020 D8 描述:"已知准入结果 X,继续 brainstorm"。
 *  不传具体准入结果(SDK 同 session 自动保留 turn-1 history,模型可自查),只指明
 *  下一步动作 —— 转向三桶 chunk 形态。
 *
 *  措辞注意:同 turn-1,**不要**出现 "基于 xx Skill" 字样(见上方说明)。 */
function buildTurn2UserMessage(): string {
  return [
    '已知上一轮 5 维度准入结果(SDK 同 session 已自动保留 history)。',
    '请继续 brainstorm,按三桶形态输出:',
    '- subproblem:还需澄清的子问题',
    '- risk:潜在风险',
    '- option:可选方案',
    '',
    '严格遵循 system prompt 中约定的输出格式:每条产物一段,以 `[SUBPROBLEM]` / `[RISK]` /',
    '`[OPTION]` 标记开头,标记独占一行、顶格,段间空行分隔。',
    '不要输出 markdown 标题 / 表格 / 列表 / emoji 分组标题 / 导语 / 总结 —— 没有标记的行会被丢弃。',
  ].join('\n')
}

/** Append-only 流式写 chunks.jsonl —— SDK 每个 text 事件 → 1 行。
 *
 *  直接 `appendFileSync` —— handler 单实例独占文件,无并发;每次重新
 *  open('a') 反而保证新写入可见(fs 上 fsync 即时)。
 *  文件不存在 → 由 caller 预创建(handler 步骤 6 写空文件头)。
 *
 *  ADR-0017 D3:`source_refs` 仅在存在时写入 —— narration chunk 无该字段,
 *  JSON 体积不受影响。 */
function appendChunkToJsonl(filePath: string, ev: AnalysisChunkEvent): void {
  if (ev.type !== 'analysis_chunk') return
  const serialized: Record<string, unknown> = {
    id: ev.chunk.id,
    ts: ev.chunk.ts,
    label: ev.chunk.label,
    tone: ev.chunk.tone,
    text: ev.chunk.text,
    kind: ev.chunk.kind,
    session_id: ev.sessionId,
  }
  if (ev.chunk.source_refs !== undefined) {
    serialized.source_refs = ev.chunk.source_refs
  }
  // ADR-0020 D8 / audit-2026-07-26 #2:admission 侧信息必须落盘 —— web 端
  // SSR(`loadSessionChunks`)据此重建 AdmissionDashboard 五维卡 count 与
  // 总体徽章;只推 SSE 不落盘会让刷新页面后仪表板归零。
  if (ev.chunk.admission !== undefined) {
    serialized.admission = ev.chunk.admission
  }
  appendFileSync(filePath, JSON.stringify(serialized) + '\n', 'utf8')
}

/** runDualTurnAnalysis —— ADR-0020 D8 单 session 双 turn 编排主体。
 *
 * 契约:
 *   - createSession 一次 → AISession 单例
 *   - turn-1 sendMessage(turn1UserMessage, admission-check body 进 system prompt)
 *   - turn-2 sendMessage(turn2UserMessage, requirement-brainstorm body 进 system prompt)
 *   - 每个 SDK text 事件 → 1 行 analysis_chunk(jsonl appendFileSync) + 1 个 SseHub.publish
 *   - turn-done 由 SDK 流关闭事件表达(不另造 done chunk)
 *   - 任一 turn 失败 → log + 继续下一 turn;两 turn 全失败 → 返回 ok:false
 *   - session.close() 在 finally 中执行
 */
async function runDualTurnAnalysis(params: {
  provider: AIProvider
  reqId: string
  sessionId: string
  sessionDir: string
  analysisDir: string
  angle: AnalysisSessionAngle
  label: string
  turn1UserMessage: string
  dualTurnAssembler: DualTurnAssembler
  admissionSkillBody: string | null
  brainstormSkillBody: string | null
  hub: SseHub
  fastify: FastifyInstance
  /** ADR-0020 D10 · audit #4:snapshot 根与 workspace 根由路由显式注入 */
  snapshotOpts: SnapshotOptions
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    provider, reqId, sessionId, sessionDir, dualTurnAssembler,
    turn1UserMessage, hub, fastify,
  } = params

  const chunksPath = join(sessionDir, 'chunks.jsonl')
  const counter: { value: number } = { value: 0 }
  /** 三桶产物命中数 —— 收尾回写 `_index.yaml` 的 detected_count + 可观测告警 */
  const productCounter: { value: number } = { value: 0 }
  // SseHub publish 幂等保护:每个 reqId + sessionId 的 publish 都走同一个 hub,
  // 无重复风险;但 sessionSdkId 仍记下供观测
  let sdkSessionIdLogged: string | undefined

  const session = await provider.createSession(reqId, {
    localSid: sessionId,
    topic: params.label,
    kind: 'task',
    cwd: params.analysisDir, // SDK 在 analysis dir 下启动,读 requirement.md 用相对 path 兜底
    assembler: dualTurnAssembler,
  })

  /**
   * streamTurnEvents —— 订阅 `session.events()` 直到流关闭(=SDK sendMessage
   * 流关闭 = turn-done,ADR-0020 D8 字面契约)。
   *
   * **文本 → chunk 映射(audit-2026-07-26 #2 修复)**:每条 `text` 事件先喂给
   * `analysis-chunk-parser`,由它把 built-in Skill 约定的 `[DIM]` / `[VERDICT]` /
   * `[SUBPROBLEM]` / `[RISK]` / `[OPTION]` 标记解析成结构化 chunk(kind /
   * source_refs / admission),解析不出标记的自由文本仍退化成 narration
   * (不丢内容)。turn 结束时 `flush()` 收尾未闭合块。
   *
   * `done` AIEvent 关闭订阅;`error` 仅 log 不阻断(后续 `done` 仍会到达 ——
   * SDK native retry / 业务错误都是 deterministic 终态,不再走 retry loop)。
   *
   * **cancel 必须能真正解开阻塞**(audit-2026-07-26 #3 修复):`AiSession.events()`
   * 的 `iterator.return()` **不会** resolve 一个已挂起的 `next()` promise
   * (见 AISession.ts `events()`:return 只是把 slot 从 #consumers 摘掉)。
   * 所以这里把 `iterator.next()` 与一个 cancel promise 做 race —— 否则
   * `session.send()` reject(session 已 errored,后续不会再有任何事件)时,
   * pump 会永远挂在 `await iterator.next()` 上,turn-2 不执行、session 不关闭、
   * analysis job 永远 running。
   */
  const streamTurnEvents = (
    turnLabel: 'INFER' | 'BRAINSTORM',
  ): { eventsDrained: Promise<void>; cancel: () => void } => {
    const iterable = session.events()
    const iterator = iterable[Symbol.asyncIterator]()
    const CANCELLED = Symbol('cancelled')
    let fireCancel: () => void = () => {}
    const cancelSignal = new Promise<typeof CANCELLED>((resolve) => {
      fireCancel = () => resolve(CANCELLED)
    })
    // turn 维度的解析器:自由文本 fallback label 用 turnLabel。
    // bucketFallback 仅 BRAINSTORM turn 打开 —— 模型若把三桶写成 markdown 分组标题
    // + 列表(实测常见),降级路径仍能升级出 subproblem/risk/option kind;
    // INFER turn 不开,避免 `## 主要风险` 这类叙述小标题被误判成 risk 产物。
    const parser = createAnalysisTextParser({
      fallbackLabel: turnLabel,
      bucketFallback: turnLabel === 'BRAINSTORM',
    })

    const emit = (parsed: ParsedAnalysisChunk): void => {
      counter.value++
      if (parsed.kind !== 'narration') productCounter.value++
      const id = `c-${turnLabel.toLowerCase()}-${sessionId}-${counter.value}`
      const ts = new Date().toISOString().slice(11, 19) // HH:MM:SS
      const chunk: AnalysisChunkPayload = {
        id,
        ts,
        label: parsed.label,
        kind: parsed.kind,
        tone: parsed.tone,
        text: parsed.text,
      }
      // 可选字段:undefined 不写 key(保持 JSONL 行与既有契约一致)
      if (parsed.source_refs && parsed.source_refs.length > 0) {
        chunk.source_refs = parsed.source_refs
      }
      if (parsed.admission) chunk.admission = parsed.admission
      const chunkEv: AnalysisChunkEvent = {
        ts: Date.now(),
        type: 'analysis_chunk',
        reqId,
        sessionId,
        chunk,
      }
      appendChunkToJsonl(chunksPath, chunkEv)
      hub.publish(reqId, chunkEv)
    }

    const eventsDrained = (async () => {
      try {
        for (;;) {
          const r = await Promise.race([iterator.next(), cancelSignal])
          if (r === CANCELLED) break
          if (r.done) break
          const ev = r.value
          if (ev.type === 'text') {
            for (const parsed of parser.push(ev.text)) emit(parsed)
          } else if (ev.type === 'done') {
            if (ev.sessionId && !sdkSessionIdLogged) {
              sdkSessionIdLogged = ev.sessionId
            }
            break
          } else if (ev.type === 'error') {
            // turn-done 已通过 done 表达;error 仅 log,不阻断下一 turn
            fastify.log.warn(
              { err: ev, reqId, sessionId, turnLabel },
              'analysis turn SDK error event',
            )
          }
          // thinking / tool_use / tool_result / retrying → 不映射 chunk(本期不实现)
        }
      } catch (err) {
        fastify.log.warn({ err, reqId, sessionId, turnLabel }, 'analysis turn event pump threw')
      } finally {
        // 收尾:把未闭合块(SDK 最后一段没有以空行/新标记结束)产出
        try {
          for (const parsed of parser.flush()) emit(parsed)
        } catch (err) {
          fastify.log.warn({ err, reqId, sessionId, turnLabel }, 'analysis turn parser flush threw')
        }
        try {
          await iterator.return?.(undefined)
        } catch {
          /* ignore */
        }
      }
    })()
    return {
      eventsDrained,
      cancel: () => {
        fireCancel()
      },
    }
  }

  /**
   * 单个 turn 的编排 —— 抽出来消除 turn-1 / turn-2 copy-paste。
   *
   * 顺序:setActiveSkill → resetBaseCache → 起订阅 → send → 等 eventsDrained。
   *
   * **send 失败路径(audit-2026-07-26 #3 修复)**:`send()` reject 意味着
   * AISession 已 errored / busy / closed —— 这一 turn **不会再有任何事件**,
   * 继续 `await eventsDrained` 会永久挂起。因此 catch 里先 `sub.cancel()`
   * 解开 pump,再 await(此时会立即 resolve),让 turn-2 与 session.close()
   * 正常继续(单 turn 失败保留半成品状态走下一 turn,ADR-0020 D8)。
   *
   * 正常路径下 eventsDrained 等到 SDK 流自然关闭(turn-done 由 `done` AIEvent
   * 触发);不设超时(handler 不该自行决定 turn 何时算完)。
   */
  async function runTurn(spec: {
    turnLabel: 'INFER' | 'BRAINSTORM'
    skillName: string | null
    skillBody: string | null
    userMessage: string
    turnLogTag: 'admission' | 'brainstorm'
    snapshotId: SessionSnapshotId
  }): Promise<void> {
    // ticket 06 (ADR-0020 D10):turn chunks 落 chunks.jsonl 第一行前 snapshot
    // 失败 best-effort —— helper 内部 try/catch 吞错,不影响 send 路径
    takeSessionSnapshot(sessionDir, reqId, spec.snapshotId, sessionId, params.snapshotOpts)
    // 记录 turn 开始时的 chunk 数;eventsDrained 后用与 counter.value 比较
    // 判定该 turn 是否写了 0 chunk(空 turn → 清掉 snapshot,不留无意义副本)
    const chunksAtStart = counter.value

    dualTurnAssembler.setActiveSkill(spec.skillBody ? spec.skillName : null)
    dualTurnAssembler.resetBaseCache()
    const sub = streamTurnEvents(spec.turnLabel)
    let sendFailed = false
    try {
      await session.send(spec.userMessage)
    } catch (err) {
      sendFailed = true
      fastify.log.error({ err, reqId, sessionId, turn: spec.turnLogTag }, 'analysis turn send failed')
      // send reject ⇒ 本 turn 不会再有任何事件 —— 主动解开 pump,否则永久挂起
      sub.cancel()
    }
    await sub.eventsDrained
    sub.cancel()

    // ticket 08 (ADR-0020 D2/D9 修订 · 2026-07-28):turn-done → publish
    // `analysis_done` 让 Web 端 `startState` 从 running 复位回 idle。
    // 仅在 send 成功时发(sendFailed 时 SDK 已 errored,语义上 turn 没真正
    // 完成,Web 端不应误判"已可再次触发")。
    if (!sendFailed) {
      const turn: 1 | 2 = spec.turnLabel === 'INFER' ? 1 : 2
      hub.publish(reqId, {
        type: 'analysis_done',
        reqId,
        sessionId,
        ts: Date.now(),
        turn,
      })
    }

    // ticket 06:空 turn(SDK 返回 0 chunk)不 snapshot —— 此处静默 remove
    if (counter.value === chunksAtStart) {
      removeSessionSnapshot(reqId, spec.snapshotId, params.snapshotOpts)
    }
  }

  let turn1Ok = true
  let turn2Ok = true
  try {
    await runTurn({
      turnLabel: 'INFER',
      skillName: 'admission-check',
      skillBody: params.admissionSkillBody,
      userMessage: turn1UserMessage,
      turnLogTag: 'admission',
      snapshotId: 'before_admission',
    })
  } catch (err) {
    turn1Ok = false
    fastify.log.error({ err, reqId, sessionId, turn: 'admission' }, 'turn-1 orchestrator failed')
  }

  try {
    await runTurn({
      turnLabel: 'BRAINSTORM',
      skillName: 'requirement-brainstorm',
      skillBody: params.brainstormSkillBody,
      userMessage: buildTurn2UserMessage(),
      turnLogTag: 'brainstorm',
      snapshotId: 'before_brainstorm',
    })
  } catch (err) {
    turn2Ok = false
    fastify.log.error({ err, reqId, sessionId, turn: 'brainstorm' }, 'turn-2 orchestrator failed')
  }

  // ---- cleanup ----
  try {
    await session.close()
  } catch (err) {
    fastify.log.warn({ err, reqId, sessionId }, 'session.close() failed')
  }

  // fix(识别产物为空):收尾回写 `_index.yaml` —— 无论 turn 成败都要落
  // `is_streaming: false`,否则失败会话会永久卡在"流式中"。
  finalizeSessionInIndex({
    sessionsDir: join(params.analysisDir, 'sessions'),
    sessionId,
    detectedCount: productCounter.value,
  })

  // 可观测性:三桶命中 0 条 = 模型没按标记格式输出(或降级路径也没兜住),
  // 前端「识别产物」会是空的。静默失败很难查,这里显式 warn。
  if (productCounter.value === 0) {
    fastify.log.warn(
      { reqId, sessionId, totalChunks: counter.value },
      'analysis produced 0 product chunks; ProductList will be empty ' +
        '(模型可能未按 [SUBPROBLEM]/[RISK]/[OPTION] 标记输出)',
    )
  } else {
    fastify.log.info(
      { reqId, sessionId, products: productCounter.value, totalChunks: counter.value },
      'analysis session finished',
    )
  }

  if (!turn1Ok && !turn2Ok) {
    return { ok: false, error: 'both turns failed; partial chunks in jsonl' }
  }
  return { ok: true }
}
