import { getRequirementOverview } from './requirement-overview'
import { getZoneByRouteSegment, ZONE_META } from './zones'

/**
 * AI 思考条数据层(issue 16 · ADR-0012 §3)。
 *
 * 三种来源(由 ThinkBarSlot 按路由上下文挑选):
 * 1. getZoneAIStatus(zone):      工位级内容 — 用 zone.route_segment 索引
 * 2. getRequirementAIStatus(id): 需求级内容 — 用于 Overview
 * 3. ambientAIStatus():          其他路由的默认 standby 状态
 *
 * 输出: { title, sub }
 * - title: 1 行主文案(可能含 <strong> 强调)
 * - sub:   副标题(meta 信息,如时间戳 / 候命 / 待回答)
 *
 * 设计原则:
 * - 纯函数 + 类型化,便于 TDD
 * - mock 阶段硬编码 6 工位 + req-001 的样例数据;后续接 agent API 时
 *   把 getZoneAIStatus/getRequirementAIStatus 替换为 fetch 即可,
 *   ThinkBarSlot 调用方无需改
 * - 永不调用 Zones 注册表之外的硬编码(避免与 ADR-0012 §9 漂移)
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface AIStatusLine {
  /** 主文案(纯文本,组件层不解析 HTML,避免 XSS 面) */
  title: string
  /** 副标题 / meta,如 "· 12:08:41 · 候命 5 · 待回答 2" */
  sub: string
}

// ---------------------------------------------------------------------------
// 工位级(zone route)
// ---------------------------------------------------------------------------

/**
 * 工位级 AI 状态 — 输入 zone.route_segment("drafting" / "wrap-up" 等),
 * 返回该工位的 AI 现状描述。
 *
 * 当前为 mock 数据(对照 11g 原型:EXECUTING 显示 "AI 正在执行 T-05")。
 * 后续替换为 agent API(同 issue 17-22 的工位组件一起接)。
 */
export function getZoneAIStatus(zoneSegment: string): AIStatusLine {
  const zone = getZoneByRouteSegment(zoneSegment)
  if (!zone) {
    throw new Error(
      `getZoneAIStatus: unknown zone route_segment "${zoneSegment}"`,
    )
  }

  switch (zone.id) {
    case 'drafting':
      return {
        title: 'AI 待命 · 等待你输入',
        sub: '· 写入 0 行 · 0 轮问答',
      }
    case 'analyzing':
      return {
        title: 'AI 正在分析需求',
        sub: '· 12:08:41 · 已识别 5 子问题 · 3 风险点',
      }
    case 'clarifying':
      return {
        title: 'AI 等待你的回答',
        sub: '· 待回答 2 · 第 3 轮',
      }
    case 'designing':
      return {
        title: 'AI 已生成 3 个候选方案',
        sub: '· 等待你选方案 · 12:14:02',
      }
    case 'executing':
      return {
        title: 'AI 正在执行 T-05',
        sub: '· 12:08:41 · 候命 5 · 待回答 2',
      }
    case 'wrapup':
      return {
        title: 'AI 待命 · 等你确认归档',
        sub: '· 12:14:02',
      }
    // runtime 兜底:ZONE_META 6 个 case 已穷举,ZoneMeta.id 是 string
    // 类型不是 union,所以 TS 不知道穷举 — 兜底返回 ambient
    default:
      return { title: 'AI 待命', sub: '' }
  }
}

// ---------------------------------------------------------------------------
// 需求级(Overview route)
// ---------------------------------------------------------------------------

/**
 * 需求级 AI 状态 — 输入 requirementId,返回该需求下的 AI 活动累计。
 *
 * 数据来源:getRequirementOverview() 的 aiActivity 字段(mock)。
 * - 已知 id(req-001) → 返回真实累计摘要(对照 11g 原型 "AI 累计工作 1h 23min · 124 行写入")
 * - 未知 id → 返回 idle idle 状态(空数据显示)
 */
export async function getRequirementAIStatus(
  requirementId: string,
): Promise<AIStatusLine> {
  const data = await getRequirementOverview(requirementId)
  if (data.empty) {
    return {
      title: 'AI 待命',
      sub: '· 累计工作 0 分钟 · 写入 0 行',
    }
  }
  const totalMin = data.aiActivity.totalActiveMinutes
  const totalLines = data.aiActivity.totalLinesWritten
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  const durationStr =
    hours > 0 ? `${hours}h ${minutes}min` : `${minutes} 分钟`
  return {
    title: `AI 累计工作 ${durationStr} · ${totalLines} 行写入`,
    sub: `· skill 调用 ${data.aiActivity.skillCalls} · 快照 ${data.aiActivity.snapshotCount}`,
  }
}

// ---------------------------------------------------------------------------
// 其他路由(ambient)
// ---------------------------------------------------------------------------

/**
 * Ambient 待机状态 — 用于非工作台路由(列表 / settings / 根 等)。
 *
 * 表达"AI 始终在场"的产品承诺(决策 24)。
 */
export function ambientAIStatus(): AIStatusLine {
  return {
    title: 'AI 待命',
    sub: '· ⌘I 提问 · ⌘K 命令',
  }
}
