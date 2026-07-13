/**
 * ANALYZING 工位 · 识别产物 (products.yaml) 数据契约与纯函数(issue 19d · VS4)
 *
 * 这是 client-safe 部分:类型 + YAML 解析/序列化 + 应用变更的纯函数。
 * 文件 IO 与 mock 数据源在 `./products.server.ts`(沿用 `analyzing.ts` ↔ `analyzing.server.ts`
 * 拆分模式,避免 webpack 把 node:fs 拉进 client bundle)。
 *
 * 文件格式(由本仓库写入,采用极简 YAML;不引第三方依赖):
 * ```yaml
 * subproblems:
 *   - id: q-1
 *     title: 退款金额上限?
 *     description: 单笔限额
 *     severity: green
 * risks:
 *   - id: r-1
 *     title: 高并发重复创建
 *     severity: orange
 * options:
 *   - id: o-1
 *     title: 同步单阶段
 *     severity: blue
 * ```
 *
 * 设计要点:
 * - id 稳定(edit 不改 id;delete/merge 后旧 id 不复用 — 由 caller 用 crypto.randomUUID 生成新 id)
 * - 解析/序列化采用与 `analyzing.server.ts` 同样的受限格式解析器(不引第三方)
 * - applyProductChange 是纯函数:返回新对象,不改入参
 * - 删除后顺序稳定(其余条目保持原顺序)
 */

import type { AnalyzingProductItem, AnalyzingProductGroup } from './analyzing'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 三类产物 kind(与 AnalyzingProductGroup 字段对齐) */
export type ProductKind = keyof AnalyzingProductGroup

/** 产品 severity(继承自 AnalyzingProductItem) */
export type ProductSeverity = AnalyzingProductItem['severity']

/** 单条产物(与 AnalyzingProductItem 兼容) */
export type ProductItem = AnalyzingProductItem

/** products.yaml 顶层结构(三类列表) */
export interface ProductsFile {
  subproblems: ProductItem[]
  risks: ProductItem[]
  options: ProductItem[]
}

/** 校验通过的有效 severity 集合 */
const VALID_SEVERITIES: readonly ProductSeverity[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
]

/** 是否为合法 severity */
function isValidSeverity(s: string): s is ProductSeverity {
  return (VALID_SEVERITIES as readonly string[]).includes(s)
}

// ---------------------------------------------------------------------------
// parseProductsYaml — 受限格式 YAML 解析
// ---------------------------------------------------------------------------

/**
 * 解析 products.yaml → ProductsFile。
 *
 * 设计要点(沿用 `parseSessionsIndexYaml` 的设计):
 * - 极简解析器(只为受控格式服务),不引第三方
 * - 文件不存在 / 解析失败 → 返回空 ProductsFile(容错)
 * - id 缺失或 title 为空的条目 → 跳过(避免下游编辑/删除时无标识)
 * - severity 缺失或未知 → 默认为 blue
 * - description 可选,缺失时为 undefined
 * - 注释行(`#` 开头)与行尾注释被忽略
 * - 字符串值带单/双引号 → 去除引号
 *
 * @param text 原始 YAML 文本
 */
export function parseProductsYaml(text: string): ProductsFile {
  if (!text.trim()) {
    return { subproblems: [], risks: [], options: [] }
  }
  const lines = text.split('\n')
  const result: ProductsFile = { subproblems: [], risks: [], options: [] }

  let currentKind: ProductKind | null = null
  let currentItem: Partial<ProductItem> | null = null

  const flushItem = (): void => {
    if (currentItem && typeof currentItem.id === 'string' && currentItem.title) {
      const item: ProductItem = {
        id: currentItem.id,
        title: currentItem.title,
        severity: isValidSeverity(currentItem.severity ?? '')
          ? (currentItem.severity as ProductSeverity)
          : 'blue',
        ...(currentItem.description !== undefined && currentItem.description.length > 0
          ? { description: currentItem.description }
          : {}),
      }
      if (currentKind) result[currentKind].push(item)
    }
    currentItem = null
  }

  for (const rawLine of lines) {
    // 去除行尾注释(保留行首的 # 作为整行注释判断)
    const cleaned = stripTrailingComment(rawLine)
    if (!cleaned.trim()) continue
    // 整行注释(行首 #)跳过
    if (/^\s*#/.test(cleaned)) continue

    // top-level key(无缩进):"subproblems:" / "risks:" / "options:"
    const topMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
    if (topMatch && /^\S/.test(cleaned)) {
      flushItem()
      const key = topMatch[1]
      if (key === 'subproblems' || key === 'risks' || key === 'options') {
        currentKind = key
        continue
      }
      // 其他顶层 key(暂未用)→ 跳过
      currentKind = null
      continue
    }

    // 列表起点:"  - key: val" 或纯 "  - " 后面下一行写字段
    const listStart = /^\s*-\s+/.exec(cleaned)
    if (listStart && currentKind) {
      flushItem()
      currentItem = {}
      const afterDash = cleaned.slice(listStart[0].length).trim()
      if (afterDash) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(afterDash)
        if (kv) assignProductField(currentItem, kv[1], kv[2])
      }
      continue
    }

    // 列表项内字段:"    key: val"
    if (currentItem && currentKind) {
      const kv = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(cleaned)
      if (kv) {
        assignProductField(currentItem, kv[1], kv[2])
        continue
      }
    }
  }
  flushItem()
  return result
}

