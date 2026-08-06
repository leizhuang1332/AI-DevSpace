/**
 * TranscriptRefParser —— 解析 TaskCard transcript 输入文本里的 `#[id]` 引用
 *
 * ADR-0028 D3 / PRD US-32 描述:用户在 transcript 输入框用 `#[id]` 引用
 * 父 analyzing Run 产物 / PRD 段落 / asset,展开为指向父产物的可读 link。
 *
 * 设计要点:
 * - 解析产物形态 = `TranscriptRef`(三种 kind:prd_section / run_id / asset)
 * - 解析文本来源 = transcript 输入框文本(原始 user input)
 * - **不**调 Provider / **不**改写输入文本 / **不**发 Run
 * - 解析失败(未知前缀)→ 跳过该 token,继续解析剩余内容;
 *   上层 caller 决定是否要给用户 hint
 *
 * 三种引用语法(实施选型,留 impl 阶段决定):
 *
 * | 语法                       | kind          | 解析产物                                                           |
 * |----------------------------|---------------|--------------------------------------------------------------------|
 * | `#run-<id>`                | `run_id`      | `{ kind: 'run_id', run_id: 'run-xxx' }`                            |
 * | `#run-<id>` 也接受 `#r<id>` | 同上          | 兼容别名(若 caller 不带 `run-` 前缀时使用)                       |
 * | `#prd §2.3` / `#prd:2.3`   | `prd_section` | `{ kind: 'prd_section', path: 'requirement.md', line_range: [2,3] }` |
 * | `#asset <name>`             | `asset`       | `{ kind: 'asset', name: 'xxx.png' }`                               |
 *
 * 注意:`#prd §2.3` 里的 `§` 字符是 U+00A7 SECTION SIGN,实施选型接受
 * 全角 / 半角逗号 / 全角点多种分隔符,简化用户输入摩擦(决策 24 克制在场)。
 */

import type { TranscriptRef } from '@ai-devspace/shared'

/**
 * 解析出来的引用 + 在原文中的位置(便于上层替换 / 高亮)。
 *
 * `match` 是 `#[...]` 的原文(包含 `#` 前缀),`index` 是匹配在 input 中的起始偏移。
 */
export interface ParsedTranscriptRef {
  ref: TranscriptRef
  match: string
  index: number
}

/**
 * 解析 transcript 输入文本里的所有 `#[id]` 引用。
 *
 * 实现:`#[run-id]` 形态直接正则捕获;`#prd §x.y` 与 `#asset <name>`
 * 形态用行内语法(support 多空格 / 全角逗号 / 中文 §)。
 *
 * 输入:用户原始输入文本(可能含 Markdown / 普通文本混排)
 * 输出:按出现顺序排列的 `ParsedTranscriptRef[]`
 *
 * 不会抛错:任意 token 解析失败(前缀未知 / 格式非法)→ 跳过,
 * 返回成功解析的子集。
 */
export function parseTranscriptRefs(input: string): ParsedTranscriptRef[] {
  const out: ParsedTranscriptRef[] = []
  if (!input) return out

  // 1) 先抓 `#prd` 与 `#asset` 形式 —— 它们允许 token 内部含空白 +
  //    后接参数(`#prd §2.3-5`、`#asset diagram.png`)。
  //    用非贪婪 + 到下一个 `#` 或行边界前停。
  const PRD_OR_ASSET_RE =
    /#(prd|asset)([ \t§:]+([^\n#]+?))?(?=\s*(?:#|$|\n|[,;。、:!?]))/g
  let m: RegExpExecArray | null
  while ((m = PRD_OR_ASSET_RE.exec(input))) {
    const prefix = m[1] ?? ''
    const suffix = m[3] ?? ''
    const ref =
      prefix === 'prd' ? parsePrdRefToken(suffix) : parseOneToken(prefix + suffix)
    if (ref) {
      out.push({
        ref,
        match: m[0],
        index: m.index,
      })
    }
  }

  // 2) 再抓其它 token(无内部空白,纯 word 边界)
  //    —— `#run-abc123`、`#asset foo.png`、`#r<id>` 等。
  //    字符集边界:`#` 之后到下一个空白 / 标点(常见分隔符)/ 行尾。
  const TOKEN_RE = /#([^\s#][^\s,;。、:!?]*)/g
  while ((m = TOKEN_RE.exec(input))) {
    const token = m[1] ?? ''
    const match = m[0]
    const index = m.index
    // 跳过已被 prd 规则捕获的位置(避免双计)
    if (out.some((r) => r.index === index)) continue
    const ref = parseOneToken(token)
    if (ref) out.push({ ref, match, index })
  }

  // 按 index 升序排序
  out.sort((a, b) => a.index - b.index)
  return out
}

