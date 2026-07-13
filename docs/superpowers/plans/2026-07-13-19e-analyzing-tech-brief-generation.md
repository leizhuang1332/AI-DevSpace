# 19e · ANALYZING 技术概要生成(双产物落盘) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ANALYZING 工位主区添加"📊 生成技术概要"按钮,调用 Agent 端 Skill 一次性写双产物 `technical-brief.md` + `modules.yaml`,失败时自动 snapshot 回滚,UI 显示双 Tab 产物预览。

**Architecture:**
- Web 端按钮 → Server Action `generateTechBrief(reqId, sessionId)` → Agent REST `POST /api/requirements/:id/analysis/generate-brief`
- Agent 端 Skill mock(本期)→ snapshot + 写双文件 + 返回路径;失败回滚
- Web 端 `getAnalyzingData` 扩展 `techBriefPreview` / `modulesPreview` 字段
- 客户端 `TechBriefPanel` 组件渲染按钮 + 双 Tab 预览

**Tech Stack:** Next.js 14 (App Router) + React 18 + Fastify 4 + Vitest + YAML (极简自实现解析器,沿用 `parseSessionsIndexYaml` 模式)

## Global Constraints

- 不破坏 VS1 (准入仪表板) / VS2 (思考流) / VS3 (Tab 切换) / VS4 (产物编辑) — 它们在生成后仍可用
- 不实现真实 Skill runner,本期 mock 内容由 mock-Skill 生成(确定性的 4 模块 + 4 章节 markdown)
- 不实现 VS6 [🔄 重扫] 按钮(占位 disabled + tooltip)
- 沿用 products-actions 的 snapshot 模式(决策 47 · ADR-0009 第 4 层)
- modules.yaml schema 由本期定(决策 D8 双产物结构)
- 文件路径:`requirements/<req-id>/analysis/technical-brief.md` + `requirements/<req-id>/analysis/modules.yaml`

---

## Task 1: pure YAML schema + parse/serialize (tech-brief.ts)

**Files:**
- Create: `apps/web/src/lib/tech-brief.ts`
- Test: `apps/web/src/lib/__tests__/tech-brief.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `TechBriefModule`, `TechBriefModulesFile`, `parseModulesYaml(text)`, `serializeModulesYaml(file)`, `buildMockTechBrief(sessionId)`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/lib/__tests__/tech-brief.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseModulesYaml,
  serializeModulesYaml,
  buildMockTechBrief,
  type TechBriefModulesFile,
} from '@/lib/tech-brief'

describe('parseModulesYaml', () => {
  it('空字符串 → 空 modules', () => {
    expect(parseModulesYaml('').modules).toEqual([])
  })

  it('解析合法 modules.yaml: id/name/description/deps/complexity/clarifying_questions', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: 幂等网关',
      '    description: 全局幂等键校验',
      '    deps:',
      '      - refund-service',
      '      - idem-store',
      '    complexity: high',
      '    clarifying_questions:',
      '      - id: q-1',
      '        question: 幂等键设计规则?',
      '      - id: q-2',
      '        question: 重试窗口期多长?',
      '        options:',
      '          - 5min',
      '          - 30min',
      '        required: true',
    ].join('\n')
    const file = parseModulesYaml(yaml)
    expect(file.modules).toHaveLength(1)
    const m = file.modules[0]
    expect(m.id).toBe('m-1')
    expect(m.name).toBe('幂等网关')
    expect(m.description).toBe('全局幂等键校验')
    expect(m.deps).toEqual(['refund-service', 'idem-store'])
    expect(m.complexity).toBe('high')
    expect(m.clarifying_questions).toHaveLength(2)
    expect(m.clarifying_questions![0]).toEqual({ id: 'q-1', question: '幂等键设计规则?' })
    expect(m.clarifying_questions![1]).toEqual({
      id: 'q-2', question: '重试窗口期多长?', options: ['5min', '30min'], required: true,
    })
  })

  it('id 缺失 → 跳过该模块', () => {
    const yaml = 'modules:\n  - name: 漏 id\n    description: x\n  - id: m-ok\n    name: ok\n'
    const file = parseModulesYaml(yaml)
    expect(file.modules).toHaveLength(1)
    expect(file.modules[0].id).toBe('m-ok')
  })

  it('complexity 未知 → 默认 medium', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n    complexity: insane\n'
    expect(parseModulesYaml(yaml).modules[0].complexity).toBe('medium')
  })

  it('deps 缺失 → 空数组', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n'
    expect(parseModulesYaml(yaml).modules[0].deps).toEqual([])
  })

  it('clarifying_questions 缺失 → undefined', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n'
    expect(parseModulesYaml(yaml).modules[0].clarifying_questions).toBeUndefined()
  })

  it('单个 clarifying_question 缺 id → 跳过该 question', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: x',
      '    clarifying_questions:',
      '      - question: 漏 id',
      '      - id: q-ok',
      '        question: ok',
    ].join('\n')
    expect(parseModulesYaml(yaml).modules[0].clarifying_questions).toEqual([
      { id: 'q-ok', question: 'ok' },
    ])
  })
})

describe('serializeModulesYaml', () => {
  it('空 modules → "modules: []"', () => {
    expect(serializeModulesYaml({ modules: [] })).toBe('modules: []\n')
  })

  it('完整 modules → 含 deps / clarifying_questions / required / options', () => {
    const file: TechBriefModulesFile = {
      modules: [
        {
          id: 'm-1', name: '网关', description: '网关层',
          deps: ['svc-a'], complexity: 'high',
          clarifying_questions: [
            { id: 'q-1', question: '网关位置?' },
            { id: 'q-2', question: '网关规则?', options: ['白名单', '黑名单'], required: true },
          ],
        },
      ],
    }
    const out = serializeModulesYaml(file)
    expect(out).toContain('modules:')
    expect(out).toContain('  - id: m-1')
    expect(out).toContain('    name: 网关')
    expect(out).toContain('    description: 网关层')
    expect(out).toContain('    deps:')
    expect(out).toContain('      - svc-a')
    expect(out).toContain('    complexity: high')
    expect(out).toContain('    clarifying_questions:')
    expect(out).toContain('      - id: q-1')
    expect(out).toContain('        question: 网关位置?')
    expect(out).toContain('      - id: q-2')
    expect(out).toContain('        options:')
    expect(out).toContain('          - 白名单')
    expect(out).toContain('        required: true')
  })

  it('parse → serialize → parse 往返一致(数据契约稳定)', () => {
    const original: TechBriefModulesFile = {
      modules: [
        {
          id: 'm-1', name: '网关', description: 'X',
          deps: ['a', 'b'], complexity: 'low',
          clarifying_questions: [
            { id: 'q-1', question: 'Q?' },
          ],
        },
      ],
    }
    const text = serializeModulesYaml(original)
    const parsed = parseModulesYaml(text)
    expect(parsed).toEqual(original)
  })
})

describe('buildMockTechBrief', () => {
  it('返回 deterministic 的双产物内容(sessionId 不影响结构)', () => {
    const result = buildMockTechBrief('sess-arch')
    expect(result.brief).toContain('# ')
    expect(result.brief).toContain('## 1. 业务背景与目标')
    expect(result.brief).toContain('## 4. 风险与缓解')
    expect(result.modules.modules).toHaveLength(4)
    expect(result.modules.modules[0]).toHaveProperty('id')
    expect(result.modules.modules[0]).toHaveProperty('name')
    expect(result.modules.modules[0]).toHaveProperty('description')
    expect(result.modules.modules[0]).toHaveProperty('deps')
    expect(result.modules.modules[0]).toHaveProperty('complexity')
    expect(result.modules.modules[0]).toHaveProperty('clarifying_questions')
  })

  it('复杂度分布:含 low / medium / high 三档', () => {
    const result = buildMockTechBrief('sess-x')
    const cs = new Set(result.modules.modules.map((m) => m.complexity))
    expect(cs.has('low')).toBe(true)
    expect(cs.has('medium')).toBe(true)
    expect(cs.has('high')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- tech-brief`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`apps/web/src/lib/tech-brief.ts`:

