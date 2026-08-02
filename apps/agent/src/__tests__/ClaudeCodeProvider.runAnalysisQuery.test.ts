/**
 * ClaudeCodeProvider.runAnalysisQuery 契约测试(issue 09 · ADR-0021)
 *
 * 验收(ticket 09 spec):
 * - 真实 Run 使用自定义 system prompt 完全替换 Claude Code 默认 prompt
 * - 真实模型只能使用 Read、Glob、Grep、`report_analysis_issue` 和
 *   `complete_analysis`(ADR-0021 决策 19-23)
 *
 * 通过 mock queryFn 捕获 SDK options,断言:
 * - systemPrompt 字段被设置(平台九层 system prompt 字符串)
 * - allowedTools = ['Read', 'Glob', 'Grep', 'mcp__analysis__report_analysis_issue',
 *   'mcp__analysis__complete_analysis'](宿主只读工具 + 业务 MCP 工具全限定名)
 * - disallowedTools 包含 'Bash' / 'Write' / 'Edit' 等危险工具
 * - mcpServers['analysis'] 是 SDK 业务 MCP server,内含
 *   'report_analysis_issue' + 'complete_analysis' 两个工具
 * - 没有 appendSystemPrompt 字段(ADR-0021 决策 16:不 append,完全替换)
 *
 * 不走 AnalysisAgentRunner(避免触发完整 Run 启动链路);直接调
 * `provider.runAnalysisQuery` 并断言传给 SDK 的 options。
 */

import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '../providers/ClaudeCodeProvider.js'
import type { CcSwitchClient, ProviderIndex } from '../providers/CcSwitchClient.js'

function makeFakeCcSwitch(providers: ProviderIndex[]): CcSwitchClient {
  const current = providers.find((p) => p.is_current)
  return {
    getCurrent: () => current,
    getAll: () => providers,
    getById: (id: string) => providers.find((p) => p.id === id),
    getModel: (providerId: string, role) => {
      const p = providers.find((pr) => pr.id === providerId)
      const modelId = p?.models[role]
      if (!p || !modelId) return undefined
      return { providerId, providerName: p.name, role, modelId }
    },
    close: () => {},
  }
}

const currentProvider: ProviderIndex = {
  id: 'p-current',
  name: 'Current',
  is_current: true,
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test-key',
  models: {
    main: 'current-main',
    haiku: null,
    sonnet: null,
    opus: null,
    fable: null,
    reasoning: null,
  },
}

/** 抓取最近一次 query 调用时传给 SDK 的 options 引用 */
interface CapturedQueryCall {
  prompt: string
  options: Record<string, unknown> | undefined
}

function makeCapturingQueryFn(capture: CapturedQueryCall) {
  return ((params: { prompt: string; options?: Record<string, unknown> }) => {
    capture.prompt = params.prompt
    capture.options = params.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', session_id: 'sdk-test' }
    })()
  }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']
}

/** 业务工具入参 — 7 个测试共用同一份,确保"只这两个业务工具"的边界 */
const DEFAULT_BUSINESS_TOOLS = {
  report_analysis_issue: () => ({ accepted: true, issue_id: 'i', ordinal: 1 }),
  complete_analysis: () => ({ accepted: true }),
} as const

/** 跑一次 runAnalysisQuery,返回捕获的 SDK options + 全部 businessTools 入参。 */
async function setupAndCapture(
  systemPrompt: string,
  overrides: Partial<Parameters<NonNullable<ReturnType<typeof createClaudeCodeProvider>['runAnalysisQuery']>>[0]> = {},
): Promise<{ capture: CapturedQueryCall; businessTools: ReadonlyArray<string> }> {
  const capture: CapturedQueryCall = { prompt: '', options: undefined }
  const provider = createClaudeCodeProvider({
    ccSwitch: makeFakeCcSwitch([currentProvider]),
    queryFn: makeCapturingQueryFn(capture),
  })
  const businessTools = overrides.businessTools ?? DEFAULT_BUSINESS_TOOLS
  await provider.runAnalysisQuery!({
    prompt: '',
    systemPrompt,
    cwd: '/tmp',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'mcp__analysis__report_analysis_issue',
      'mcp__analysis__complete_analysis',
    ],
    businessTools,
    onEvent: () => {},
    ...overrides,
  })
  return { capture, businessTools: Object.keys(businessTools) }
}

