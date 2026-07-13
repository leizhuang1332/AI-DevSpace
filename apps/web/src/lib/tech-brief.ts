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

// 注:本文件不依赖 ./analyzing 的类型 —— modules.yaml schema 与产品识别无关,
// 避免 cycle 与不必要的耦合。

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

/**
 * 解析 modules.yaml → TechBriefModulesFile。
 *
 * 设计要点(沿用 parseSessionsIndexYaml / parseProductsYaml 设计):
 * - 极简解析器(只为受控格式服务),不引第三方
 * - 文件不存在 / 解析失败 → 返回空 modules(容错)
 * - id 缺失或 name 为空的模块 → 跳过(避免下游编辑/删除时无标识)
 * - complexity 缺失或未知 → 默认为 medium
 * - deps 缺失 → 空数组
 * - clarifying_questions 缺失 → undefined;单条 question 缺 id → 跳过
 * - 注释行(`#` 开头)与行尾注释被忽略
 * - 字符串值带单/双引号 → 去除引号
 *
 * 解析上下文追踪:deps 与 clarifying_questions 都是列表,缩进相同(均 6 空格)。
 * 用 `listContext` 显式跟踪当前所在的 list:`'none' | 'deps' | 'questions' | 'options'`。
 * 切换由 `deps:` / `clarifying_questions:` / `options:` key 触发。
 */
