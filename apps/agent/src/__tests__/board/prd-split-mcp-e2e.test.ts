/**
 * 真 MCP server 路径 e2e —— PRD Split Run (issue 14 / ADR-0023 补救)
 *
 * 目的:用真 `ClaudeCodeProvider` + 真 `PrdSplitRunner` 业务工具 handler,
 *      mock SDK 暴露 `createSdkMcpServer` + `tool(...)` 出口,直接调 wrapper
 *      验证 args 透传到 `parseProposeCardInput` → `service.appendProposal` →
 *      `cards.yaml` 写入的整条链路是否成立。
 *
 * 暴露的真因(issue 13 报告:点击 [+ 从 PRD 拆] 成功,TaskCard 拆分结果 0 条):
 * - 真因 #1 —— ClaudeCodeProvider.ts:530 硬编码 description `Analysis Run 业务工具:...
 *   由 AnalysisAgentRunner 在 handler 内执行持久化`,但 PrdSplitRunner 用同一闭包
 *   注册 propose_card → 模型读 description 看到「Analysis Run」与 system prompt 中
 *   「BOARD 工位 PRD 拆解助手」语义冲突 → 模型谨慎 end_turn 不调工具 → 0 卡静音成功
 * - 真因 #2 —— PrdSplitService.transitionToSucceeded 缺 candidates.length===0 校验,
 *   模型 zero-call 时 Run 走 succeeded + actual_count=0,banner 显示「建议卡片组 0 条」
 *   但无任何错误反馈
 * - 真因 #3 —— CLAUDE.md ADR-0023 守门要求 `createSdkMcpServer` wrapper 真路径 e2e,
 *   本测试正好补齐(fakePrdSplitProvider 走 `input.businessTools[name]` 直 dispatch
 *   绕过 wrapper)
 *
 * 与 fakePrdSplitProvider 的区别(镜像 analysis-run-mcp-e2e.test.ts:14-19):
 * - fake 走 `input.businessTools['propose_card']` 直 dispatch,**绕过 wrapper**;
 * - 本测试走真 `createSdkMcpServer` + `tool(...)` 注册路径,确保 wrapper 真的被
 *   SDK 内部协议调用过。
 *
 * 状态:本测试 RED 在 issue 13 修复前 → GREEN 在 issue 14 修复后
 *       (修复点:description caller 注入 + transitionToSucceeded 0 卡回退)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ============================================================================
// SDK mock —— 必须在 import ClaudeCodeProvider 之前
// 镜像 analysis-run-mcp-e2e.test.ts:46-79 同款契约
// ============================================================================

const mockToolHandlers: Record<
  string,
  (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
> = {}
const mockToolSchemas: Record<string, Record<string, unknown>> = {}
const mockToolDescriptions: Record<string, string> = {}

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
      '@anthropic-ai/claude-agent-sdk',
    )
  return {
    ...actual,
    createSdkMcpServer: (config: {
      name: string
      tools: Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>
    }) => {
      for (const t of config.tools) {
        mockToolHandlers[t.name] = t.handler as never
      }
      return { type: 'sdk', name: config.name }
    },
    tool: (
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: unknown) => Promise<unknown>,
    ) => {
      mockToolSchemas[name] = schema
      mockToolDescriptions[name] = description
      return {
        name,
        description,
        handler,
      }
    },
    // query 在 createClaudeCodeProvider 的 queryFn 注入路径下不会被调用
    query: vi.fn(),
  }
})

// ============================================================================
// 工具函数
// ============================================================================

interface CcSwitchStub {
  getCurrent(): null
}

function makeEmptyCcSwitch(): CcSwitchStub {
  return { getCurrent: () => null }
}

interface MockQueryResult {
  type: 'result'
  subtype: 'success' | string
  duration_ms?: number
  total_cost_usd?: number
  is_error?: boolean
}

/** SDK 工具直通「模型产 1 张卡 → SDK 收 1 张卡 → 终态成功」场景 */
async function* successQueryStream(): AsyncIterable<MockQueryResult> {
  yield {
    type: 'result',
    subtype: 'success',
    duration_ms: 100,
    total_cost_usd: 0,
    is_error: false,
  }
}