/**
 * 解析单个 token(去掉 `#` 之后的内容)。
 *
 * 已知前缀(`run` / `r` / `prd` / `asset`) → 返对应 `TranscriptRef`;
 * 未知前缀 → 返 null(由 caller 决定是否提示用户)。
 */
export function parseOneToken(token: string): TranscriptRef | null {
  if (!token) return null

  // run / r 前缀:run-<id> 形式 —— id 部分允许字母 / 数字 / `-` / `_`,
  // 至少 1 字符。
  if (token === 'run' || token === 'r') return null // 单独前缀不构成有效引用
  if (token.startsWith('run-')) {
    const id = token.slice('run-'.length)
    if (!id) return null
    return { kind: 'run_id', run_id: `run-${id}` }
  }
  // 兼容别名 —— 本期不启用。`#r<id>` 与 `react`、`runo` 等普通词在 token
  // 形态上无法区分(都形如 `r<letters>`),接受任一会产生「react 被误
  // 识别为 run-id」的歧义。spec 只要求 `#run-<id>`,实施上仅支持该
  // 形式;后续如真要加短别名,需先决定 run_id 命名空间规则(例如 id
  // 段必须含数字或长度 N+)。

  // prd §x.y 或 prd:x-y 或 prd x
  if (token.startsWith('prd')) {
    return parsePrdRefToken(token.slice('prd'.length))
  }

  // asset <name>
  if (token.startsWith('asset')) {
    const name = token.slice('asset'.length).trim()
    if (!name) return null
    // name 内允许常见字符(字母 / 数字 / `.` / `_` / `-`)
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
    return { kind: 'asset', name }
  }

  return null
}

/**
 * 解析 `#prd` 后面的内容 —— 期望 `§x.y` / `:x-y` / ` x` 等多种分隔符。
 *
 * 实施选型:接受以下任一形态 → 都映射为 `{ kind: 'prd_section', path,
 'requirement.md', line_range: [start, end) }`:
 * - `#prd §2.3` → line_range = [2, 3]
 * - `#prd §2.3-5` → line_range = [2, 5]
 * - `#prd:2.3` → line_range = [2, 3]
 * - `#prd:2-5` → line_range = [2, 5]
 * - `#prd 2.3` → 同上
 *
 * 失败(null):无数字 / 数字格式非法。
 */
export function parsePrdRefToken(suffix: string): TranscriptRef | null {
  // 接受前导 §/:/ / 等分隔符
  const trimmed = suffix.replace(/^[\s§:]+/, '').trim()
  if (!trimmed) return null

  // 解析 line_range —— 支持多种分隔符与混合形式:
  // - `2.3`   → [2, 3]   (点号)
  // - `2-5`   → [2, 5]   (横线)
  // - `2.3-5` → [2, 5]   (混合:取首尾两个数字)
  // - `2-3-5` → [2, 5]   (多个分隔:取首尾两个数字)
  // - `5`     → [5, 5]   (单点)
  // 失败条件:无任何数字 / start > end。
  const numberMatches = trimmed.match(/\d+/g)
  if (!numberMatches || numberMatches.length === 0) return null

  const startStr = numberMatches[0] ?? ''
  const endStr =
    numberMatches.length > 1
      ? (numberMatches[numberMatches.length - 1] ?? startStr)
      : startStr
  const start = Number.parseInt(startStr, 10)
  const end = Number.parseInt(endStr, 10)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end < start) return null

  return {
    kind: 'prd_section',
    path: 'requirement.md',
    line_range: [start, end],
  }
}

/**
 * 工具:把解析后的引用渲染成可读 link 字符串(供 UI 展示 / Markdown 注入)。
 *
 * 三种形态输出:
 * - `run_id` → `📎 Run #<id>`
 * - `prd_section` → `📄 PRD §<start>-<end>`
 * - `asset` → `🖼️ Asset <name>`
 *
 * 不参与解析,仅展示用。
 */
export function renderRefAsReadable(ref: TranscriptRef): string {
  switch (ref.kind) {
    case 'run_id': {
      const id = ref.run_id.startsWith('run-')
        ? ref.run_id.slice('run-'.length)
        : ref.run_id
      return `📎 Run #${id}`
    }
    case 'prd_section': {
      const [start, end] = ref.line_range ?? [0, 0]
      return `📄 PRD §${start}-${end}`
    }
    case 'asset': {
      return `🖼️ Asset ${ref.name}`
    }
  }
}