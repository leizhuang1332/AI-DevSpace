/**
 * DRAFTING 工位数据层(issue 01 — 重新设计前的 foundation)。
 *
 * 本模块是后续 issue 02-08(PRD 顶部编辑面板 / 锚点栏 / 辅助文件卡片 / Drawer /
 * 创建上传 / mock 转换 / 相对链接 / 仓库底部栏)的基础 —— 它们都依赖:
 *
 * - `AuxFile`        辅助文件数据模型(usage_tag / source_format / converted_to_md)
 * - `generatePrdSkeleton`  新建需求时一键生成 PRD Markdown 骨架
 * - `extractPrdAnchors`    H1 + H2 锚点(后续 issue 03 顶部锚点栏用)
 * - `resolveAuxLink`       PRD 内相对 Markdown 链接 → 已知 AuxFile 解析器
 * - `validateLaunch`       启动 ANALYZING 工位前的完备度校验
 * - `mockConvertToMarkdown` 客户端 mock 文件格式转换器(.md / .docx / .pdf)
 *
 * 设计原则:
 * - 纯函数 + 类型化;不依赖文件系统 / 网络 / 任何 IO
 * - 同步行为可预测,便于单测;返回结构稳定,便于上层按需扩展
 * - 在 `packages/shared` 而非 `apps/web/lib` —— web 与 agent 双端共享
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** AuxFile 使用场景分类 —— 6 种固定枚举(issue 01 验收 #1) */
export type UsageTag = 'api' | 'data' | 'research' | 'sop' | 'ui' | 'other'

/** 源文件格式 —— 3 种受控枚举(.md 跳过转换;.docx / .pdf 走 mockConvert) */
export type SourceFormat = 'md' | 'docx' | 'pdf'

/**
 * 辅助文件(Requirement 内用户上传的参考资料;issue 01 验收 #1)
 *
 * - id:稳定标识(后续 issue 04/05 卡片 + Drawer 都用 id 做 key)
 * - filename:相对 Requirement 根的显示名(也用于 resolveAuxLink 匹配)
 * - body:已转 Markdown 的内容(`.md` 源 = 原内容;`.docx` / `.pdf` = mockConvert 输出)
 * - usage_tag:6 种受控分类,UI 上用作颜色 / 图标 hint
 * - source_format:原始格式(.md 跳过转换 → converted_to_md=false)
 * - converted_to_md:是否经过 mockConvertToMarkdown 处理
 */
export interface AuxFile {
  id: string
  filename: string
  body: string
  usage_tag: UsageTag
  source_format: SourceFormat
  converted_to_md: boolean
}

/**
 * PRD 顶部锚点(issue 03 锚点栏的最小数据单元;issue 01 验收 #3)
 *
 * 仅 H1 + H2 —— H3 及更深不进入顶部锚点栏(避免滚动列表过长)。
 * line 记录源 Markdown 中 0-based 行号,UI 点击锚点可滚动定位。
 */
export interface PrdAnchor {
  level: 1 | 2
  title: string
  /** 0-based 源 Markdown 行号 */
  line: number
}

/**
 * 启动校验结果(issue 01 验收 #5 + issue 04 ticket 收窄)
 *
 * - canLaunch:true 时调用方可进入 ANALYZING 工位
 *
 * 此接口只关心 prdMarkdown 的最小完备度;不检查 title(由 NewRequirementModal
 * 在新建时一次性写入 meta.yaml.title,后续 DRAFTING 工位不暴露编辑入口)、
 * 不检查 repos / aux_files,留给上层(execution policy / repo soft-warning)
 * 做更细的判断。
 */
export interface LaunchValidity {
  canLaunch: boolean
}

/**
 * mockConvertToMarkdown 输入参数(issue 01 验收 #6)
 *
 * - filename 用于扩展名检测 + 输出提示;content 用于确定性派生 Markdown
 *   (本 mock 不解析内容,但保留入参以匹配未来真实实现的接口形状)
 */
export interface ConvertInput {
  filename: string
  content: string
}