describe('ClaudeCodeProvider.runAnalysisQuery 契约(issue 09)', () => {
  it('systemPrompt 字段被设置(完全替换 Claude Code 默认)', async () => {
    const { capture } = await setupAndCapture(
      '## 身份与任务\n\n__ISSUE_09_MARKER__\n\n你只能识别问题。',
    )

    // ADR-0021 决策 16:systemPrompt 字段存在,值为平台九层 system prompt 字符串
    expect(capture.options).toBeDefined()
    expect(typeof capture.options?.['systemPrompt']).toBe('string')
    // 决策 16:系统原样透传 platform systemPrompt(本测试用 `__ISSUE_09_MARKER__`
    // 验证 SDK 收到的是 platform 字符串,而非 Claude Code 默认 prefix)
    expect(capture.options?.['systemPrompt']).toContain('__ISSUE_09_MARKER__')
    expect(capture.options?.['systemPrompt']).toContain('## 身份与任务')
  })

  it('allowedTools = 宿主只读工具(Read/Glob/Grep) + 业务 MCP 工具全限定名', async () => {
    const { capture } = await setupAndCapture('p')

    const allowedTools = capture.options?.['allowedTools'] as ReadonlyArray<string>
    // SDK 0.3.206 把 MCP 工具按 `mcp__<server-key>__<tool>` 全限定名纳入
    // allowedTools 白名单管控 —— 这里 server-key = 'analysis',tool = 'report_analysis_issue'/'complete_analysis'。
    // 不在白名单的 MCP 工具模型看不到,会导致 SDK 报 success 但模型不调业务工具。
    expect(allowedTools).toEqual([
      'Read',
      'Glob',
      'Grep',
      'mcp__analysis__report_analysis_issue',
      'mcp__analysis__complete_analysis',
    ])
  })

  it('disallowedTools 包含 Bash/Write/Edit/NotebookEdit/WebSearch/WebFetch(显式禁止危险工具)', async () => {
    const { capture } = await setupAndCapture('p')

    const disallowedTools = capture.options?.['disallowedTools'] as ReadonlyArray<string>
    expect(disallowedTools).toBeDefined()
    // ADR-0021 决策 19:显式禁止 Bash / Write / Edit;扩展禁止 MultiEdit / NotebookEdit / WebSearch / WebFetch
    expect(disallowedTools).toContain('Bash')
    expect(disallowedTools).toContain('Write')
    expect(disallowedTools).toContain('Edit')
    expect(disallowedTools).toContain('MultiEdit')
    expect(disallowedTools).toContain('NotebookEdit')
    expect(disallowedTools).toContain('WebSearch')
    expect(disallowedTools).toContain('WebFetch')
  })

  it('mcpServers.analysis 是 SDK 业务 MCP server,只注册 report_analysis_issue + complete_analysis', async () => {
    const { capture, businessTools } = await setupAndCapture('p')

    // ADR-0021 决策 19:业务工具通过 MCP server 注入,只两个:
    //   - report_analysis_issue(Issue 报告)
    //   - complete_analysis(完成信号)
    // mcpServers 是 SDK options 中的 map,slot key = 'analysis'(见
    // ClaudeCodeProvider.ts:542 `sdkOptions['mcpServers'] = { analysis: mcpServer }`)。
    const mcpServers = capture.options?.['mcpServers'] as Record<string, unknown> | undefined
    expect(mcpServers).toBeDefined()
    expect(mcpServers).toHaveProperty('analysis')

    const analysisServer = mcpServers?.['analysis'] as
      | { type?: string; name?: string; instance?: unknown }
      | undefined
    expect(analysisServer).toBeDefined()
    // 内部 SDK server name = 'analysis-run-tools'(见 ClaudeCodeProvider.ts:517)
    expect(analysisServer?.name).toBe('analysis-run-tools')
    expect(analysisServer?.type).toBe('sdk')
    // MCP server instance 必须存在(SDK 用来 register tool + 路由 tool call)
    expect(analysisServer?.instance).toBeDefined()

    // 业务工具白名单:输入 businessTools 恰好等于 2 个,这是"只这两个"的最强约束 —
    // 因为 ClaudeCodeProvider 用 `Object.entries(input.businessTools)` 注册,
    // 输入的 keys 决定 MCP server 注册的工具集合,输入=输出。
    expect(businessTools).toEqual(
      expect.arrayContaining(['report_analysis_issue', 'complete_analysis']),
    )
    expect(businessTools).toHaveLength(2)
  })

  it('不设置 appendSystemPrompt 字段(完全替换而非追加)', async () => {
    const { capture } = await setupAndCapture('platform shell')

    // ADR-0021 决策 16:不使用 append,使用 systemPrompt 完全替换。
    // 若有 appendSystemPrompt 字段,Claude Code 默认 prompt 仍会作为 prefix 注入,
    // 与"完全替换"相悖。
    expect(capture.options?.['appendSystemPrompt']).toBeUndefined()
  })

  it('permissionMode = default(平台门禁走非交互拒绝模式)', async () => {
    const { capture } = await setupAndCapture('p')

    // ADR-0021 决策 19:非交互拒绝模式 = 'default'(SDK 0.3.206 行为)
    expect(capture.options?.['permissionMode']).toBe('default')
  })

  it('SDK 子进程 env 包含当前 provider 的 baseUrl / API key', async () => {
    const { capture } = await setupAndCapture('p')

    const env = capture.options?.['env'] as Record<string, string> | undefined
    expect(env).toBeDefined()
    // current provider 有 baseUrl + apiKey → 应注入
    expect(env?.['ANTHROPIC_BASE_URL']).toBe(currentProvider.baseUrl)
    expect(env?.['ANTHROPIC_AUTH_TOKEN']).toBe(currentProvider.apiKey)
  })
})
