/**
 * 极简 YAML 解析器(server-only)
 * (issue: zone-data-fidelity-fixes · 05 · D-6.2)
 *
 * 设计动机:
 * - 本仓库读 yaml 文件的需求**只覆盖三种受控 schema**:
 *   1. `~/.aidevspace/config.yaml` —— `workspaceRoot: /path/to/root` 这种
 *      顶层 scalar(由后端 `apps/agent/src/server.ts:43-45` 写入)
 *   2. `requirements/{id}/meta.yaml` —— `id` / `title` / `createdAt` 三个
 *      顶层 scalar(由后端 `RequirementService.createRequirement` 写入)
 *   3. `requirements/{id}/design/*.yaml` —— 嵌套块 / list / 块字符串 /
 *      多 entry adapter(由 designing.server.ts 解析)
 *
 * - 不引第三方 yaml 依赖(本期仅 server-side,且 schema 受控);容错:解析失败
 *   / 字段缺失 → 返回 null 或默认空对象,避免上层走空兜底时被脏数据毁全文件
 *
 * server-only 约束:
 * - `.server.ts` 后缀,Next.js/webpack 会拒绝 client component 直接 import
 * - 项目当前未安装 `server-only` npm 包;若以后装了,把 `import 'server-only'`
 *   放到文件顶部一行即可获得编译期越界保护
 *
 * 被引用方:
 * - `designing.server.ts`:`parseNestedBlock` / `parseListYaml` / `stripQuotes`
 * - `requirements-root.server.ts`:`parseFlatMap`
 * - `drafting.server.ts`:`parseFlatMap`(读 meta.yaml)
 *
 * 命名:
 * - `parseFlatMap` 是本期 ticket 新增的"只取标量"对外 API(对应 config.yaml /
 *   meta.yaml 场景);`parseNestedBlock` 是历史重命名(原 designing.server.ts 内
 *   私有),保留向下兼容
 */

import { existsSync, readFileSync } from 'node:fs'

/**
 * 解析"顶层 scalar 集合",根据 `topKey` 命中方式区分两种形态:
 *
 * 形态 A — 顶层 scalar(`key: value` 单行):
 * ```
 * workspaceRoot: /Users/Ray/.aidevspace
 * theme: system
 * ```
 * 整段都是顶层 scalar → `topKey` 作为"存在性校验",返回所有顶层字段(对齐
 * meta.yaml 多字段场景: `parseFlatMap(raw, 'title')` 拿到 id/title/createdAt)
 *
 * 形态 B — 顶层块(`key:` 后跟 2+ 空格子字段):
 * ```
 * stage:
 *   badge: ④ 设计
 *   title: ...
 * ```
 * `topKey` 命中块起点后进入字段收集,遇到下一个顶层 key 立即停止 → 只返回该
 * 块下的子字段(对齐设计 yaml 多 block 场景)
 *
 * 容错:
 * - `topKey` 在两种形态下都不存在 → null(不抛错)
 * - 字段值带引号(`"foo"` / `'foo'`)→ `stripQuotes` 剥离
 * - 注释行(`# ...`)和无意义空白行跳过
 *
 * @example
 * parseFlatMap('workspaceRoot: /tmp/x', 'workspaceRoot')
 * // → { workspaceRoot: '/tmp/x' }
 *
 * parseFlatMap('title: foo\ncreatedAt: 2026-01-01', 'title')
 * // → { title: 'foo', createdAt: '2026-01-01' }
 *
 * parseFlatMap('foo:\n  bar: baz\n', 'foo')
 * // → { bar: 'baz' }
 */