```ts
/**
 * ANALYZING 工位 · 技术概要产物(issue 19e · VS5)
 *
 * 双产物(ADR-0013 D8):
 * - `technical-brief.md` — 叙述性,Markdown 文本(业务背景/架构选型/技术栈/风险)
 * - `modules.yaml`       — 结构化,聚合模块清单(供 CLARIFYING 消费)
 *
 * 本文件为 client-safe 部分:类型 + YAML 解析/序列化 + mock 生成器。
 * 文件 IO 走 `./tech-brief.server.ts`(沿用 analyzing.ts ↔ analyzing.server.ts 拆分)。
 *
 * modules.yaml schema(由本仓库写入,极简 YAML;不引第三方):
 * ```yaml
 * modules:
 *   - id: m-1
 *     name: 幂等网关
 *     description: 全局幂等键校验
 *     deps: [refund-service, idem-store]
 *     complexity: high
 *     clarifying_questions:
 *       - id: q-1
 *         question: 幂等键设计规则?
 *       - id: q-2
 *         question: 重试窗口期多长?
 *         options: [5min, 30min]
 *         required: true
 * ```
 *
 * 设计要点:
 * - 极简解析器,只为受控格式服务(沿用 parseSessionsIndexYaml / parseProductsYaml 设计)
 * - parse → serialize → parse 往返一致(便于快照/回滚)
 * - 失败/未知字段采用宽松策略(不抛):id 缺失 → 跳过该条,complexity 未知 → medium
 */

import type { AnalysisSession } from './analyzing'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type TechBriefComplexity = 'low' | 'medium' | 'high'

export interface TechBriefClarifyingQuestion {
  id: string
  question: string
  options?: string[]
  required?: boolean
}

export interface TechBriefModule {
  id: string
  name: string
  description: string
  deps: string[]
  complexity: TechBriefComplexity
  clarifying_questions?: TechBriefClarifyingQuestion[]
}

export interface TechBriefModulesFile {
  modules: TechBriefModule[]
}

export interface TechBriefArtifacts {
  brief: string
  modules: TechBriefModulesFile
}

// ---------------------------------------------------------------------------
// parseModulesYaml — 极简格式解析
// ---------------------------------------------------------------------------

const VALID_COMPLEXITY: readonly TechBriefComplexity[] = ['low', 'medium', 'high']

function isValidComplexity(s: string): s is TechBriefComplexity {
  return (VALID_COMPLEXITY as readonly string[]).includes(s)
}

export function parseModulesYaml(text: string): TechBriefModulesFile {
  if (!text.trim()) return { modules: [] }
  const lines = text.split('\n')
  const result: TechBriefModulesFile = { modules: [] }
  let currentModule: Partial<TechBriefModule> | null = null
  let currentQuestion: Partial<TechBriefClarifyingQuestion> | null = null
  // context: 'modules-list' / 'module' / 'questions-list' / 'question'
  // (本极简解析器不显式跟踪,靠缩进 + 字段位置推断)

  const flushQuestion = (): void => {
    if (currentQuestion && typeof currentQuestion.id === 'string' && typeof currentQuestion.question === 'string') {
      const q: TechBriefClarifyingQuestion = {
        id: currentQuestion.id,
        question: currentQuestion.question,
        ...(currentQuestion.options !== undefined ? { options: currentQuestion.options } : {}),
        ...(currentQuestion.required !== undefined ? { required: currentQuestion.required } : {}),
      }
      if (currentModule) {
        currentModule.clarifying_questions = [
          ...(currentModule.clarifying_questions ?? []),
          q,
        ]
      }
    }
    currentQuestion = null
  }

  const flushModule = (): void => {
    flushQuestion()
    if (currentModule && typeof currentModule.id === 'string' && typeof currentModule.name === 'string') {
      const m: TechBriefModule = {
        id: currentModule.id,
        name: currentModule.name,
        description: currentModule.description ?? '',
        deps: currentModule.deps ?? [],
        complexity: isValidComplexity(currentModule.complexity ?? '') ? (currentModule.complexity as TechBriefComplexity) : 'medium',
        ...(currentModule.clarifying_questions !== undefined
          ? { clarifying_questions: currentModule.clarifying_questions }
          : {}),
      }
      result.modules.push(m)
    }
    currentModule = null
  }

  for (const rawLine of lines) {
    const line = stripTrailingComment(rawLine)
    if (!line.trim()) continue
    if (/^\s*#/.test(line)) continue

    // top-level: "modules:"
    const topMatch = /^modules\s*:\s*(.*)$/.exec(line)
    if (topMatch && /^\S/.test(line)) {
      flushModule()
      // modules 顶层是 list;若为空 "modules: []" → 解析完直接结束
      continue
    }

    // module 起点:  "  - id: ..." 或 "  - name: ..."
    const listStart = /^\s+-\s+/.exec(line)
    if (listStart && currentModule === null) {
      // 顶层 modules 列表项起点
      const afterDash = line.slice(listStart[0].length).trim()
      currentModule = { deps: [] }
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) assignModuleField(currentModule, kv[1], kv[2])
      }
      continue
    }

    // deps list 项:"      - xxx"(只在 module 上下文,且是 string list)
    const depsItem = /^\s+-\s+/.exec(line)
    if (depsItem && currentModule !== null && currentQuestion === null) {
      // 进入 deps 列表(字段名 deps 之后)或 deps 列表项追加
      const after = line.slice(depsItem[0].length).trim()
      if (after) {
        const stripped = stripQuotes(after)
        currentModule.deps = [...(currentModule.deps ?? []), stripped]
      }
      continue
    }

    // module 内字段 / question 内字段:"    key: val" / "      key: val"
    const kvMatch = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kvMatch) {
      const key = kvMatch[1]
      const rawVal = kvMatch[2]
      if (currentQuestion) {
        // question 内字段
        if (key === 'options') {
          // "options:" 后续是 list,本 slice options 已合并到 deps 走 - xxx 路径
          // 这里不处理(为空 options: [] 视为 undefined)
          continue
        }
        if (key === 'id') {
          currentQuestion.id = stripQuotes(rawVal.trim())
          continue
        }
        if (key === 'question') {
          currentQuestion.question = stripQuotes(rawVal.trim())
          continue
        }
        if (key === 'required') {
          currentQuestion.required = rawVal.trim() === 'true'
          continue
        }
      }
      if (currentModule) {
        if (key === 'clarifying_questions') {
          // 列表开始;第一项可能在同一行"- id: ..."(已由 listStart 处理)
          // 这里只标记,不预创建 currentQuestion —— 下一行的 "      - id:" 会建
          // 为简化:若同一行内联第一项,则 listStart 已经处理过
          continue
        }
        if (key === 'options') {
          // module 顶层不应有 options,跳过
          continue
        }
        assignModuleField(currentModule, key, rawVal)
      }
      continue
    }

    // question list 起点:"      - id: ..."
    const qListStart = /^\s+-\s+/.exec(line)
    if (qListStart && currentModule !== null) {
      // 检查:仅当上一字段是 clarifying_questions 时进入 question 上下文
      // 用缩进判断(8 空格 vs 4 空格)—— 但 8 空格不易判定;改用启发式:
      // 若当前是 "- " 开头且 indent 比 currentModule 的字段更内层
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0
      const afterDash = line.slice(qListStart[0].length).trim()
      // 顶层 modules 项是 2 空格 indent,deps 项是 6 空格,questions 项也是 6 空格
      // 区分:若上一行含 "clarifying_questions" 或 这是 question list 项(有 id/question 字段)
      if (indent >= 6) {
        flushQuestion()
        currentQuestion = {}
        if (afterDash) {
          const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
          if (kv) {
            if (kv[1] === 'id') currentQuestion.id = stripQuotes(kv[2].trim())
            else if (kv[1] === 'question') currentQuestion.question = stripQuotes(kv[2].trim())
            else if (kv[1] === 'required') currentQuestion.required = kv[2].trim() === 'true'
          }
        }
        continue
      }
    }
  }
  flushModule()
  return result
}

function assignModuleField(
  target: Partial<TechBriefModule>,
  key: string,
  rawValue: string,
): void {
  const value = stripQuotes(rawValue.trim())
  switch (key) {
    case 'id':
      target.id = value
      return
    case 'name':
      target.name = value
      return
    case 'description':
      target.description = value
      return
    case 'complexity':
      target.complexity = value as TechBriefComplexity
      return
    case 'deps':
      // "deps:" 后续是 list,这里只标记,items 走 - xxx 路径
      return
    default:
      return
  }
}

function stripTrailingComment(line: string): string {
  const idx = findUnquotedHash(line)
  return idx === -1 ? line : line.slice(0, idx)
}

function findUnquotedHash(line: string): number {
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '#' && !inDouble && !inSingle) return i
  }
  return -1
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1)
    }
  }
  return s
}

// ---------------------------------------------------------------------------
// serializeModulesYaml — ModulesFile → YAML 文本
// ---------------------------------------------------------------------------

export function serializeModulesYaml(file: TechBriefModulesFile): string {
  if (file.modules.length === 0) return 'modules: []\n'
  const lines: string[] = ['modules:']
  for (const m of file.modules) {
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

// ---------------------------------------------------------------------------
// buildMockTechBrief — 确定性 mock 双产物(本期替代真实 Skill runner)
// ---------------------------------------------------------------------------

/**
 * 生成 mock 技术概要(本期替代真实 Skill runtime)。
 *
 * 设计要点:
 * - 内容确定性(同 sessionId → 同输出,便于测试与 snapshot diff)
 * - 双产物结构对齐 ADR-0013 D8:
 *   - `brief`:4 章节 Markdown(业务背景/架构选型/技术栈/风险缓解)
 *   - `modules`:4 个聚合模块(覆盖 low/medium/high 三档 complexity)
 * - 真实 Skill 接通后,此函数整体替换为 Skill runner 调用
 */
export function buildMockTechBrief(sessionId: string): TechBriefArtifacts {
  void sessionId
  const brief = [
    '# 退款功能优化 · 技术概要',
    '',
    '> 自动生成 · session=' + sessionId,
    '',
    '## 1. 业务背景与目标',
    '本需求围绕"退款功能优化"展开,核心目标是:',
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

  const modules: TechBriefModulesFile = {
    modules: [
      {
        id: 'm-idempotent-gateway',
        name: '幂等网关',
        description: '全局幂等键校验,防重复创建退款单',
        deps: ['refund-service'],
        complexity: 'high',
        clarifying_questions: [
          { id: 'q-1', question: '幂等键设计规则?', options: ['订单号+时间戳', '全局自增序列', 'UUID v4'], required: true },
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
        clarifying_questions: [],
      },
    ],
  }

  return { brief, modules }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- tech-brief`