// ---------------------------------------------------------------------------
// 纯函数 #1:generatePrdSkeleton — PRD Markdown 骨架(issue 01 验收 #2)
// ---------------------------------------------------------------------------

/**
 * 生成 PRD Markdown 骨架:title 作为 H1,固定 4 个 H2 章节
 * (背景 / 目标 / 验收标准 / 非目标)。
 *
 * 纯函数 —— 相同 title 产出相同输出。空 title 仍生成合法骨架(占位 H1),
 * 上层 UI 可在保存前再次校验(见 `validateLaunch`)。
 */
export function generatePrdSkeleton(title: string): string {
  const safeTitle = title.trim() || '未命名需求'
  return [
    `# ${safeTitle}`,
    '',
    '## 背景',
    '',
    '<!-- 描述业务背景、用户痛点、为什么现在要做 -->',
    '',
    '## 目标',
    '',
    '- <!-- 目标 1 -->',
    '',
    '## 验收标准',
    '',
    '- [ ] <!-- AC 1 -->',
    '',
    '## 非目标',
    '',
    '- <!-- 明确不做的事,避免范围蔓延 -->',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 纯函数 #2:extractPrdAnchors — H1 + H2 锚点(issue 01 验收 #3)
// ---------------------------------------------------------------------------

/**
 * 匹配 ATX 风格 Markdown heading:
 * - 行首 1-2 个 `#`(H1 / H2)后必须跟空格;空标题 / 无空格都不算
 * - 行尾允许可选的 `#` 闭合(CommonMark 规范)
 * - 标题文本 trim 后写入
 */
const ANCHOR_HEADING_RE = /^(#{1,2})\s+(.+?)\s*#*\s*$/

/**
 * 解析 PRD Markdown,仅返回 H1 / H2 锚点(issue 01 验收 #3)。
 *
 * 较 `extractPrdOutline`(apps/web/lib/drafting.ts,旧 outline 支持 H1~H3),
 * 本函数是"顶部锚点栏"专用数据源:更深层级的标题不参与,避免滚动列表过长。
 *
 * 返回每条锚点含 `line`(源 Markdown 0-based 行号),UI 滚动定位可据此计算
 * 字符偏移或直接调编辑器 jumpToLine(line)。
 */
export function extractPrdAnchors(markdown: string): PrdAnchor[] {
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const anchors: PrdAnchor[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ANCHOR_HEADING_RE)
    if (!m) continue
    const level = m[1].length as 1 | 2
    const title = m[2].trim()
    if (!title) continue
    anchors.push({ level, title, line: i })
  }
  return anchors
}

// ---------------------------------------------------------------------------
// 纯函数 #3:resolveAuxLink — 相对 Markdown 链接解析器(issue 01 验收 #4)
// ---------------------------------------------------------------------------

/**
 * 解析 PRD Markdown 内相对链接 → 对应已知 AuxFile。
 *
 * 规则(issue 01 验收 #4):
 * - 必须为相对路径(非 http(s) / mailto / fragment-only / 绝对路径)
 * - 不允许 `..` 路径穿越(防越界读取 Requirement 外部文件)
 * - 目标文件名必须存在于已知 auxFiles 中(按 filename 严格匹配)
 * - 目标文件扩展名必须为 `.md`(非 Markdown 文件无法在 PRD 中渲染)
 *
 * `currentFile` 形参保留为接口语义锚点 —— 后续若 PRD 嵌在子目录里,
 * 解析要相对于 currentFile 目录;本期 PRD.md 永远在 Requirement 根目录,
 * 路径只与 basename 匹配,所以 currentFile 不参与匹配。
 */
export function resolveAuxLink(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  currentFile: string,
  target: string,
  auxFiles: readonly AuxFile[],
): AuxFile | null {
  // 1) 空 target / fragment-only → null
  if (!target || target.startsWith('#')) return null

  // 2) 外部协议(http / mailto / 其它) → null
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null

  // 3) 绝对路径 → null(只允许相对路径)
  if (target.startsWith('/')) return null

  // 4) `..` 路径穿越 → null(检查任何路径段是否为 `..`,而不是仅起始)
  const segments = target.split('/')
  if (segments.some((seg) => seg === '..')) return null

  // 5) 取末段文件名(basename)做严格匹配
  const basename = segments[segments.length - 1]
  if (!basename) return null

  // 6) 必须是 Markdown 扩展名(其它 source_format 不在 PRD 内渲染)
  if (!basename.toLowerCase().endsWith('.md')) return null

  // 7) 在已知 auxFiles 中查 filename 严格匹配
  const found = auxFiles.find((f) => f.filename === basename)
  return found ?? null
}

// ---------------------------------------------------------------------------
// 纯函数 #4:validateLaunch — 启动 ANALYZING 前校验(issue 01 验收 #5)
// ---------------------------------------------------------------------------

/**
 * 启动校验:prdMarkdown trim 后非空 → canLaunch=true。
 *
 * 标题不再参与校验 —— 标题在 NewRequirementModal 创建需求时已写入
 * `meta.yaml.title`,列表页 / 面包屑 / 只读 hero 都依赖它,用户在
 * DRAFTING 工位里改不动也无意义(改完与列表页脱节)。
 *
 * 不依赖仓库列表 / 辅助文件 —— 那些是后续 issue 08(repo soft-warning)/
 * 上层 execution policy 关心的,本函数只回答"能否启动 AI 分析"这个最小问题。
 */
export function validateLaunch(input: { prdMarkdown: string }): LaunchValidity {
  const canLaunch = input.prdMarkdown.trim().length > 0
  return { canLaunch }
}

// ---------------------------------------------------------------------------
// 纯函数 #5:mockConvertToMarkdown — mock 转换器(issue 01 验收 #6)
// ------------------------------------------------------------------------===

/**
 * 客户端 mock 文件格式转换器 —— 不解析二进制内容,只根据扩展名返回 deterministic Markdown。
 *
 * - `.md` 输入 → 原内容作为 Markdown 输出,converted_to_md=false(无需转换)
 * - `.docx` / `.pdf` 输入 → 派生 deterministic Markdown,converted_to_md=true
 *
 * 不支持的扩展名抛错(Error)而非静默返回空字符串 —— 上层可在上传前用
 * 扩展名白名单过滤,或在 catch 块中提示用户。
 *
 * 真实实现会替换为 mammoth(.docx) + pdf-parse(.pdf);接口形状不变。
 */
export function mockConvertToMarkdown(input: ConvertInput): {
  body: string
  source_format: SourceFormat
  converted_to_md: boolean
} {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.md')) {
    return {
      body: input.content,
      source_format: 'md',
      converted_to_md: false,
    }
  }
  if (lower.endsWith('.docx')) {
    return {
      body: [
        `# ${input.filename} (mock 转换 · .docx)`,
        '',
        '> 本期未集成 mammoth;mock 仅按文件名派生 deterministic Markdown。',
        '',
        `源文件名:\`${input.filename}\``,
        `源长度:${input.content.length} 字节`,
        '',
        '<!-- 真实 .docx 转换将在 issue 06 集成 mammoth 后替换本函数 -->',
        '',
      ].join('\n'),
      source_format: 'docx',
      converted_to_md: true,
    }
  }
  if (lower.endsWith('.pdf')) {
    return {
      body: [
        `# ${input.filename} (mock 转换 · .pdf)`,
        '',
        '> 本期未集成 pdf-parse;mock 仅按文件名派生 deterministic Markdown。',
        '',
        `源文件名:\`${input.filename}\``,
        `源长度:${input.content.length} 字节`,
        '',
        '<!-- 真实 .pdf 转换将在 issue 06 集成 pdf-parse 后替换本函数 -->',
        '',
      ].join('\n'),
      source_format: 'pdf',
      converted_to_md: true,
    }
  }
  throw new Error(
    `mockConvertToMarkdown: unsupported extension for "${input.filename}" ` +
      `(only .md / .docx / .pdf are supported in mock stage)`,
  )
}