function stripTrailingComment(line: string): string {
  // 简单策略:行内 # 不在引号内时,去除其后的内容
  // (YAML 完整引号转义不在本极简解析器范围内)
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

function assignProductField(
  target: Partial<ProductItem>,
  key: string,
  rawValue: string,
): void {
  const value = stripQuotes(rawValue.trim())
  switch (key) {
    case 'id':
      target.id = value
      return
    case 'title':
      target.title = value
      return
    case 'description':
      target.description = value
      return
    case 'severity':
      target.severity = value as ProductSeverity
      return
    default:
      return
  }
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
// serializeProductsYaml — ProductsFile → YAML 文本
// ---------------------------------------------------------------------------

/**
 * 序列化 ProductsFile → YAML 文本。
 *
 * 设计要点:
 * - 字段顺序固定:id → title → description(可选)→ severity
 * - description 缺失时不输出该行
 * - 三类都输出(即使为空 → "subproblems: []"),便于人眼对齐
 * - 文本字段若含特殊字符(: # " ' 等)目前不转义;本仓库写入的 title/description
 *   是用户输入的纯中文/英文,无 YAML 敏感字符 — 若后续引入富文本,需要补转义
 */
export function serializeProductsYaml(file: ProductsFile): string {
  const kinds: ProductKind[] = ['subproblems', 'risks', 'options']
  const blocks: string[] = []
  for (const k of kinds) {
    if (file[k].length === 0) {
      blocks.push(`${k}: []`)
      continue
    }
    const lines: string[] = [`${k}:`]
    for (const item of file[k]) {
      lines.push(`  - id: ${item.id}`)
      lines.push(`    title: ${item.title}`)
      if (item.description !== undefined && item.description.length > 0) {
        lines.push(`    description: ${item.description}`)
      }
      lines.push(`    severity: ${item.severity}`)
    }
    blocks.push(lines.join('\n'))
  }
  return blocks.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// applyProductChange — 纯函数:edit / delete / add / merge
// ---------------------------------------------------------------------------

/** edit 行为的 patch 字段(title / description / severity 局部更新) */
export interface ProductEditPatch {
  title?: string
  description?: string
  severity?: ProductSeverity
}

/** 单一变更描述(discriminated union by `action`) */
export type ProductChange =
  | {
      kind: ProductKind
      action: 'edit'
      id: string
      patch: ProductEditPatch
    }
  | {
      kind: ProductKind
      action: 'delete'
      id: string
    }
  | {
      kind: ProductKind
      action: 'add'
      item: ProductItem
    }
  | {
      kind: ProductKind
      action: 'merge'
      ids: string[]
      newId: string
      newTitle: string
      newSeverity: ProductSeverity
      newDescription?: string
    }

/**
 * 应用单一变更 → 新 ProductsFile(不改入参)。
 *
 * 行为细节:
 * - edit:按 id 查找条目;找不到 → no-op(返回浅拷贝)
 * - delete:按 id 移除;找不到 → no-op
 * - add:追加到该类末尾
 * - merge:删除 ids 数组中的条目,新条目(由 caller 生成 newId)追加到末尾;
 *   本函数不检查 newId 是否与现有 id 重复 — caller 应保证(用 crypto.randomUUID)
 *
 * 顺序稳定性:delete/merge 保留剩余条目的原顺序;add/merge 的新条目追加到末尾。
 */
export function applyProductChange(
  file: ProductsFile,
  change: ProductChange,
): ProductsFile {
  switch (change.action) {
    case 'edit':
      return applyEdit(file, change.kind, change.id, change.patch)
    case 'delete':
      return applyDelete(file, change.kind, change.id)
    case 'add':
      return applyAdd(file, change.kind, change.item)
    case 'merge':
      return applyMerge(file, change.kind, change.ids, {
        id: change.newId,
        title: change.newTitle,
        severity: change.newSeverity,
        ...(change.newDescription !== undefined
          ? { description: change.newDescription }
          : {}),
      })
  }
}

function applyEdit(
  file: ProductsFile,
  kind: ProductKind,
  id: string,
  patch: ProductEditPatch,
): ProductsFile {
  let changed = false
  const next = file[kind].map((item) => {
    if (item.id !== id) return item
    changed = true
    return {
      id: item.id, // id 稳定:edit 不改 id
      title: patch.title ?? item.title,
      severity: patch.severity ?? item.severity,
      ...(patch.description !== undefined
        ? { description: patch.description }
        : item.description !== undefined
          ? { description: item.description }
          : {}),
    }
  })
  if (!changed) return file
  return { ...file, [kind]: next }
}

function applyDelete(
  file: ProductsFile,
  kind: ProductKind,
  id: string,
): ProductsFile {
  const filtered = file[kind].filter((it) => it.id !== id)
  if (filtered.length === file[kind].length) return file // 没找到,no-op
  return { ...file, [kind]: filtered }
}

function applyAdd(
  file: ProductsFile,
  kind: ProductKind,
  item: ProductItem,
): ProductsFile {
  return { ...file, [kind]: [...file[kind], item] }
}

function applyMerge(
  file: ProductsFile,
  kind: ProductKind,
  ids: string[],
  newItem: ProductItem,
): ProductsFile {
  const idSet = new Set(ids)
  const remaining = file[kind].filter((it) => !idSet.has(it.id))
  return { ...file, [kind]: [...remaining, newItem] }
}