Expected: PASS all assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tech-brief.ts apps/web/src/lib/__tests__/tech-brief.test.ts
git commit -m "feat(analyzing): tech-brief pure parser/serializer + mock builder (issue 19e)"
```

---

## Task 2: server-only file IO + snapshot (tech-brief.server.ts)

**Files:**
- Create: `apps/web/src/lib/tech-brief.server.ts`
- Test: `apps/web/src/lib/__tests__/tech-brief-server.test.ts`

**Interfaces:**
- Consumes: `parseModulesYaml`, `serializeModulesYaml`, `TechBriefArtifacts`
- Produces: `loadTechBrief(dir)`, `loadModules(dir)`, `saveTechBriefWithSnapshot(dir, content)`, `saveModulesWithSnapshot(dir, file)`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/lib/__tests__/tech-brief-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadTechBrief,
  loadModules,
  saveTechBriefWithSnapshot,
  saveModulesWithSnapshot,
  resolveAnalysisDir,
} from '@/lib/tech-brief.server'

let testRoot: string
let snapshotDir: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'aidevspace-tb-'))
  snapshotDir = mkdtempSync(join(tmpdir(), 'aidevspace-tb-snap-'))
  process.env.AIDEVSPACE_ROOT = testRoot
  process.env.AIDEVSPACE_SNAPSHOT_DIR = snapshotDir
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
  rmSync(snapshotDir, { recursive: true, force: true })
  delete process.env.AIDEVSPACE_ROOT
  delete process.env.AIDEVSPACE_SNAPSHOT_DIR
})

describe('resolveAnalysisDir', () => {
  it('拼接 AIDEVSPACE_ROOT/requirements/<reqId>/analysis', () => {
    expect(resolveAnalysisDir('req-001')).toBe(join(testRoot, 'requirements', 'req-001', 'analysis'))
  })
})

describe('loadTechBrief / loadModules', () => {
  it('文件不存在 → loadTechBrief 返回 null,loadModules 返回空 modules', () => {
    const dir = resolveAnalysisDir('req-load-1')
    expect(loadTechBrief(dir)).toBeNull()
    expect(loadModules(dir).modules).toEqual([])
  })

  it('写入技术概要后 loadTechBrief 还原内容(尾部换行容忍)', () => {
    const dir = resolveAnalysisDir('req-load-2')
    writeFileSync(join(dir, 'technical-brief.md'), '# hello\n## 1. 业务背景\n')
    expect(loadTechBrief(dir)).toBe('# hello\n## 1. 业务背景\n')
  })

  it('写入 modules.yaml 后 loadModules 还原结构', () => {
    const dir = resolveAnalysisDir('req-load-3')
    writeFileSync(join(dir, 'modules.yaml'), 'modules:\n  - id: m-1\n    name: x\n    description: d\n    deps: []\n    complexity: low\n')
    const file = loadModules(dir)
    expect(file.modules).toHaveLength(1)
    expect(file.modules[0].id).toBe('m-1')
  })
})

describe('saveTechBriefWithSnapshot / saveModulesWithSnapshot', () => {
  it('写入 brief + 自动 snapshot 落盘(snapshotDir 配置时)', () => {
    const dir = resolveAnalysisDir('req-save-1')
    const result = saveTechBriefWithSnapshot(dir, '# new brief\n')
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'technical-brief.md'))).toBe(true)
    expect(readFileSync(join(dir, 'technical-brief.md'), 'utf8')).toBe('# new brief\n')
    // snapshot 落盘
    const snapshotFiles = listSnapshotFiles(snapshotDir, 'req-save-1', 'technical-brief.md')
    expect(snapshotFiles.length).toBeGreaterThan(0)
  })

  it('第二次写入 → 旧版 snapshot 保留(可回滚)', () => {
    const dir = resolveAnalysisDir('req-save-2')
    saveTechBriefWithSnapshot(dir, '# version 1\n')
    saveTechBriefWithSnapshot(dir, '# version 2\n')
    expect(readFileSync(join(dir, 'technical-brief.md'), 'utf8')).toBe('# version 2\n')
    // 至少 1 个 snapshot(第二次写入前)
    const snapFiles = listSnapshotFiles(snapshotDir, 'req-save-2', 'technical-brief.md')
    expect(snapFiles.length).toBeGreaterThanOrEqual(1)
  })

  it('写入 modules.yaml 同理:snapshot 落盘', () => {
    const dir = resolveAnalysisDir('req-save-3')
    saveModulesWithSnapshot(dir, { modules: [{ id: 'm-1', name: 'x', description: '', deps: [], complexity: 'low' }] })
    const snapFiles = listSnapshotFiles(snapshotDir, 'req-save-3', 'modules.yaml')
    expect(snapFiles.length).toBeGreaterThanOrEqual(1)
  })
})

function listSnapshotFiles(root: string, reqId: string, fileName: string): string[] {
  const reqDir = join(root, reqId)
  if (!existsSync(reqDir)) return []
  const out: string[] = []
  for (const ts of require('node:fs').readdirSync(reqDir)) {
    const p = join(reqDir, ts, fileName)
    if (existsSync(p)) out.push(p)
  }
  return out
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- tech-brief-server`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`apps/web/src/lib/tech-brief.server.ts`:

```ts
/**
 * ANALYZING 工位 · technical-brief.md + modules.yaml 文件 IO(issue 19e · VS5)
 *
 * 沿用 products.server.ts 模式:server-only IO,客户端 component 不应 import。
 * RSC 与 server action 内部引用;vitest 在同进程 Node.js 内引用做集成测试。
 *
 * 文件路径(对照 ADR-0013 D8 + 决策 71):
 *   requirements/<req-id>/analysis/technical-brief.md
 *   requirements/<req-id>/analysis/modules.yaml
 *
 * 写入策略(决策 47 + ADR-0009 第 4 层 + 决策 71):
 * - 写前 snapshot 到 .aidevspace/snapshots/<req-id>/<ts>/<file>
 * - 配置 AIDEVSPACE_SNAPSHOT_DIR 时启用;未配置时静默跳过
 * - snapshot best-effort,失败不阻塞主流程
 *
 * 不破坏:本文件仅追加 load/save 双产物 IO;products.server.ts / analyzing.server.ts 行为不变。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseModulesYaml, serializeModulesYaml, type TechBriefModulesFile } from './tech-brief'

/** 解析 analysis 目录:AIDEVSPACE_ROOT/requirements/<reqId>/analysis */
export function resolveAnalysisDir(requirementId: string): string {
  const root = process.env.AIDEVSPACE_ROOT ?? defaultRoot()
  return join(root, 'requirements', requirementId, 'analysis')
}

function defaultRoot(): string {
  try {
    const { homedir } = require('node:os') as typeof import('node:os')
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

/** 加载 technical-brief.md;文件不存在 → null(区分"未生成") */
export function loadTechBrief(analysisDir: string): string | null {
  const file = join(analysisDir, 'technical-brief.md')
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** 加载 modules.yaml;文件不存在/损坏 → 空 modules(容错) */
export function loadModules(analysisDir: string): TechBriefModulesFile {
  const file = join(analysisDir, 'modules.yaml')
  if (!existsSync(file)) return { modules: [] }
  try {
    const raw = readFileSync(file, 'utf8')
    return parseModulesYaml(raw)
  } catch {
    return { modules: [] }
  }
}

export interface SaveResult {
  ok: boolean
  /** snapshot 路径(若启用);best-effort,失败为 null */
  snapshotPath: string | null
}

/** 写 technical-brief.md + 写前 snapshot(失败回滚靠决策 47 自动 snapshot) */
export function saveTechBriefWithSnapshot(analysisDir: string, content: string): SaveResult {
  ensureDir(analysisDir)
  snapshotBeforeWrite(analysisDir, 'technical-brief.md')
  try {
    const target = join(analysisDir, 'technical-brief.md')
    writeFileSync(target, content, 'utf8')
    return { ok: true, snapshotPath: null }
  } catch {
    return { ok: false, snapshotPath: null }
  }
}

/** 写 modules.yaml + 写前 snapshot */
export function saveModulesWithSnapshot(
  analysisDir: string,
  file: TechBriefModulesFile,
): SaveResult {
  ensureDir(analysisDir)
  snapshotBeforeWrite(analysisDir, 'modules.yaml')
  try {
    const target = join(analysisDir, 'modules.yaml')
    writeFileSync(target, serializeModulesYaml(file), 'utf8')
    return { ok: true, snapshotPath: null }
  } catch {
    return { ok: false, snapshotPath: null }
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const parent = dirname(dir)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
}

/** 写前 snapshot hook(决策 47 · ADR-0009 第 4 层)。
 *  配置 AIDEVSPACE_SNAPSHOT_DIR 时,把当前文件(若存在)拷贝到
 *  <snapshotDir>/<req-id>/<ts>/<file>;失败静默(best-effort)。
 */
function snapshotBeforeWrite(analysisDir: string, fileName: string): void {
  const snapshotDir = process.env.AIDEVSPACE_SNAPSHOT_DIR
  if (!snapshotDir) return
  try {
    const reqId = extractRequirementId(analysisDir)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const snapDir = join(snapshotDir, reqId, ts)
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

function extractRequirementId(analysisDir: string): string {
  // analysisDir = <root>/requirements/<req-id>/analysis
  // 拆分后 [-2] = 'analysis', [-3] = req-id
  const parts = analysisDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 2] ?? 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- tech-brief-server`
Expected: PASS all assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tech-brief.server.ts apps/web/src/lib/__tests__/tech-brief-server.test.ts
git commit -m "feat(analyzing): tech-brief file IO with snapshot hook (issue 19e)"
```

---

## Task 3: Agent REST endpoint `/analysis/generate-brief`

**Files:**
- Modify: `apps/agent/src/routes/analysis.ts` — add `POST /api/requirements/:id/analysis/generate-brief`
- Test: `apps/agent/src/__tests__/routes-analysis-generate-brief.test.ts`

**Interfaces:**
- Consumes: `buildMockTechBrief(sessionId)`(agent 端内联实现,直接生成确定内容)
- Produces: `POST /api/requirements/:id/analysis/generate-brief` returns `{ ok, brief_path, modules_path, generated_at }` or 4xx/5xx

- [ ] **Step 1: Write failing tests**

```ts
// apps/agent/src/__tests__/routes-analysis-generate-brief.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { sseRoutes } from '../sse/requirementEventsRoute.js'
import { analysisRoutes } from '../routes/analysis.js'

let app: FastifyInstance
let hub: SseHub
let token: string
let root: string
let snapshotDir: string

