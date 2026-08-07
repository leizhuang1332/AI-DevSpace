/**
 * Web 端 section 元数据(4 section hardcode,ADR-0026)。
 *
 * 本文件由旧 `zones.ts` 重写而来 —— zones 声明式注册表(`ZONE_META` 数组 +
 * agent 端 `ZoneRegistry.ts` + `~/.aidevspace/zones/*.yaml` + shared `ZoneConfig`
 * schema)整体退役,改为硬编码 4 section 枚举。详见 ADR-0026 D1-D6。
 *
 * 4 section = `drafting` / `board` / `analyzing` / `wrapup`(CLARIFYING / DESIGNING /
 * EXECUTING 三工位已退役,功能吸收到 BOARD section,详见 ADR-0027)。
 *
 * 字段集 7 项(对齐旧 `ZONE_META` 13 字段中实际使用的 7 项):
 * - label:           UI 显示(大写 Tab 文案)
 * - icon:            Tab 图标(emoji)
 * - statusColor:     状态色(ZoneBar 状态点,决策 22)
 * - statusPulse:     状态点是否脉动(ADR §6 决策 49 — 仅 ANALYZING = true)
 * - hasResourceTree: 是否渲染 ResourceTree(左 240px)
 * - hasInlineRail:   是否渲染 InlineRail(右 120px,决策 53)
 * - description:     给 AI / 工具看的描述(Cmd+K 命令面板)
 * - defaultArming:   默认 armed skill(ADR-0012 D5 改为 hardcode)
 *
 * 注:Next.js 动态段名仍叫 `[zone]`(ADR-0026 D3:不重命名,避免改大量代码),
 * 语义改为 section 仅在注释出现。
 *
 * 历史:旧字段 `display_name` / `route_segment`(snake_case)/ `main_layout` /
 * `entry_triggers` / `exit_triggers` 已退役(`route_segment` 仍保留为 SectionMeta
 * 字段,因为 wrapup 段名解耦 id ↔ URL)。
 */
export type SectionStatusColor =
  | 'gray'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'green'
  | 'red'
  | 'purple-warn'

export interface SectionMeta {
  /** 内部 id(程序命名,与 REQUIREMENT_SECTIONS 对齐) */
  id: RequirementSection
  /** 大写显示名(ZoneBar Tab 文案) */
  label: string
  /** 中文显示(a11y / tooltip,Overview 地图用) */
  displayName: string
  /** Tab 图标(emoji) */
  icon: string
  /** URL 片段(与 id 解耦,如 wrapup → wrap-up) */
  routeSegment: string
  /** 工位专属 shell 是否渲染资源树 */
  hasResourceTree: boolean
  /** 工位专属 shell 是否渲染 Inline 栏 */
  hasInlineRail: boolean
  /** 状态色(ZoneBar 状态点) */
  statusColor: SectionStatusColor
  /** 状态点是否脉动(ADR §6 决策 49 — 仅 ANALYZING = true) */
  statusPulse: boolean
  /** 给 AI / 工具看的描述(Cmd+K 命令面板) */
  description: string
  /** 默认装备 Skill 列表(ADR-0012 D5 改为 hardcode) */
  defaultArming: string[]
}

/** 4 section 集合(hardcode 枚举,ADR-0026 D2) */
export const REQUIREMENT_SECTIONS = [
  'drafting',
  'analyzing',
  'board',
  'wrapup',
] as const
export type RequirementSection = (typeof REQUIREMENT_SECTIONS)[number]

/** 4 section 元数据(按 lifecycle 顺序) */
export const SECTION_META: Record<RequirementSection, SectionMeta> = {
  drafting: {
    id: 'drafting',
    label: 'DRAFTING',
    displayName: '起草',
    icon: '✏️',
    routeSegment: 'drafting',
    // issue 01 后:DRAFTING 单主区 + 右侧 Inline 栏(无资源树)
    hasResourceTree: false,
    hasInlineRail: true,
    statusColor: 'gray',
    statusPulse: false,
    description: '撰写需求文档,建立初始上下文',
    defaultArming: [],
  },
  board: {
    id: 'board',
    label: 'BOARD',
    displayName: '看板',
    icon: '📋',
    routeSegment: 'board',
    // ADR-0027 D2:board 不需要资源树 / inline 栏(协作走详情页右抽屉)
    hasResourceTree: false,
    hasInlineRail: false,
    statusColor: 'blue',
    statusPulse: false,
    description: '任务看板 · 5 列工作项推进',
    defaultArming: [],
  },
  analyzing: {
    id: 'analyzing',
    label: 'ANALYZING',
    displayName: '分析',
    icon: '🧠',
    routeSegment: 'analyzing',
    hasResourceTree: false,
    hasInlineRail: false,
    statusColor: 'purple-warn',
    statusPulse: true,
    description:
      '由 Analysis Skill 驱动的 Analysis Run,识别 Analysis Issue 并通过 Issue Response 持续完善需求上下文',
    defaultArming: [],
  },
  wrapup: {
    id: 'wrapup',
    label: 'WRAP-UP',
    displayName: '归档',
    icon: '📦',
    routeSegment: 'wrap-up',
    hasResourceTree: true,
    hasInlineRail: false,
    statusColor: 'gray',
    statusPulse: false,
    description: '归档复盘,沉淀知识库',
    defaultArming: [],
  },
}