export function parseFlatMap(raw: string, topKey: string): Record<string, string> | null {
  const lines = raw.split('\n')
  let inTop = false
  let topKeyFound = false
  const result: Record<string, string> = {}

  for (const line of lines) {
    const cleaned = line.replace(/^\s*#(?=\s|$).*$/, '')
    if (!cleaned.trim()) continue

    const indent = cleaned.length - cleaned.trimStart().length
    if (indent === 0) {
      // 形态 A:顶层 scalar `key: value`(value 非空,单行)
      const scalar = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(cleaned)
      if (scalar) {
        if (inTop) break
        if (scalar[1] === topKey) topKeyFound = true
        result[scalar[1]] = stripQuotes(scalar[2].trim())
        continue
      }
      // 形态 B:顶层块 `key:`(后面空)
      const block = /^([A-Za-z_][\w-]*)\s*:\s*$/.exec(cleaned)
      if (block) {
        if (inTop) break
        if (block[1] === topKey) {
          inTop = true
          topKeyFound = true
        }
        continue
      }
    }

    if (!inTop) continue

    // 块内子字段(2+ 空格缩进)
    const kv = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (kv) {
      result[kv[1]] = stripQuotes(kv[2].trim())
    }
  }

  return topKeyFound ? result : null
}

/**
 * 解析 yaml 的"顶层 key → 字段们"结构,返回字段 map。完整版本,支持嵌套
 * scalar / list / 块字符串(`markdown: |`) / 多 entry adapter。
 *
 * 历史:原 `designing.server.ts` 内私有函数,ticket 05 / D-6.2 抽出。
 * 行为不变;只是把"读 fs → 解析 yaml → 适配字段"拆开,让 server-only loader
 * 各取所需。
 *
 * 支持的形式:
 * - 顶层 scalar:`stage:` / `design_doc:` 后跟 2 空格缩进的标量字段
 * - 顶层 list:`candidates:` 后跟 2 空格缩进的 `- id: A ...` 列表
 *   - 每个 entry 内的字段(4 空格缩进)递归可嵌套 scalar list(pros / cons / metrics)
 *   - 嵌套 scalar list 的 entry(6 空格缩进)只支持 scalar / 简单 k:v map
 * - 块字符串:`markdown: |` 后跟 4+ 空格缩进的行 → 拼成多行字符串
 *
 * 不支持(本期 schema 不会用到):
 * - 嵌套对象(已扁平化为 `tag_label` / `tag_variant` 等独立字段)
 * - 锚点 / 引用 / 折叠块 / flow style(`{a: b}` / `[a, b]`)
 *
 * 设计要点:
 * - 顶层 list 的 entries 数组**直接挂在 result[key]** 上,避免后续
 *   `result[key] = newEntries` 覆盖旧引用导致前序 entry 丢失
 * - 任意行解析失败 → 跳过该行(避免一行脏数据毁全文件)
 */
export function parseNestedBlock(
  raw: string,
  topKey: string,
): Record<string, unknown> | null {
  const lines = raw.split('\n')
  let inTop = false
  const result: Record<string, unknown> = {}

  // 顶层字段状态
  type TopFieldState =
    | { kind: 'scalar'; key: string }
    | { kind: 'block'; key: string; lines: string[] }
    | {
        kind: 'list'
        key: string
        /** 引用 result[key](已挂在 result 上的同一数组);不再新建 */
        entries: Record<string, unknown>[]
        entry: Record<string, unknown> | null
      }
  let top: TopFieldState | null = null

  /**
   * 收尾顶层 block;list 类型不需要收尾(直接挂在 result 上);scalar 字段
   * 在遇到时已经写入 result,无需再 flush。
   */
  const topFlushScalarOrBlock = () => {
    if (!top) return
    if (top.kind === 'block') {
      result[top.key] = top.lines.join('\n')
    }
    if (top.kind !== 'list') top = null
  }

  // 嵌套 list(pros / cons / metrics)直接挂到 top.entry 上
  let nestedListKey: string | null = null
  let nestedListEntries: Record<string, unknown>[] = []
  let nestedListCurrent: Record<string, unknown> | null = null

  const nestedFlush = () => {
    if (nestedListKey && top && top.kind === 'list' && top.entry) {
      if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
      top.entry[nestedListKey] = nestedListEntries
    }
    nestedListKey = null
    nestedListEntries = []
    nestedListCurrent = null
  }

  for (const line of lines) {
    const cleaned = line.replace(/^\s*#(?=\s|$).*$/, '')
    if (!cleaned.trim()) continue

    const indentMatch = /^(\s*)/.exec(cleaned)!
    const indent = indentMatch[1].length

    // 顶层 key(0 缩进 + `key:`)
    if (indent === 0) {
      const topMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
      if (topMatch) {
        if (inTop) break
        inTop = topMatch[1] === topKey
        continue
      }
    }

    if (!inTop) continue

    // 块字符串延续(必须 ≥ 4 空格,且 current 顶层字段是 block)
    if (top && top.kind === 'block' && indent >= 4) {
      const kv = /^\s+([A-Za-z_][\w-]*)\s*:/.exec(cleaned)
      if (!kv) {
        top.lines.push(cleaned.slice(4))
        continue
      }
    }

    // 嵌套 list 的 entry 起点(6 空格缩进 + `- key: val`)
    // 仅当 afterDash 含 `:`(k:v 形式,如 `- label: 微服务调用`)时走 k:v;
    // 否则(纯字符串,如 `- 实现简单,链路短`)fallback 到 string entry。
    const nestedListStart = /^\s{6}-\s+/.exec(cleaned)
    if (nestedListStart && nestedListKey) {
      const afterDash = cleaned.slice(nestedListStart[0].length).trim()
      const isKV = /^([A-Za-z_][\w-]*)\s*:/.test(afterDash)
      if (isKV) {
        // 收尾上一个 entry
        if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
        const entry: Record<string, unknown> = {}
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) entry[kv[1]] = stripQuotes(kv[2].trim())
        nestedListCurrent = entry
        continue
      }
      // fallback:字符串 entry,落到下面的 nestedListStrItem 处理
    }

    // 嵌套 list 的 entry 内字段(8+ 空格缩进的 k:v)
    const nestedListItemKv = /^\s{8,}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (nestedListItemKv && nestedListKey && nestedListCurrent) {
      nestedListCurrent[nestedListItemKv[1]] = stripQuotes(nestedListItemKv[2].trim())
      continue
    }

    // 嵌套 list 的字符串 entry(6 空格 `- xxx` 无 k:v,如 pros: - xxx)
    const nestedListStrItem = /^\s{6}-\s+([^:]+)$/.exec(cleaned)
    if (nestedListStrItem && nestedListKey) {
      if (nestedListCurrent) nestedListEntries.push(nestedListCurrent)
      nestedListCurrent = { _: stripQuotes(nestedListStrItem[1].trim()) }
      continue
    }

    // 顶层 list 的 entry 起点(2-4 空格缩进 + `- key: val`)
    // 例:`  - id: A`(candidates 内的 candidate entry,2 空格)
    // 例:`    - id: xxx`(design_doc.toc 内的 toc item,4 空格 —— 在 nested block 的 field 下)
    const topListStart = /^\s{2,4}-\s+/.exec(cleaned)
    if (topListStart) {
      // 收尾前一个顶层 scalar / block(list 不收尾,因为 entries 直接挂在 result 上)
      topFlushScalarOrBlock()
      nestedFlush()
      const key = extractTopListKey(raw, cleaned, indent)
      if (!key) continue
      // 关键:复用 result[key] 已有的数组(若已有),否则新建并挂上
      let entries: Record<string, unknown>[]
      if (Array.isArray(result[key])) {
        entries = result[key] as Record<string, unknown>[]
      } else {
        entries = []
        result[key] = entries
      }
      const entry: Record<string, unknown> = {}
      const afterDash = cleaned.slice(topListStart[0].length).trim()
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) entry[kv[1]] = stripQuotes(kv[2].trim())
      }
      // 把 entry push 到 entries(已挂在 result 上)
      entries.push(entry)
      top = { kind: 'list', key, entries, entry }
      continue
    }

    // 顶层 list 的 entry 内 nested object 字段(6 空格缩进 k:v,且当前 top 是 list)
    // 例:`      label: 问题背景`(toc item 的字段,在 toc 列表内)
    const entryNestedFieldKv = /^\s{6}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (entryNestedFieldKv && top && top.kind === 'list' && top.entry) {
      top.entry[entryNestedFieldKv[1]] = stripQuotes(
        entryNestedFieldKv[2].trim(),
      )
      continue
    }

    // 顶层 list 的 entry 内字段(4 空格缩进 k:v,且当前 top 是 list)
    const entryFieldKv = /^\s{4}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (entryFieldKv && top && top.kind === 'list' && top.entry) {
      const key = entryFieldKv[1]
      const value = entryFieldKv[2].trim()

      if (value === '') {
        // 嵌套 scalar list 起点(pros / cons / metrics)
        nestedFlush()
        nestedListKey = key
        // 复用 top.entry[key] 已有数组
        if (Array.isArray(top.entry[key])) {
          nestedListEntries = top.entry[key] as Record<string, unknown>[]
        } else {
          nestedListEntries = []
        }
        nestedListCurrent = null
        continue
      }

      // 普通标量
      top.entry[key] = stripQuotes(value)
      continue
    }

    // 顶层 scalar 字段(2 空格缩进 k:v,value 非空)
    // 例:`  title: 退款功能`(顶层字段)
    // 例:`  recommendation_candidate_id: B`(list 后跟的顶层字段)
    const topFieldKv = /^\s{2}([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (topFieldKv) {
      topFlushScalarOrBlock()
      nestedFlush()
      const key = topFieldKv[1]
      const value = topFieldKv[2].trim()

      if (value === '|') {
        top = { kind: 'block', key, lines: [] }
        continue
      }

      result[key] = stripQuotes(value)
      top = { kind: 'scalar', key }
      continue
    }
  }

  topFlushScalarOrBlock()
  nestedFlush()
  return inTop ? result : null
}

/**
 * 提取顶层 list 的归属 key —— 找到当前行之前最近的"indent < currentIndent 的 key:" 字段。
 *
 * 因为 parseNestedBlock 顺序处理行,遇到 `- xxx` 时,需要知道这是哪个 list key。
 * 算法:从前一行往上回溯,直到找到 indent < currentIndent 的 `key:`(归属 key)。
 *
 * - currentIndent = 2 时找 indent = 0 的 key(顶层 list,例 candidates)
 * - currentIndent = 4 时找 indent = 2 的 key(entry 内嵌套 list,例 design_doc.toc)
 */
function extractTopListKey(
  raw: string,
  currentLine: string,
  currentIndent: number,
): string | null {
  const lines = raw.split('\n')
  const idx = lines.indexOf(currentLine)
  if (idx <= 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    const cleaned = lines[i].replace(/^\s*#(?=\s|$).*$/, '').trim()
    if (!cleaned) continue
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (!m) continue
    const indent = lines[i].length - lines[i].trimStart().length
    if (indent < currentIndent) return m[1]
  }
  return null
}

/**
 * 通用 list 解析:`topKey:` 下的 `- id: ...` 列表,每条 entry 通过 `entryParser`
 * 转成目标类型。entry 解析失败 → 跳过(不污染其他 entry)。
 */
export function parseListYaml<T>(
  raw: string,
  topKey: string,
  entryParser: (map: Record<string, unknown>) => T | null,
): T[] {
  const block = parseNestedBlock(raw, topKey)
  if (!block) return []
  const list = block[topKey]
  if (!Array.isArray(list)) return []
  const result: T[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const parsed = entryParser(item as Record<string, unknown>)
    if (parsed !== null) result.push(parsed)
  }
  return result
}

/**
 * 去除字符串两端单/双引号(用于 `"foo"` / `'foo'` 形式)。
 * 导出是为了让 designing.server.ts 的字段适配器也能复用(避免重复实现)。
 */
export function stripQuotes(s: string): string {
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
// 文件 IO helpers(server-only)
// ---------------------------------------------------------------------------
// 设计要点:失败一律静默降级,不抛错,让上层走空兜底

/**
 * 读 yaml 文件内容;不存在 / 读取失败 → null(让上层走空兜底)。
 *
 * - 文件是目录或损坏 → null
 * - 内容为空字符串 → null(由上层"必需字段非空"判定失败)
 */
export function readYamlFileOrNull(file: string): string | null {
  if (!existsSync(file)) return null
  try {
    const text = readFileSync(file, 'utf8')
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}