/** SDK 工具「模型 0 张卡直接 end_turn → 终态成功」场景(issue 13 真因触发路径) */
async function* emptySuccessQueryStream(): AsyncIterable<MockQueryResult> {
  yield {
    type: 'result',
    subtype: 'success',
    duration_ms: 100,
    total_cost_usd: 0,
    is_error: false,
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('PRD Split Run 真 MCP server 路径 e2e (issue 13 / ADR-0023 补救)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-prdsplit-mcp-e2e-'))
    // 清空 mock 状态
    for (const k of Object.keys(mockToolHandlers)) delete mockToolHandlers[k]
    for (const k of Object.keys(mockToolSchemas)) delete mockToolSchemas[k]
    for (const k of Object.keys(mockToolDescriptions)) delete mockToolDescriptions[k]
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // 契约 #1 —— 工具 description 应由 caller 注入,禁止硬编码「Analysis Run」
  // 真因 #1:ClaudeCodeProvider.ts:530 硬编码 `Analysis Run 业务工具:...`
  //         PrdSplit 路径下 propose_card 拿不到「BOARD 工位」语义 →
  //         模型谨慎 end_turn(0 卡静音成功)
  // -------------------------------------------------------------------------
  it('契约#1 · propose_card description 来自 PrdSplitRunner 注入(BOARD 语义,非 Analysis Run)', async () => {
    // 准备 workspace
    const reqId = 'req-prd-mcp-e2e-desc'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
    writeFileSync(
      join(root, 'requirements', reqId, 'requirement.md'),
      '# Test PRD\n\n足够长的 PRD 文本,避免空 PRD 触发 PR-5 前置拒绝。\n',
      'utf8',
    )

    const { PrdSplitService } = await import(
      '../../prd-split/PrdSplitService.js'
    )
    const service = new PrdSplitService({
      root,
      runIdFactory: () => 'prd-fixed-aaaaaa',
      nowIso: () => '2026-08-07T08:00:00.000Z',
    })
    const create = await service.createRun({
      requirementId: reqId,
      granularity: '中',
      expectedCount: 3,
      useContext: ['prd'],
    })
    expect(create.ok).toBe(true)
    if (!create.ok) throw new Error('create failed')
    const runId = create.run.run_id

    const { createSseHub } = await import('../../sse/SseHub.js')
    const hub = createSseHub({ heartbeatMs: 60_000 })

    try {
      const { createClaudeCodeProvider } = await import(
        '../../providers/ClaudeCodeProvider.js'
      )
      const provider = createClaudeCodeProvider({
        ccSwitch: makeEmptyCcSwitch() as never,
        queryFn: successQueryStream as never,
      })

      const { makeProposeCardHandler } = await import(
        '../../prd-split/PrdSplitRunner.js'
      )
      const proposeCardHandler = makeProposeCardHandler({
        service,
        hub,
        requirementId: reqId,
        runId,
      })
      const businessTools = {
        propose_card: proposeCardHandler as never,
      }

      await provider.runAnalysisQuery({
        prompt: 'test',
        systemPrompt: 'test',
        cwd: '/tmp',
        allowedTools: ['Read'],
        businessTools,
        // 修复 #1:PrdSplitRunner 注入 BOARD 语义 description
        businessToolDescriptions: {
          propose_card:
            'BOARD 工位 PRD 拆解 Run 业务工具:propose_card。由 PrdSplitRunner 在 handler 内执行候选卡片持久化(写 cards.yaml 并 publish SSE);不支持 status 字段、不接受 suggested_status。每识别一张候选卡片应立即调用一次。',
        },
        onEvent: () => {},
      })

      // wrapper 已被 SDK mock 捕获
      expect(mockToolHandlers['propose_card']).toBeDefined()

      // 契约#1 关键断言:
      // (a) PrdSplitRunner 注入的 description 透传到 SDK tool(metadata 出口)
      expect(mockToolDescriptions['propose_card']).toContain('BOARD 工位')
      // (b) 不再是 ANALYSIS RUN 字样(issue 13 真因:语义错位)
      expect(mockToolDescriptions['propose_card']).not.toContain('Analysis Run')
      expect(mockToolDescriptions['propose_card']).not.toContain('AnalysisAgentRunner')
      // (c) schema 透传仍走 passthrough(非 report_analysis_issue 工具)
      expect(Object.keys(mockToolSchemas['propose_card'] ?? {})).toEqual([])
    } finally {
      hub.close()
    }
  })

  // -------------------------------------------------------------------------
  // 契约 #2 —— wrapper args 直传(裸 model input)→ accepted:true + cards.yaml 写入
  // 镜像 analysis-run-mcp-e2e.test.ts:129-294
  // -------------------------------------------------------------------------
  it('契约#2 · wrapper 直传 args(title+content+suggested_priority+labels)→ cards.yaml 写 1 条', async () => {
    const reqId = 'req-prd-mcp-e2e-args'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
    writeFileSync(
      join(root, 'requirements', reqId, 'requirement.md'),
      '# Test PRD\n\n足够长的 PRD 文本,避免空 PRD 触发 PR-5 前置拒绝。\n',
      'utf8',
    )

    const { PrdSplitService } = await import(
      '../../prd-split/PrdSplitService.js'
    )
    const service = new PrdSplitService({ root })
    const create = await service.createRun({
      requirementId: reqId,
      granularity: '中',
      expectedCount: 3,
      useContext: ['prd'],
    })
    if (!create.ok) throw new Error('create failed')
    const runId = create.run.run_id

    const { createSseHub } = await import('../../sse/SseHub.js')
    const hub = createSseHub({ heartbeatMs: 60_000 })

    // 收集 stderr 排障行(参考 analysis-run-mcp-e2e.test.ts:222-231)
    const stderrLines: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    ;(process.stderr as unknown as { write: typeof process.stderr.write }).write = ((
      chunk: string | Buffer,
      ...rest: unknown[]
    ) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (s.includes('[prd-split]')) stderrLines.push(s)
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof process.stderr.write

    try {
      const { createClaudeCodeProvider } = await import(
        '../../providers/ClaudeCodeProvider.js'
      )
      const provider = createClaudeCodeProvider({
        ccSwitch: makeEmptyCcSwitch() as never,
        queryFn: successQueryStream as never,
      })

      const { makeProposeCardHandler } = await import(
        '../../prd-split/PrdSplitRunner.js'
      )
      const proposeCardHandler = makeProposeCardHandler({
        service,
        hub,
        requirementId: reqId,
        runId,
      })

      await provider.runAnalysisQuery({
        prompt: 'test',
        systemPrompt: 'test',
        cwd: '/tmp',
        allowedTools: ['Read'],
        businessTools: { propose_card: proposeCardHandler as never },
        onEvent: () => {},
      })

      expect(mockToolHandlers['propose_card']).toBeDefined()

      // 模拟 SDK 调 wrapper —— 模型真实 output 形态
      const modelInput = {
        title: '退款接口',
        content: '实现退款\n\n- 支持原路退回',
        suggested_priority: 'high' as const,
        labels: ['p0', 'backend'],
      }

      try {
        const wrapperResult = await mockToolHandlers['propose_card'](modelInput)

        // 1. CallToolResult 形态
        expect(wrapperResult.content).toHaveLength(1)
        expect(wrapperResult.content[0]?.type).toBe('text')
        const text = wrapperResult.content[0]?.text ?? ''
        const parsed = JSON.parse(text) as {
          accepted: boolean
          ordinal?: number
          reason?: string
        }

        // 2. accepted:true + ordinal=1
        expect(parsed.accepted).toBe(true)
        expect(parsed.ordinal).toBe(1)
        expect(parsed.reason).toBeUndefined()

        // 3. 持久化侧:cards.yaml 真的写了
        const cardsPath = join(
          root,
          'requirements',
          reqId,
          'analysis',
          'proposals',
          runId,
          'cards.yaml',
        )
        expect(existsSync(cardsPath)).toBe(true)
        const cardsContent = readFileSync(cardsPath, 'utf8')
        expect(cardsContent).toContain('退款接口')
        expect(cardsContent).toContain('suggested_priority: high')
        expect(cardsContent).toContain('suggested_status: backlog')
        expect(cardsContent).toContain('p0')
        expect(cardsContent).toContain('backend')

        // 4. meta.yaml 同步升 actual_count
        const metaPath = join(
          root,
          'requirements',
          reqId,
          'analysis',
          'proposals',
          runId,
          'meta.yaml',
        )
        const metaContent = readFileSync(metaPath, 'utf8')
        expect(metaContent).toContain('actual_count: 1')

        // 5. stderr 不应有排障行(全部 accepted,不该有 [prd-split] 输出)
        expect(stderrLines).toEqual([])
      } finally {
        ;(process.stderr as unknown as { write: typeof process.stderr.write }).write =
          origWrite
      }
    } finally {
      hub.close()
    }
  })

  // -------------------------------------------------------------------------
  // 契约 #3 —— 0-candidate 模型 end_turn → transitionToSucceeded 必须改走 failed
  // 真因 #2:无最小校验 → 模型 0 调用 → status='succeeded' + actual_count=0
  //         → banner「建议卡片组 0 条」静音成功
  // -------------------------------------------------------------------------
  it('契约#3 · 模型 0 张卡片 end_turn → Run 状态变 failed + error 含"0 candidates"', async () => {
    const reqId = 'req-prd-mcp-e2e-empty'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
    writeFileSync(
      join(root, 'requirements', reqId, 'requirement.md'),
      '# Test PRD\n\n足够长的 PRD 文本,避免空 PRD 触发 PR-5 前置拒绝。\n',
      'utf8',
    )

    const { PrdSplitService } = await import(
      '../../prd-split/PrdSplitService.js'
    )
    const service = new PrdSplitService({ root })
    const create = await service.createRun({
      requirementId: reqId,
      granularity: '中',
      expectedCount: 3,
      useContext: ['prd'],
    })
    if (!create.ok) throw new Error('create failed')
    const runId = create.run.run_id

    // (1) 模型没有调 propose_card,直接被 SDK 收尾 → 模拟真实 0 调用路径
    // 契约关键:即使 SDK 没返错,transitionToSucceeded 必须感知 candidates=0 → failed
    const result = service.transitionToSucceeded(reqId, runId)

    // (2) 真因 #2:这是契约关键 —— 必须走 failed 而非 succeeded
    expect(result.ok).toBe(true) // transition 本身成功(meta 写盘)
    if (!result.ok) return
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toMatch(/0 candidates/i)
    expect(result.run.actual_count).toBe(0)
    expect(result.run.finished_at).not.toBeNull()

    // (3) 持久化侧 meta.yaml 真的写成了 failed
    const metaPath = join(
      root,
      'requirements',
      reqId,
      'analysis',
      'proposals',
      runId,
      'meta.yaml',
    )
    const metaContent = readFileSync(metaPath, 'utf8')
    expect(metaContent).toContain('status: failed')
    expect(metaContent).toContain('error:')
    expect(metaContent).toMatch(/0 candidates/)
  })

  // -------------------------------------------------------------------------
  // 契约 #4 —— wrapper args 形态扫描(防 wrapper 二次包裹,镜像
  //            analysis-run-mcp-e2e.test.ts:382-495 it.each)
  // -------------------------------------------------------------------------
  it.each([
    {
      name: '裸 model input(title+content+priority+labels)',
      args: {
        title: 'A 卡',
        content: 'A 卡的 content',
        suggested_priority: 'medium' as const,
        labels: ['a'],
      },
      expectAccepted: true,
    },
    {
      name: 'SDK 二次包成 { args: ... } (假设的二次包形态)',
      args: {
        args: {
          title: 'B 卡',
          content: 'B 卡 content',
        },
      },
      expectAccepted: false,
      expectReason: 'title missing or empty',
    },
    {
      name: 'SDK 二次包成 { input: ... } (另一种二次包可能)',
      args: {
        input: {
          title: 'C 卡',
          content: 'C 卡 content',
        },
      },
      expectAccepted: false,
      expectReason: 'title missing or empty',
    },
    {
      name: '空对象(模型完全没传参)',
      args: {},
      expectAccepted: false,
      expectReason: 'title missing or empty',
    },
    {
      name: 'null(SDK 完全没传 args)',
      args: null,
      expectAccepted: false,
      expectReason: 'input not object',
    },
  ])(
    'args 形态=$name → accepted:$expectAccepted',
    async (tc) => {
      const reqId = `req-prd-mcp-e2e-shape-${tc.name.replace(/[^a-z0-9]/gi, '-')}`
      mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
      writeFileSync(
        join(root, 'requirements', reqId, 'requirement.md'),
        '# Test PRD\n\n足够长的 PRD 文本,避免空 PRD 触发 PR-5 前置拒绝。\n',
        'utf8',
      )

      const { PrdSplitService } = await import(
        '../../prd-split/PrdSplitService.js'
      )
      const localService = new PrdSplitService({ root })
      const create = await localService.createRun({
        requirementId: reqId,
        granularity: '中',
        expectedCount: 3,
        useContext: ['prd'],
      })
      if (!create.ok) throw new Error('create failed')
      const runId = create.run.run_id

      const { createSseHub } = await import('../../sse/SseHub.js')
      const localHub = createSseHub({ heartbeatMs: 60_000 })

      try {
        const { createClaudeCodeProvider } = await import(
          '../../providers/ClaudeCodeProvider.js'
        )
        const provider = createClaudeCodeProvider({
          ccSwitch: makeEmptyCcSwitch() as never,
          queryFn: successQueryStream as never,
        })

        const { makeProposeCardHandler } = await import(
          '../../prd-split/PrdSplitRunner.js'
        )
        const h = makeProposeCardHandler({
          service: localService,
          hub: localHub,
          requirementId: reqId,
          runId,
        })

        await provider.runAnalysisQuery({
          prompt: 'test',
          systemPrompt: 'test',
          cwd: '/tmp',
          allowedTools: ['Read'],
          businessTools: { propose_card: h as never },
          onEvent: () => {},
        })

        const wrapperResult = await mockToolHandlers['propose_card'](tc.args)
        const text = wrapperResult.content[0]?.text ?? '{}'
        const parsed = JSON.parse(text) as {
          accepted: boolean
          ordinal?: number
          reason?: string
        }

        expect(parsed.accepted).toBe(tc.expectAccepted)
        if (tc.expectReason) {
          expect(parsed.reason).toBe(tc.expectReason)
        }
        if (tc.expectAccepted) {
          expect(parsed.ordinal).toBe(1)
        }
      } finally {
        localHub.close()
      }
    },
  )
})