/** 按 lifecycle 顺序排列的 4 section 数组(ZoneBar Tab / CLI 列表用) */
export const SECTION_LIFECYCLE_ORDER: readonly RequirementSection[] =
  REQUIREMENT_SECTIONS

/** 默认 section(lifecycle 起点) */
export const DEFAULT_ZONE_ID: RequirementSection = 'drafting'

// ============================================================================
// UI 派生映射(集中维护,避免 Shotgun Surgery)
// ============================================================================

/**
 * ZoneBar 状态色点 tailwind 类(ADR-0012 §6 决策 22)。
 * purple-warn = 紫色填充 + 红色环(ANALYZING 特殊标记,原 CLARIFYING 的紫+红
 * 现归 analyzing section)。
 */
export const SECTION_STATUS_COLOR_CLASS: Record<SectionStatusColor, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  'purple-warn': 'bg-purple-500 ring-2 ring-red-500',
}

/** ZoneBar 状态色中文标签(占位 page 元数据展示) */
export const SECTION_STATUS_COLOR_LABEL: Record<SectionStatusColor, string> = {
  gray: '灰',
  blue: '蓝',
  purple: '紫',
  yellow: '黄',
  green: '绿',
  red: '红',
  'purple-warn': '紫(警示)',
}

// ============================================================================
// 路由解析(ADR-0026 D3:4 segment contract)
// ============================================================================

/**
 * 通过 URL 片段查 section;未知 → null(由调用方决定 404 或 fallback)。
 *
 * 注:函数名保留 `getZoneByRouteSegment` 作为向后兼容别名(部分调用方未改名),
 * 新代码请用 `getSectionByRouteSegment`。
 */
export function getSectionByRouteSegment(
  segment: string,
): SectionMeta | null {
  const section = (REQUIREMENT_SECTIONS as readonly string[]).find(
    (id) => SECTION_META[id as RequirementSection].routeSegment === segment,
  )
  return section ? SECTION_META[section as RequirementSection] : null
}

/** 向后兼容别名(旧调用方迁移期保留) */
export const getZoneByRouteSegment = getSectionByRouteSegment

/**
 * 共享路由正则 —— 单一事实源,避免与 ZoneBar 漂移。
 *
 * 仅捕获 /requirements/<id>/<zone>/ 这一层(id 不含 /,zone 不含 /)
 * - ZoneBar: 提取当前 zone 渲染 Tab
 *
 * 历史:issue 16 复审时与 useZone 共享,2026-07 useZone 随 ThinkBar 下线
 * 一并删除,本注释同步简化(见 issue 16 wontfix)。
 */
export const REQUIREMENTS_ZONE_PATH_RE =
  /^\/requirements\/([^/]+)\/([^/]+)\/?$/

/** Overview 路径 /requirements/<id>/ — 严格 3 段,避免吞 /<id>/<zone>/<extra>/ */
export const REQUIREMENTS_OVERVIEW_PATH_RE =
  /^\/requirements\/([^/]+)\/?$/

/**
 * 解析 cookie 中的 last_zone → 合法 routeSegment。
 *
 * 规则(ADR-0012 §8 重定向逻辑 + 决策 15):
 * - cookie 缺失 → DEFAULT_ZONE_ID 对应 routeSegment
 * - cookie 是合法 routeSegment → 使用它
 * - cookie 是未知值 / 是 id 而非 routeSegment → fallback DEFAULT_ZONE_ID
 *
 * 永不基于 meta.yaml.status 推断(决策 15 反对状态机)。
 *
 * 注:函数名保留 `resolveDefaultZoneRouteSegment`(cookie 名 `last_zone` 不改)。
 */
export function resolveDefaultZoneRouteSegment(
  cookieValue: string | undefined,
): string {
  if (cookieValue) {
    const found = getSectionByRouteSegment(cookieValue)
    if (found) return found.routeSegment
  }
  return getSectionByRouteSegment(DEFAULT_ZONE_ID)!.routeSegment
}
