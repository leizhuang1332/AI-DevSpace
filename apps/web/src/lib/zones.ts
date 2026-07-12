/**
 * Web 端工位元数据(精简版,只 web UI 关心的字段)
 *
 * 数据与 `apps/agent/src/zones/*.yaml` 同步维护 —— 单一事实源在 agent yaml,
 * web 端复刻一份是为避免在浏览器侧引入 yaml 解析,以及未来通过 agent API
 * 拉取时的过渡形态(issue 17+ 统一 server-client 同步)。
 *
 * 字段语义遵循 ADR-0012 §9 与 §4(shell 层 2 详解):
 * - has_resource_tree: 是否渲染 ResourceTree(左 240px)
 * - has_inline_rail:   是否渲染 InlineRail(右 120px)
 * - status_color:      ZoneBar 状态色(决策 22)
 * - status_pulse:      状态点是否脉动(ADR §6 决策 49 — 仅 ANALYZING = true)
 * - thinking_bar:      AI 思考条模式(决策 24 / A3 全局 + 工位内容)
 */
export type ZoneStatusColor =
  | 'gray'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'green'
  | 'red'
  | 'purple-warn'

export type ZoneThinkingBar = 'required' | 'minimal' | 'hidden'

export interface ZoneMeta {
  /** 内部 id(程序命名) */
  id: string
  /** 大写显示名(ZoneBar Tab 文案) */
  name: string
  /** 中文显示(a11y / tooltip) */
  display_name: string
  /** Tab 图标(emoji) */
  icon: string
  /** URL 片段(与 id 解耦,如 wrapup → wrap-up) */
  route_segment: string
  /** 工位专属 shell 是否渲染资源树 */
  has_resource_tree: boolean
  /** 工位专属 shell 是否渲染 Inline 栏 */
  has_inline_rail: boolean
  /** 状态色(ZoneBar 状态点) */
  status_color: ZoneStatusColor
  /** 状态点是否脉动(ADR §6 决策 49) */
  status_pulse: boolean
  /** AI 思考条模式 */
  thinking_bar: ZoneThinkingBar
  /** 给 AI / 工具看的描述 */
  description: string
}

/** 6 工位元数据(按 lifecycle 顺序) */
export const ZONE_META: readonly ZoneMeta[] = [
  {
    id: 'drafting',
    name: 'DRAFTING',
    display_name: '起草',
    icon: '✏️',
    route_segment: 'drafting',
    has_resource_tree: true,
    has_inline_rail: true,
    status_color: 'gray',
    status_pulse: false,
    thinking_bar: 'required',
    description: '撰写需求文档,建立初始上下文',
  },
  {
    id: 'analyzing',
    name: 'ANALYZING',
    display_name: '分析中',
    icon: '🔍',
    route_segment: 'analyzing',
    has_resource_tree: false,
    has_inline_rail: false,
    status_color: 'blue',
    status_pulse: true,
    thinking_bar: 'required',
    description: 'AI 旁观思考,展示推理过程',
  },
  {
    id: 'clarifying',
    name: 'CLARIFYING',
    display_name: '澄清',
    icon: '❓',
    route_segment: 'clarifying',
    has_resource_tree: false,
    has_inline_rail: false,
    status_color: 'purple-warn',
    status_pulse: false,
    thinking_bar: 'required',
    description: '回答 AI 的提问,提供决策信息',
  },
  {
    id: 'designing',
    name: 'DESIGNING',
    display_name: '设计',
    icon: '🎨',
    route_segment: 'designing',
    has_resource_tree: false,
    has_inline_rail: false,
    status_color: 'yellow',
    status_pulse: false,
    thinking_bar: 'required',
    description: '评审 AI 候选方案,选择最终路径',
  },
  {
    id: 'executing',
    name: 'EXECUTING',
    display_name: '执行中',
    icon: '⚡',
    route_segment: 'executing',
    has_resource_tree: true,
    has_inline_rail: true,
    status_color: 'green',
    status_pulse: false,
    thinking_bar: 'required',
    description: '监督 AI 实施,审阅 PR 与测试',
  },
  {
    id: 'wrapup',
    name: 'WRAP-UP',
    display_name: '归档',
    icon: '📦',
    route_segment: 'wrap-up',
    has_resource_tree: true,
    has_inline_rail: false,
    status_color: 'gray',
    status_pulse: false,
    thinking_bar: 'minimal',
    description: '归档复盘,沉淀知识库',
  },
] as const

/** 工位 lifecycle 顺序 —— ZoneBar Tab、CLI 列表等 */
export const ZONE_LIFECYCLE_ORDER = [
  'drafting',
  'analyzing',
  'clarifying',
  'designing',
  'executing',
  'wrapup',
] as const
export type ZoneLifecycleId = (typeof ZONE_LIFECYCLE_ORDER)[number]

/** 默认工位(lifecycle 起点) */
export const DEFAULT_ZONE_ID = 'drafting'

// ============================================================================
// UI 派生映射(集中维护,避免 Shotgun Surgery)
// ============================================================================

/**
 * ZoneBar 状态色点 tailwind 类(ADR-0012 §6 决策 22)。
 * purple-warn = 紫色填充 + 红色环(CLARIFYING 特殊标记)。
 */
export const ZONE_STATUS_COLOR_CLASS: Record<ZoneStatusColor, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  'purple-warn': 'bg-purple-500 ring-2 ring-red-500',
}

/** ZoneBar 状态色中文标签(占位 page 元数据展示) */
export const ZONE_STATUS_COLOR_LABEL: Record<ZoneStatusColor, string> = {
  gray: '灰',
  blue: '蓝',
  purple: '紫',
  yellow: '黄',
  green: '绿',
  red: '红',
  'purple-warn': '紫(警示)',
}

// ============================================================================
// 路由解析
// ============================================================================

/** 通过 URL 片段查工位;未知 → null(由调用方决定 404 或 fallback) */
export function getZoneByRouteSegment(segment: string): ZoneMeta | null {
  return ZONE_META.find((z) => z.route_segment === segment) ?? null
}

/**
 * 共享路由正则 —— 单一事实源,避免与 ZoneBar/useZone 漂移(issue 16 · 复审)。
 *
 * 仅捕获 /requirements/<id>/<zone>/ 这一层(id 不含 /,zone 不含 /)
 * - ZoneBar: 提取当前 zone 渲染 Tab
 * - useZone: 推断客户端位置 + 提供给 ThinkBarSlot
 */
export const REQUIREMENTS_ZONE_PATH_RE =
  /^\/requirements\/([^/]+)\/([^/]+)\/?$/

/** Overview 路径 /requirements/<id>/ — 严格 3 段,避免吞 /<id>/<zone>/<extra>/ */
export const REQUIREMENTS_OVERVIEW_PATH_RE =
  /^\/requirements\/([^/]+)\/?$/

/**
 * 解析 cookie 中的 last_zone → 合法 route_segment。
 *
 * 规则(ADR-0012 §8 重定向逻辑 + 决策 15):
 * - cookie 缺失 → DEFAULT_ZONE_ID 对应 route_segment
 * - cookie 是合法 route_segment → 使用它
 * - cookie 是未知值 / 是 id 而非 route_segment → fallback DEFAULT_ZONE_ID
 *
 * 永不基于 meta.yaml.status 推断(决策 15 反对状态机)。
 */
export function resolveDefaultZoneRouteSegment(
  cookieValue: string | undefined,
): string {
  if (cookieValue) {
    const found = getZoneByRouteSegment(cookieValue)
    if (found) return found.route_segment
  }
  return getZoneByRouteSegment(DEFAULT_ZONE_ID)!.route_segment
}