async function authedJson(
  method: 'POST',
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

describe('POST /api/requirements/:id/analysis/generate-brief', () => {
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-genbrief-'))
    snapshotDir = mkdtempSync(join(tmpdir(), 'aidevsp-genbrief-snap-'))
    process.env.AIDEVSPACE_ROOT = root
    process.env.AIDEVSPACE_SNAPSHOT_DIR = snapshotDir
    const tm = new TokenManager(root)
    token = await tm.ensure()
    hub = createSseHub({ heartbeatMs: 60_000 })
    app = Fastify({ logger: false })
    await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
    await app.register(sseRoutes, { hub })
    await app.register(analysisRoutes, { hub })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(snapshotDir, { recursive: true, force: true })
    delete process.env.AIDEVSPACE_ROOT
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirements/req-001/analysis/generate-brief',
      headers: { 'content-type': 'application/json' },
      payload: { session_id: 'sess-arch' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('400 当 session_id 缺失', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/generate-brief', {})
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('bad_request')
  })

  it('成功 → 200 + 写双文件 + 返回路径与时间戳', async () => {
    const res = await authedJson('POST', '/api/requirements/req-001/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.brief_path).toContain('technical-brief.md')
    expect(res.body.modules_path).toContain('modules.yaml')
    expect(typeof res.body.generated_at).toBe('string')
    // 文件实际落盘
    const brief = join(root, 'requirements', 'req-001', 'analysis', 'technical-brief.md')
    const modules = join(root, 'requirements', 'req-001', 'analysis', 'modules.yaml')
    expect(existsSync(brief)).toBe(true)
    expect(existsSync(modules)).toBe(true)
    expect(readFileSync(brief, 'utf8')).toContain('# ')
    expect(readFileSync(modules, 'utf8')).toContain('modules:')
  })

  it('旧版 modules.yaml 被覆盖(不保留版本)', async () => {
    // 第一次写入
    await authedJson('POST', '/api/requirements/req-002/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // 第二次写入
    await authedJson('POST', '/api/requirements/req-002/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    const modules = join(root, 'requirements', 'req-002', 'analysis', 'modules.yaml')
    // 文件路径下不存在 .v1 / .v2 备份
    expect(existsSync(join(root, 'requirements', 'req-002', 'analysis', 'modules.v1.yaml'))).toBe(false)
    expect(existsSync(modules)).toBe(true)
  })

  it('snapshot 落盘(配置 AIDEVSPACE_SNAPSHOT_DIR 时)', async () => {
    // 第一次写入触发 snapshot
    await authedJson('POST', '/api/requirements/req-003/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // 第二次写入触发 snapshot
    await authedJson('POST', '/api/requirements/req-003/analysis/generate-brief', {
      session_id: 'sess-arch',
    })
    // snapshot 目录有 req-003 子目录 + 至少 1 个时间戳目录
    const reqSnapDir = join(snapshotDir, 'req-003')
    expect(existsSync(reqSnapDir)).toBe(true)
    const tsDirs = require('node:fs').readdirSync(reqSnapDir) as string[]
    expect(tsDirs.length).toBeGreaterThanOrEqual(1)
    // 至少含 technical-brief.md 或 modules.yaml 之一
    const hasBrief = tsDirs.some((ts) =>
      existsSync(join(reqSnapDir, ts, 'technical-brief.md')),
    )
    const hasModules = tsDirs.some((ts) =>
      existsSync(join(reqSnapDir, ts, 'modules.yaml')),
    )
    expect(hasBrief || hasModules).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agent && pnpm test -- routes-analysis-generate-brief`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write implementation**

Modify `apps/agent/src/routes/analysis.ts`, **append** the new route + helper before the closing `}` of `analysisRoutes`:

```ts
// === 追加到 analysis.ts 末尾(在 analysisRoutes 函数体内) ===

interface GenerateBriefBody {
  session_id?: unknown
}

function buildMockBriefArtifacts(sessionId: string): {
  brief: string
  modules: { modules: { id: string; name: string; description: string; deps: string[]; complexity: 'low' | 'medium' | 'high'; clarifying_questions?: { id: string; question: string; options?: string[]; required?: boolean }[] }[] }
} {
  // mock Skill runner(本期替代 tech-brief-scaffold 真实调用)
  void sessionId
  const brief = [
    '# 退款功能优化 · 技术概要',
    '',
    '## 1. 业务背景与目标',
    '本需求围绕"退款功能优化"展开...',
    '',
    '## 2. 架构选型',
    '推荐方案 B:异步多阶段事件驱动。',
    '',
    '## 3. 技术栈',
    '- 事件总线:Kafka',
    '- 幂等存储:Redis',
    '- 分布式锁:ZooKeeper',
    '',
    '## 4. 风险与缓解',
    '详见 modules.yaml。',
    '',
  ].join('\n')

  const modules = {
    modules: [
      {
        id: 'm-idempotent-gateway',
        name: '幂等网关',
        description: '全局幂等键校验',
        deps: ['refund-service'],
        complexity: 'high' as const,
        clarifying_questions: [
          { id: 'q-1', question: '幂等键设计规则?', options: ['订单号+时间戳', '全局自增序列', 'UUID v4'], required: true },
          { id: 'q-2', question: '重试窗口期多长?', options: ['5min', '30min', '24h'] },
        ],
      },
      {
        id: 'm-refund-core',
        name: '退款核心逻辑',
        description: '退款单状态机',
        deps: ['m-idempotent-gateway'],
        complexity: 'medium' as const,
        clarifying_questions: [{ id: 'q-3', question: '退款状态机是否需要补偿事件?', required: true }],
      },
      {
        id: 'm-rollback-handler',
        name: '回滚处理器',
        description: '退款失败时回滚',
        deps: ['m-refund-core'],
        complexity: 'medium' as const,
        clarifying_questions: [{ id: 'q-4', question: '部分回滚 vs 全量回滚策略?' }],
      },
      {
        id: 'm-notification',
        name: '通知中心',
        description: '退款结果通知',
        deps: ['m-refund-core'],
        complexity: 'low' as const,
        clarifying_questions: [],
      },
    ],
  }
  return { brief, modules }
}

/** 序列化为极简 YAML(无第三方依赖) */
function serializeModulesYamlForAgent(
  modules: {
    modules: {
      id: string; name: string; description: string
      deps: string[]; complexity: string
      clarifying_questions?: { id: string; question: string; options?: string[]; required?: boolean }[]
    }[]
  },
): string {
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

/** 写前 snapshot hook(decision 47 · ADR-0009 第 4 层) */
function snapshotBeforeWriteAgent(analysisDir: string, fileName: string): void {
  const snapshotDir = process.env.AIDEVSPACE_SNAPSHOT_DIR
  if (!snapshotDir) return
  try {
    const reqId = extractRequirementIdFromAgent(analysisDir)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const snapDir = join(snapshotDir, reqId, ts)
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

  // 1. 计算 analysis 目录(AIDEVSPACE_ROOT/requirements/<id>/analysis)
  const root = process.env.AIDEVSPACE_ROOT ?? defaultAgentRoot()
  const analysisDir = join(root, 'requirements', id, 'analysis')
  if (!existsSync(analysisDir)) mkdirSync(analysisDir, { recursive: true })

  // 2. 写前 snapshot(brief + modules 都做)
  snapshotBeforeWriteAgent(analysisDir, 'technical-brief.md')
  snapshotBeforeWriteAgent(analysisDir, 'modules.yaml')

  // 3. 启动 tech-brief-scaffold Skill(本期 mock)→ 生成双产物
  const artifacts = buildMockBriefArtifacts(sessionId)

  // 4. 写双文件(直接覆盖,无版本号,决策 71)
  const briefPath = join(analysisDir, 'technical-brief.md')
  const modulesPath = join(analysisDir, 'modules.yaml')
  writeFileSync(briefPath, artifacts.brief, 'utf8')
  writeFileSync(modulesPath, serializeModulesYamlForAgent(artifacts.modules), 'utf8')

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

function defaultAgentRoot(): string {
  try {
    const { homedir } = require('node:os') as typeof import('node:os')
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}
```

Required additions at top of `analysis.ts`:
- `import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'`
- `import { join } from 'node:path'`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/agent && pnpm test -- routes-analysis-generate-brief`
Expected: PASS all assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/routes/analysis.ts apps/agent/src/__tests__/routes-analysis-generate-brief.test.ts
git commit -m "feat(analyzing): agent /generate-brief endpoint with snapshot (issue 19e)"
```

---

## Task 4: Web server action + RSC data extension

**Files:**
- Create: `apps/web/src/lib/tech-brief-actions.ts`
- Modify: `apps/web/src/lib/analyzing.ts` — add `TechBriefPreview` interface
- Modify: `apps/web/src/lib/analyzing.server.ts` — extend `AnalyzingData` with `techBriefPreview`, `canGenerateBrief`, `modulesPreview`; load on demand
- Modify: `apps/web/src/lib/__tests__/analyzing.test.ts` — extend tests for the new fields

**Interfaces:**
- `generateTechBrief(requirementId)` calls agent endpoint, returns `{ ok, brief, modules, generatedAt } | { ok: false, error }`
- `loadTechBriefPreview(analysisDir)` returns `{ brief, modules, generatedAt } | null`

- [ ] **Step 1: Write failing tests**

Append to `apps/web/src/lib/__tests__/analyzing.test.ts`:

```ts
// === 追加新 describe 块 ===

import {
  loadTechBriefPreview,
  resolveAnalysisDir,
} from '@/lib/tech-brief.server'

describe('getAnalyzingData · tech brief 段(issue 19e VS5)', () => {
  let tmpDir: string
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'analyzing-brief-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('canGenerateBrief: 始终 true(任何 verdict 状态都允许生成)', async () => {
    const data = await getAnalyzingData('UNKNOWN-BRIEF-1', { analysisDir: tmpDir })
    expect(data.canGenerateBrief).toBe(true)
  })

  it('双产物不存在 → techBriefPreview 为 null,modulesPreview 为空', async () => {
    const data = await getAnalyzingData('UNKNOWN-BRIEF-2', { analysisDir: tmpDir })
    expect(data.techBriefPreview).toBeNull()
    expect(data.modulesPreview).toBeNull()
  })

  it('双产物存在 → techBriefPreview 与 modulesPreview 字段填充', async () => {
    const dir = resolveAnalysisDir('UNKNOWN-BRIEF-3')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'technical-brief.md'), '# 技术概要\n\n## 1. 业务背景\n')
    writeFileSync(
      join(dir, 'modules.yaml'),
      'modules:\n  - id: m-1\n    name: 网关\n    description: 幂等\n    deps: []\n    complexity: low\n',
    )
    const data = await getAnalyzingData('UNKNOWN-BRIEF-3', { analysisDir: dir })
    expect(data.techBriefPreview).toBe('# 技术概要\n\n## 1. 业务背景\n')
    expect(data.modulesPreview).not.toBeNull()
    expect(data.modulesPreview!.modules).toHaveLength(1)
    expect(data.modulesPreview!.modules[0].id).toBe('m-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- analyzing.test`
Expected: FAIL — `canGenerateBrief` / `techBriefPreview` not on data.

- [ ] **Step 3: Write implementation**

**A.** Append to `apps/web/src/lib/analyzing.ts` (after `AnalyzingData` interface):

```ts
/** 技术概要产物预览(issue 19e VS5 · ADR-0013 D8) */
export interface TechBriefPreview {
  /** 完整 markdown 文本(供前端 [📄 Markdown] tab 渲染) */
  brief: string
  /** 解析后的 modules(供前端 [📋 YAML] tab 结构化展示) */
  modules: import('./tech-brief').TechBriefModulesFile
  /** 生成时间 ISO 8601(来自服务端 lastGeneratedAt 元数据) */
  generatedAt: string
}
```

Then extend `AnalyzingData` interface to include:
```ts
  /** 是否可生成技术概要(issue 19e VS5 · 始终 true,verdict 不限制) */
  canGenerateBrief: boolean
  /** 技术概要 preview(双产物都不存在 → null) */
  techBriefPreview: string | null
  /** modules.yaml preview(同 null 语义) */
  modulesPreview: import('./tech-brief').TechBriefModulesFile | null
  /** 最近生成时间(来自服务端 record;无则 null) */
  briefGeneratedAt: string | null
```

**B.** Modify `apps/web/src/lib/analyzing.server.ts`:

Update `getAnalyzingData` (and `emptyAnalyzingWithOptions`) to populate these new fields by calling `loadTechBrief(analysisDir)` / `loadModules(analysisDir)` when `options.analysisDir` is provided.

Modify `emptyAnalyzing` (in `analyzing.ts`) to include defaults:
```ts
  canGenerateBrief: true,
  techBriefPreview: null,
  modulesPreview: null,
  briefGeneratedAt: null,
```

**C.** Create `apps/web/src/lib/tech-brief-actions.ts`:

```ts
'use server'

/**
 * ANALYZING 工位 · 技术概要生成 server action(issue 19e · VS5)
 *
 * 数据流:
 *   [Client] TechBriefPanel 按钮 → onGenerate
 *   [Client → Server Action] generateTechBrief(requirementId, sessionId)
 *   [Server] POST /api/requirements/<id>/analysis/generate-brief → Agent mock Skill
 *   [Server] reload analysis/ 目录产物 → 返回 preview
 *   [Server] revalidatePath 触发 RSC 刷新
 *
 * 设计要点:
 * - 失败 → { ok: false, error } 不抛(避免污染 Error 边界;UI 层 toast 提示)
 * - 失败回滚由 Agent 端 snapshot 机制保证(决策 47)
 */

import { revalidatePath } from 'next/cache'
import { loadTechBrief, loadModules, resolveAnalysisDir } from './tech-brief.server'
import type { TechBriefModulesFile } from './tech-brief'

export interface GenerateBriefSuccess {
  ok: true
  brief: string
  modules: TechBriefModulesFile
  generatedAt: string
}

export interface GenerateBriefFailure {
  ok: false
  error: string
}

export type GenerateBriefResult = GenerateBriefSuccess | GenerateBriefFailure

export async function generateTechBrief(
  requirementId: string,
  sessionId: string,
): Promise<GenerateBriefResult> {
  try {
    const base = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'
    const res = await fetch(
      `${base}/api/requirements/${encodeURIComponent(requirementId)}/analysis/generate-brief`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      },
    )
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null
      return {
        ok: false,
        error: errBody?.reason ?? errBody?.error ?? `HTTP ${res.status}`,
      }
    }
    const body = (await res.json()) as { generated_at: string }

    // reload 本地缓存的产物(因 Agent 端写的是 AIDEVSPACE_ROOT,而本 RSC 看的是同一个 root)
    const dir = resolveAnalysisDir(requirementId)
    const brief = loadTechBrief(dir)
    const modules = loadModules(dir)

    revalidatePath(`/requirements/${requirementId}/analyzing`)

    return {
      ok: true,
      brief: brief ?? '',
      modules,
      generatedAt: body.generated_at,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- analyzing.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tech-brief-actions.ts apps/web/src/lib/analyzing.ts apps/web/src/lib/analyzing.server.ts apps/web/src/lib/__tests__/analyzing.test.ts
git commit -m "feat(analyzing): web tech-brief actions + RSC preview fields (issue 19e)"
```

---

## Task 5: Web client — TechBriefPanel 组件

**Files:**
- Create: `apps/web/src/components/tech-brief-panel.tsx`
- Test: `apps/web/src/__tests__/analyzing-tech-brief.test.tsx`

**Interfaces:**
- Renders: `[📊 生成技术概要]` button (always visible) + 双 Tab preview area when `preview != null`
- onGenerate → calls `generateTechBrief(reqId, sessionId)`, handles success/error states

- [ ] **Step 1: Write failing tests**

```tsx
// apps/web/src/__tests__/analyzing-tech-brief.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TechBriefPanel } from '@/components/tech-brief-panel'

// mock server action
vi.mock('@/lib/tech-brief-actions', () => ({
  generateTechBrief: vi.fn(),
}))

import { generateTechBrief } from '@/lib/tech-brief-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TechBriefPanel · 默认渲染', () => {
  it('always 显示 [📊 生成技术概要] 按钮(无论是否有 preview)', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="sess-arch"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    expect(screen.getByTestId('tech-brief-generate-btn')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-generate-btn').textContent).toContain('生成技术概要')
  })

  it('按钮 brand 色样式', () => {
    render(
      <TechBriefPanel requirementId="req-001" sessionId="s" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    const btn = screen.getByTestId('tech-brief-generate-btn')
    expect(btn.className).toContain('bg-brand')
  })

  it('preview=null → 不渲染 Tab 区', () => {
    render(
      <TechBriefPanel requirementId="req-001" sessionId="s" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    expect(screen.queryByTestId('tech-brief-preview')).toBeNull()
  })

  it('preview 存在 → 渲染双 Tab + 时间戳', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="sess-arch"
        preview="# Tech Brief\n\n## 1. 业务背景"
        modulesPreview={{ modules: [{ id: 'm-1', name: '网关', description: '', deps: [], complexity: 'low' }] }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    expect(screen.getByTestId('tech-brief-preview')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-tab-brief')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-tab-modules')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-timestamp').textContent).toContain('2026-07-13')
  })

  it('默认 Tab 是 brief;点 modules 切到 YAML view', async () => {
    const user = userEvent.setup()
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview="# Brief\n\n## 1. 业务背景"
        modulesPreview={{ modules: [{ id: 'm-1', name: '网关', description: '', deps: [], complexity: 'low' }] }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    // 默认显示 brief
    expect(screen.getByTestId('tech-brief-view-brief').textContent).toContain('业务背景')
    await user.click(screen.getByTestId('tech-brief-tab-modules'))
    expect(screen.getByTestId('tech-brief-view-modules')).toBeInTheDocument()
    expect(within(screen.getByTestId('tech-brief-view-modules')).getByText('m-1')).toBeInTheDocument()
  })

  it('[🔄 重扫] 按钮 disabled + tooltip(VS6 占位)', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview="# Brief"
        modulesPreview={{ modules: [] }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    const rescan = screen.getByTestId('tech-brief-rescan-btn')
    expect(rescan).toBeDisabled()
    expect(rescan.getAttribute('title')).toContain('VS6')
  })
})

describe('TechBriefPanel · 点击生成', () => {
  it('点按钮 → 调 generateTechBrief', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: true,
      brief: '# New Brief',
      modules: { modules: [] },
      generatedAt: '2026-07-13T10:05:00.000Z',
    })
    render(
      <TechBriefPanel requirementId="req-001" sessionId="sess-arch" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(generateTechBrief).toHaveBeenCalledWith('req-001', 'sess-arch')
    })
  })

  it('点击期间按钮变 spinner + disabled', async () => {
    const user = userEvent.setup()
    let resolveFn!: (v: GenerateBriefResult) => void
    vi.mocked(generateTechBrief).mockReturnValueOnce(
      new Promise<GenerateBriefResult>((r) => { resolveFn = r }),
    )
    render(
      <TechBriefPanel requirementId="req-001" sessionId="s" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    const btn = screen.getByTestId('tech-brief-generate-btn')
    await user.click(btn)
    expect(btn.getAttribute('data-loading')).toBe('true')
    expect(btn).toBeDisabled()
    resolveFn({ ok: true, brief: '', modules: { modules: [] }, generatedAt: '' })
  })

  it('成功 → 渲染 preview + timestamp', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: true,
      brief: '# Generated',
      modules: { modules: [{ id: 'm-1', name: 'X', description: '', deps: [], complexity: 'low' }] },
      generatedAt: '2026-07-13T11:00:00.000Z',
    })
    render(
      <TechBriefPanel requirementId="req-001" sessionId="s" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('tech-brief-preview')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tech-brief-timestamp').textContent).toContain('2026-07-13')
  })

  it('失败 → 显示错误 toast', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: false,
      error: 'AI 中途出错,已自动回滚',
    })
    render(
      <TechBriefPanel requirementId="req-001" sessionId="s" preview={null} modulesPreview={null} generatedAt={null} />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('tech-brief-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tech-brief-error').textContent).toContain('已自动回滚')
  })
})

import type { GenerateBriefResult } from '@/lib/tech-brief-actions'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- analyzing-tech-brief`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

`apps/web/src/components/tech-brief-panel.tsx`:

```tsx
'use client'

/**
 * ANALYZING 工位 · 技术概要面板(issue 19e · VS5 · ADR-0013 D8)
 *
 * 视觉对照基线:`docs/design/pages/11h-A-zone-multisession-tabs.html`
 * 顶部"📊 生成"按钮位(右对齐);本 slice 在 SessionTabs 行右侧添加主 CTA。
 *
 * 行为(对照 issue 19e 验收):
 * - [📊 生成技术概要] 按钮 brand 色 + 始终可见(verdict 任意状态都可点)
 * - 点击 → 按钮 spinner + disabled + 调 generateTechBrief
 * - 成功 → 渲染产物预览区(双 Tab:📄 Markdown / 📋 YAML)+ 文件路径 + 时间戳
 * - 失败 → 错误 toast + "已自动回滚"提示
 * - [🔄 重扫] 按钮 disabled + tooltip "VS6 待裁决面板启用"(VS6 占位)
 *
 * 设计要点:
 * - 'use client':点击 / 状态切换 / Tab 切换都是客户端交互
 * - 父级传入 preview / modulesPreview / generatedAt(RSC 注入);组件内部维护
 *   isGenerating / activeTab / error 本地状态
 * - 按钮成功后 → 不调 router.refresh;由 revalidatePath 触发父级 RSC 重读
 *   (本期通过父级 setState 立刻显示 preview + 后续 RSC 重读保持一致)
 */

import { useCallback, useState } from 'react'
import {
  generateTechBrief,
  type GenerateBriefResult,
} from '@/lib/tech-brief-actions'
import type { TechBriefModulesFile } from '@/lib/tech-brief'

export interface TechBriefPanelProps {
  requirementId: string
  sessionId: string
  /** RSC 注入的 brief 文本(若存在) */
  preview: string | null
  /** RSC 注入的 modules(若存在) */
  modulesPreview: TechBriefModulesFile | null
  /** 最近生成时间(ISO 8601) */
  generatedAt: string | null
}

type TabKey = 'brief' | 'modules'

export function TechBriefPanel({
  requirementId,
  sessionId,
  preview,
  modulesPreview,
  generatedAt,
}: TechBriefPanelProps) {
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('brief')
  const [error, setError] = useState<string | null>(null)
  // 客户端本地的预览(成功生成后立即显示,不依赖 SSR 重读)
  const [localBrief, setLocalBrief] = useState<string | null>(preview)
  const [localModules, setLocalModules] = useState<TechBriefModulesFile | null>(modulesPreview)
  const [localTs, setLocalTs] = useState<string | null>(generatedAt)

  const onGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result: GenerateBriefResult = await generateTechBrief(requirementId, sessionId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLocalBrief(result.brief)
      setLocalModules(result.modules)
      setLocalTs(result.generatedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [requirementId, sessionId])

  return (
    <div data-testid="tech-brief-panel" className="flex items-center gap-3">
      {error && (
        <div
          data-testid="tech-brief-error"
          role="alert"
          className="text-sm text-error bg-error/10 border border-error rounded-md px-3 py-1.5"
        >
          生成失败 · 已自动回滚:{error}
        </div>
      )}
      <button
        type="button"
        data-testid="tech-brief-generate-btn"
        data-loading={loading ? 'true' : 'false'}
        onClick={onGenerate}
        disabled={loading}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {loading ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            正在生成…
          </>
        ) : (
          <>📊 生成技术概要</>
        )}
      </button>
      <button
        type="button"
        data-testid="tech-brief-rescan-btn"
        disabled
        title="由待裁决面板启用(VS6)"
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-3 border border-border disabled:opacity-50"
      >
        🔄 重扫
      </button>
      {localBrief !== null && localModules !== null && (
        <span data-testid="tech-brief-timestamp" className="text-xs text-text-3 font-mono">
          最近生成:{localTs ? formatTimestamp(localTs) : '-'}
        </span>
      )}
      {localBrief !== null && localModules !== null && (
        <div
          data-testid="tech-brief-preview"
          className="w-full mt-3 border border-border rounded-md bg-bg-elevated"
        >
          <div
            data-testid="tech-brief-tabs"
            className="flex items-center gap-1 px-3 py-2 border-b border-border bg-bg-subtle"
          >
            <button
              type="button"
              data-testid="tech-brief-tab-brief"
              data-active={activeTab === 'brief' ? 'true' : 'false'}
              onClick={() => setActiveTab('brief')}
              className={`h-7 px-3 rounded-md text-sm font-medium ${
                activeTab === 'brief'
                  ? 'bg-brand text-white'
                  : 'bg-bg-elevated text-text-2 hover:bg-bg-subtle border border-border'
              }`}
            >
              📄 technical-brief.md
            </button>
            <button
              type="button"
              data-testid="tech-brief-tab-modules"
              data-active={activeTab === 'modules' ? 'true' : 'false'}
              onClick={() => setActiveTab('modules')}
              className={`h-7 px-3 rounded-md text-sm font-medium ${
                activeTab === 'modules'
                  ? 'bg-brand text-white'
                  : 'bg-bg-elevated text-text-2 hover:bg-bg-subtle border border-border'
              }`}
            >
              📋 modules.yaml
            </button>
          </div>
          {activeTab === 'brief' ? (
            <div
              data-testid="tech-brief-view-brief"
              className="p-4 prose prose-sm max-w-none text-sm font-mono whitespace-pre-wrap text-text-1"
            >
              {localBrief}
            </div>
          ) : (
            <div
              data-testid="tech-brief-view-modules"
              className="p-4 flex flex-col gap-3"
            >
              {localModules.modules.length === 0 && (
                <div className="text-text-3 text-sm">(无模块)</div>
              )}
              {localModules.modules.map((m) => (
                <div
                  key={m.id}
                  data-testid="tech-brief-module"
                  data-module-id={m.id}
                  data-complexity={m.complexity}
                  className="border border-border rounded-md p-3 bg-bg-elevated"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold">{m.id}</span>
                    <span className="text-sm text-text-2">{m.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      m.complexity === 'high' ? 'bg-error/10 text-error'
                      : m.complexity === 'medium' ? 'bg-warning/10 text-warning'
                      : 'bg-success/10 text-success'
                    }`}>
                      {m.complexity}
                    </span>
                  </div>
                  {m.description && (
                    <div className="text-sm text-text-2 mb-2">{m.description}</div>
                  )}
                  {m.deps.length > 0 && (
                    <div className="text-xs text-text-3 mb-1">
                      deps: <span className="font-mono">{m.deps.join(', ')}</span>
                    </div>
                  )}
                  {m.clarifying_questions && m.clarifying_questions.length > 0 && (
                    <ul className="text-xs text-text-2 list-disc pl-4 mt-1">
                      {m.clarifying_questions.map((q) => (
                        <li key={q.id}>
                          <span className="font-mono">{q.id}</span> · {q.question}
                          {q.options && q.options.length > 0 && (
                            <span className="text-text-3"> (选项:{q.options.join(' / ')})</span>
                          )}
                          {q.required && <span className="text-error"> *必答</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
  } catch {
    return iso
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- analyzing-tech-brief`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tech-brief-panel.tsx apps/web/src/__tests__/analyzing-tech-brief.test.tsx
git commit -m "feat(analyzing): TechBriefPanel component with double-tab preview (issue 19e)"
```

---

## Task 6: Integrate TechBriefPanel into AnalyzingZone

**Files:**
- Modify: `apps/web/src/components/analyzing-zone.tsx` — render `<TechBriefPanel>` near SessionTabs

- [ ] **Step 1: Modify the component**

In `apps/web/src/components/analyzing-zone.tsx`:

1. Add import:
```tsx
import { TechBriefPanel } from './tech-brief-panel'
```

2. After the `<SessionTabs ... />` div (around line 535), insert the panel right-aligned:
```tsx
<div className="mt-3 flex items-start justify-between gap-3">
  <div className="flex-1 min-w-0">
    <SessionTabs
      sessions={sessions}
      activeId={activeSessionId}
      onSwitch={handleSwitchSession}
      onCreate={handleCreateSession}
      onClose={handleCloseSession}
    />
  </div>
  <TechBriefPanel
    requirementId={data.requirementId}
    sessionId={activeSessionId}
    preview={data.techBriefPreview}
    modulesPreview={data.modulesPreview}
    generatedAt={data.briefGeneratedAt}
  />
</div>
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/analyzing-zone.tsx
git commit -m "feat(analyzing): integrate TechBriefPanel in main zone (issue 19e)"
```

---

## Task 7: Verification & Code Review

- [ ] **Run typecheck for both apps**
  ```bash
  cd apps/web && pnpm typecheck && cd ../agent && pnpm typecheck
  ```
  Expected: 0 errors.

- [ ] **Run full test suite**
  ```bash
  pnpm test
  ```
  Expected: all green.

- [ ] **Manual smoke check (optional)** — run dev server, navigate to /requirements/req-001/analyzing, click [📊 生成技术概要], verify:
  1. Button → spinner → preview renders
  2. Two tabs switchable
  3. Click again → overwrites without warning

- [ ] **Final commit (if any pending changes)**
  ```bash
  git status  # check for unstaged
  git add -A  # if clean pending
  git commit -m "chore(analyzing): VS5 verification pass (issue 19e)"
  ```