export function parseModulesYaml(text: string): TechBriefModulesFile {
  if (!text.trim()) return { modules: [] }
  const lines = text.split('\n')
  const result: TechBriefModulesFile = { modules: [] }
  let currentModule: Partial<TechBriefModule> | null = null
  let currentQuestion: Partial<TechBriefClarifyingQuestion> | null = null
  type Ctx = 'none' | 'deps' | 'questions' | 'options'
  /** 当前 list 的预期缩进(项起始行 `      - x` 前面的空格数) */
  let listIndent = 0
  /** 当前 list 退出后回到父 list 的缩进(options → questions 专用) */
  let parentListIndent = 0
  let listContext: Ctx = 'none'

  const flushQuestion = (): void => {
    if (
      currentQuestion &&
      typeof currentQuestion.id === 'string' &&
      typeof currentQuestion.question === 'string'
    ) {
      const q: TechBriefClarifyingQuestion = {
        id: currentQuestion.id,
        question: currentQuestion.question,
        ...(currentQuestion.options !== undefined
          ? { options: currentQuestion.options }
          : {}),
        ...(currentQuestion.required !== undefined
          ? { required: currentQuestion.required }
          : {}),
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
    if (
      currentModule &&
      typeof currentModule.id === 'string' &&
      typeof currentModule.name === 'string'
    ) {
      const m: TechBriefModule = {
        id: currentModule.id,
        name: currentModule.name,
        description: currentModule.description ?? '',
        deps: currentModule.deps ?? [],
        complexity: isValidComplexity(currentModule.complexity ?? '')
          ? (currentModule.complexity as TechBriefComplexity)
          : 'medium',
        ...(currentModule.clarifying_questions !== undefined
          ? { clarifying_questions: currentModule.clarifying_questions }
          : {}),
      }
      result.modules.push(m)
    }
    currentModule = null
    listContext = 'none'
    listIndent = 0
    parentListIndent = 0
  }

  for (const rawLine of lines) {
    const line = stripTrailingComment(rawLine)
    if (!line.trim()) continue
    if (/^\s*#/.test(line)) continue

    const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0
    const isListItem = /^(\s+)-\s+/.test(line)

    // top-level: "modules:" (允许 "modules: []" 空表)
    const topMatch = /^modules\s*:\s*(.*)$/.exec(line)
    if (topMatch && /^\S/.test(line)) {
      flushModule()
      continue
    }

    // module 列表起点: "  - id: xxx"(2 空格 indent)
    // 任何后续 list(- ... 起点)都关闭上一 module,切到新 module
    if (currentModule !== null && /^  -\s+/.test(line)) {
      flushModule()
    }

    if (currentModule === null) {
      const moduleListStart = /^  -\s+/.exec(line)
      if (moduleListStart) {
        const afterDash = line.slice(moduleListStart[0].length).trim()
        currentModule = { deps: [] }
        if (afterDash) {
          const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
          if (kv) assignModuleField(currentModule, kv[1], kv[2])
        }
        listContext = 'none'
        listIndent = 0
        parentListIndent = 0
        continue
      }
    }

    // 当前在 deps list 中
    if (listContext === 'deps' && currentModule !== null) {
      if (isListItem && lineIndent === listIndent) {
        const m = /^(\s+)-\s+/.exec(line)!
        const after = line.slice(m[0].length).trim()
        if (after) {
          const stripped = stripQuotes(after)
          currentModule.deps = [...(currentModule.deps ?? []), stripped]
        }
        continue
      }
      // 退出 list 仅在缩进变浅时(deps 是 module 的平级 list,无嵌套)
      if (lineIndent < listIndent) {
        listContext = 'none'
        listIndent = 0
      }
    }

    // 当前在 options list 中(必须在 questions 之前检查,因为 options → questions 转换
    // 需要让本行重新被 questions 检查)
    if (listContext === 'options' && currentQuestion !== null) {
      if (isListItem && lineIndent === listIndent) {
        const m = /^(\s+)-\s+/.exec(line)!
        const after = line.slice(m[0].length).trim()
        if (after) {
          const stripped = stripQuotes(after)
          currentQuestion.options = [...(currentQuestion.options ?? []), stripped]
        }
        continue
      }
      // 退出 options → 回 questions(恢复父 list 缩进)
      listContext = 'questions'
      listIndent = parentListIndent
      // 不 continue:让本行再被 questions 检查一次
    }

    // 当前在 questions list 中
    if (listContext === 'questions' && currentModule !== null) {
      if (isListItem && lineIndent === listIndent) {
        const m = /^(\s+)-\s+/.exec(line)!
        flushQuestion()
        currentQuestion = {}
        const afterDash = line.slice(m[0].length).trim()
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
      // 浅缩进 → 退出 list;深缩进(嵌套 kvMatch)→ 让下方 kvMatch 处理
      if (lineIndent < listIndent) {
        listContext = 'none'
        listIndent = 0
      }
    }

    // key: val 行(indent ≥ 2)
    const kvMatch = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (kvMatch) {
      const key = kvMatch[1]
      const rawVal = kvMatch[2]
      if (currentQuestion) {
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
        if (key === 'options') {
          // 进入 options 子 list
          // options 项缩进 = key 缩进 + 2(与 YAML 写盘约定一致)
          parentListIndent = listIndent
          listContext = 'options'
          listIndent = lineIndent + 2
          continue
        }
        continue
      }
      if (currentModule) {
        if (key === 'deps') {
          listContext = 'deps'
          listIndent = lineIndent + 2
          continue
        }
        if (key === 'clarifying_questions') {
          listContext = 'questions'
          listIndent = lineIndent + 2
          continue
        }
        assignModuleField(currentModule, key, rawVal)
      }
      continue
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
    default:
      return
  }
}

function stripTrailingComment(line: string): string {
  // 简单策略:行内 # 不在引号内时,去除其后的内容
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

/**
 * 序列化 TechBriefModulesFile → YAML 文本。
 *
 * 设计要点:
 * - 空 modules 输出 "modules: []"
 * - 字段顺序固定:id → name → description → deps → complexity → clarifying_questions
 * - deps 为空数组时输出 "deps: []",否则展开为 list
 * - clarifying_questions 缺失时不输出该字段
 * - options / required 仅在有值时输出
 */
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
 *
 * 注:`sessionId` 当前不被读取 —— 真实 Skill 接通后,此参数将用于注入会话
 * 上下文(products.yaml / chunks / Knowledge);mock 阶段保持确定性优先。
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
        // 故意省略 clarifying_questions(等价于 undefined)以匹配 round-trip 契约
      },
    ],
  }

  return { brief, modules }
}