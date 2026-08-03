/**
 * 真 MCP server 路径 e2e (PR-2 / ticket 10)
 *
 * 目的:用真 `ClaudeCodeProvider` + 真 `AnalysisAgentRunner` 业务工具 handler,
 *      mock SDK 暴露 wrapper 出口,直接调用 wrapper 验证 args 透传到
 *      parseReportIssueInput → runService.reportIssue → issues.jsonl 写入
 *      的整条链路是否成立。
 *
 * 暴露的真因(ticket 10 R1):
 * - 如果 wrapper 把 SDK 透传的 args 二次包了一层(比如 `{args: modelInput}`),
 *   parseReportIssueInput 在 `typeof o.title === 'string'` 处 fail,
 *   handler 静默返 `{accepted: false, reason: 'input not object' | 'title missing'}`,
 *   issues.jsonl 始终 0 字节 —— 这就是真实模型跑时的真因。
 *
 * 与 fakeAnalysisQueryProvider 的区别:
 * - fake provider 走 `input.businessTools[name]` 直 dispatch,**绕过 wrapper**;
 * - 本测试走真 `createSdkMcpServer` + `tool(...)` 注册路径,确保 wrapper 真的被
 *   SDK 内部协议调用过(虽然是 mock 的 SDK,但 wrapper 闭包不变)。
 *
 * 状态:本测试应 RED 在 ticket 10 修复前(如果 R1 真存在),
 *      GREEN 在 PR-3 修 wrapper 后。
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
// ============================================================================

const mockToolHandlers: Record<
  string,
  (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
> = {}
const mockToolSchemas: Record<string, Record<string, unknown>> = {}

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
      // 捕获所有注册的 tool handler —— 测试后续手动调用
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

async function* successQueryStream(): AsyncIterable<MockQueryResult> {
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

describe('真 MCP server 路径 e2e (PR-2 / ticket 10)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-mcp-e2e-'))
    // 清空 mock 状态
    for (const k of Object.keys(mockToolHandlers)) delete mockToolHandlers[k]
    for (const k of Object.keys(mockToolSchemas)) delete mockToolSchemas[k]
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('wrapper 直传 args(model input 完整 snake_case + 对象 metadata)→ issues.jsonl 写入 1 行', async () => {
    // 准备 workspace
    const reqId = 'req-mcp-e2e'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
    writeFileSync(
      join(root, 'requirements', reqId, 'requirement.md'),
      '# Test PRD\n\n足够长的 PRD 文本,避免空 PRD 触发 PR-5 前置拒绝。\n',
      'utf8',
    )

    // 真 AnalysisRunService
    const { AnalysisRunService } = await import(
      '../../analysis-run/AnalysisRunService.js'
    )
    const runService = new AnalysisRunService(root)
    const create = await runService.createRun({
      requirementId: reqId,
      skillName: 'prd-completeness',
    })
    expect(create.ok).toBe(true)
    if (!create.ok) throw new Error('create failed')
    const runId = create.run.run_id

    // 真 SSE hub(吸收事件即可,不验证内容)
    const { createSseHub } = await import('../../sse/SseHub.js')
    const hub = createSseHub({ heartbeatMs: 60_000 })

    try {
      // 真 ClaudeCodeProvider(用 queryFn 绕过真 SDK query)
      const { createClaudeCodeProvider } = await import(
        '../../providers/ClaudeCodeProvider.js'
      )
      const provider = createClaudeCodeProvider({
        ccSwitch: makeEmptyCcSwitch() as never,
        queryFn: successQueryStream as never,
      })

      // 真业务工具 handler(用 export 出来的工厂)
      const {
        makeReportIssueHandler,
        makeCompleteAnalysisHandler,
      } = await import('../../analysis-run/AnalysisAgentRunner.js')
      const reportIssueHandler = makeReportIssueHandler({
        runService,
        hub,
        requirementId: reqId,
        runId,
      })
      const completeAnalysisHandler = makeCompleteAnalysisHandler({
        runService,
        hub,
        requirementId: reqId,
        runId,
      })
      const businessTools = {
        report_analysis_issue: reportIssueHandler as never,
        complete_analysis: completeAnalysisHandler as never,
      }

      // 调真 provider.runAnalysisQuery —— 触发 SDK mock 捕获 wrapper
      const result = await provider.runAnalysisQuery({
        prompt: 'test',
        systemPrompt: 'test',
        cwd: '/tmp',
        allowedTools: ['Read'],
        businessTools,
        onEvent: () => {},
      })
      // 我们的 queryFn 只 yield 一个 success result;provider 应当返 ok
      expect(result.ok).toBe(true)

      // 关键断言:wrapper 已被 mock SDK 捕获
      expect(mockToolHandlers['report_analysis_issue']).toBeDefined()
      expect(mockToolHandlers['complete_analysis']).toBeDefined()

      // PR-3 回归:SDK 会按 raw shape 过滤工具参数,报告工具不能注册空 shape。
      expect(Object.keys(mockToolSchemas['report_analysis_issue'] ?? {})).toEqual([
        'title',
        'description',
        'source_refs',
        'metadata',
      ])

      // 模拟 SDK 调 wrapper —— 用模型真实 output 形态(snake_case source_refs + 对象 metadata)
      const modelInput = {
        title: '【目标与背景】需求价值缺少业务/财务结果量化指标',
        description:
          'PRD "需求价值" 章节只给了"操作时间"维度,缺少业务结果/财务结果的可衡量成功指标。',
        source_refs: [{ kind: 'requirement', relative_path: 'requirement.md' }],
        metadata: { dimension: '目标与背景', severity: 'warn', confidence: 'high' },
      }

      // 收集 stderr 排障行
      const stderrLines: string[] = []
      const origWrite = process.stderr.write.bind(process.stderr)
      ;(process.stderr as unknown as { write: typeof process.stderr.write }).write = ((
        chunk: string | Buffer,
        ...rest: unknown[]
      ) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        if (s.includes('[analysis-run]')) stderrLines.push(s)
        return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
      }) as typeof process.stderr.write

      try {
        // 调 wrapper —— 模拟 SDK 内部 tool_use 协议
        const wrapperResult = await mockToolHandlers['report_analysis_issue'](
          modelInput,
        )

        // 1. CallToolResult 形态
        expect(wrapperResult.content).toHaveLength(1)
        expect(wrapperResult.content[0]?.type).toBe('text')
        const text = wrapperResult.content[0]?.text ?? ''
        const parsed = JSON.parse(text) as {
          accepted: boolean
          issue_id: string
          ordinal: number
          reason?: string
        }

        // 2. accepted:true + issue_id + ordinal(若 R1 真存在,这里会是 accepted:false)
        expect(parsed.accepted).toBe(true)
        expect(parsed.issue_id).toMatch(/^iss-/)
        expect(parsed.ordinal).toBe(1)
        // 不应带 reason 字段
        expect(parsed.reason).toBeUndefined()

        // 3. 持久化侧 —— issues.jsonl 真的写入了
        const issuesFile = join(root, 'requirements', reqId, 'analysis', 'runs', runId, 'issues.jsonl')
        expect(existsSync(issuesFile)).toBe(true)
        const content = readFileSync(issuesFile, 'utf8').trim()
        expect(content).not.toBe('')
        const issue = JSON.parse(content.split('\n')[0]!) as {
          issue_id: string
          ordinal: number
          source_refs: unknown[]
        }
        expect(issue.ordinal).toBe(1)
        expect(issue.source_refs).toEqual([
          { kind: 'requirement', relative_path: 'requirement.md' },
        ])

        // 4. meta.yaml 真的更新了 issue_count
        const metaFile = join(
          root,
          'requirements',
          reqId,
          'analysis',
          'runs',
          runId,
          'meta.yaml',
        )
        const meta = readFileSync(metaFile, 'utf8')
        expect(meta).toContain('issue_count: 1')

        // 5. stderr 不应有排障行(全部 accepted,不该有 [analysis-run] 输出)
        expect(stderrLines).toEqual([])
      } finally {
        ;(process.stderr as unknown as { write: typeof process.stderr.write }).write =
          origWrite
      }
    } finally {
      hub.close()
    }
  })

  it('wrapper 直传 args(title 缺失)→ accepted:false + reason:"title missing" + 0 字节 issues.jsonl', async () => {
    // 负面路径:验证 PR-1 的 reason 透传在真 wrapper 路径上同样生效
    const reqId = 'req-mcp-e2e-bad'
    mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
    writeFileSync(join(root, 'requirements', reqId, 'requirement.md'), '# x\n', 'utf8')

    const { AnalysisRunService } = await import(
      '../../analysis-run/AnalysisRunService.js'
    )
    const runService = new AnalysisRunService(root)
    const create = await runService.createRun({
      requirementId: reqId,
      skillName: 'prd-completeness',
    })
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
      const { makeReportIssueHandler } = await import(
        '../../analysis-run/AnalysisAgentRunner.js'
      )
      const reportIssueHandler = makeReportIssueHandler({
        runService,
        hub,
        requirementId: reqId,
        runId,
      })

      await provider.runAnalysisQuery({
        prompt: 'test',
        systemPrompt: 'test',
        cwd: '/tmp',
        allowedTools: ['Read'],
        businessTools: { report_analysis_issue: reportIssueHandler as never } as never,
        onEvent: () => {},
      })

      expect(mockToolHandlers['report_analysis_issue']).toBeDefined()

      // 缺 title
      const wrapperResult = await mockToolHandlers['report_analysis_issue']({
        description: 'd',
        source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      })
      const text = wrapperResult.content[0]?.text ?? ''
      const parsed = JSON.parse(text) as {
        accepted: boolean
        reason?: string
      }
      expect(parsed.accepted).toBe(false)
      expect(parsed.reason).toBe('title missing')

      // 持久化侧:0 字节
      const issuesFile = join(
        root,
        'requirements',
        reqId,
        'analysis',
        'runs',
        runId,
        'issues.jsonl',
      )
      const content = readFileSync(issuesFile, 'utf8')
      expect(content).toBe('')
    } finally {
      hub.close()
    }
  })

  /**
   * 多 args 形态扫一遍 —— 给 PR-3 修 wrapper 时一个明确输入集合,
   * 看到哪个形态 accepted:true / 哪个 accepted:false 就能定位 SDK 实际
   * 传过来的 args 长什么样(配合 PR-1 stderr 排障行)。
   *
   * 不动业务 handler 实现,只是把"我们期望 wrapper 接受什么"锁在测试里。
   */
  it.each([
    {
      name: '裸 model input(我们期望 SDK 透传形态)',
      args: {
        title: 't',
        description: 'd',
        source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
      },
      expectAccepted: true,
    },
    {
      name: '被 SDK 二次包成 {args: ...} (ticket 10 假设 R1.A 形态)',
      args: {
        args: {
          title: 't',
          description: 'd',
          source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
        },
      },
      expectAccepted: false,
      expectReason: 'title missing',
    },
    {
      name: '被 SDK 包成 {input: ...} (另一种二次包可能)',
      args: {
        input: {
          title: 't',
          description: 'd',
          source_refs: [{ kind: 'requirement', relative_path: 'r.md' }],
        },
      },
      expectAccepted: false,
      expectReason: 'title missing',
    },
    {
      name: '空对象(模型完全没传参)',
      args: {},
      expectAccepted: false,
      expectReason: 'title missing',
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
      const reqId = `req-mcp-e2e-shape-${tc.name.replace(/[^a-z0-9]/gi, '-')}`
      mkdirSync(join(root, 'requirements', reqId, 'analysis'), { recursive: true })
      writeFileSync(join(root, 'requirements', reqId, 'requirement.md'), '# x\n', 'utf8')

      const { AnalysisRunService } = await import(
        '../../analysis-run/AnalysisRunService.js'
      )
      const localService = new AnalysisRunService(root)
      const create = await localService.createRun({
        requirementId: reqId,
        skillName: 'prd-completeness',
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
        const { makeReportIssueHandler } = await import(
          '../../analysis-run/AnalysisAgentRunner.js'
        )
        const h = makeReportIssueHandler({
          runService: localService,
          hub: localHub,
          requirementId: reqId,
          runId,
        })
        await provider.runAnalysisQuery({
          prompt: 'test',
          systemPrompt: 'test',
          cwd: '/tmp',
          allowedTools: ['Read'],
          businessTools: { report_analysis_issue: h as never } as never,
          onEvent: () => {},
        })

        const wrapperResult = await mockToolHandlers['report_analysis_issue'](
          tc.args,
        )
        const parsed = JSON.parse(wrapperResult.content[0]?.text ?? '{}') as {
          accepted: boolean
          reason?: string
        }

        expect(parsed.accepted).toBe(tc.expectAccepted)
        if (tc.expectReason) {
          expect(parsed.reason).toBe(tc.expectReason)
        }
        if (tc.expectAccepted) {
          expect(parsed.issue_id).toMatch(/^iss-/)
          expect(parsed.ordinal).toBe(1)
        }
      } finally {
        localHub.close()
      }
    },
  )
})
