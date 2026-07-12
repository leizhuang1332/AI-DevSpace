import type { AIStatusLine } from '@/lib/zone-ai-status'
import type { ZoneThinkingBar } from '@/lib/zones'

/**
 * ThinkBar — AI 思考条全局 UI(issue 16 · ADR-0012 §3)
 *
 * 视觉对照基线:[11g-zone-tab-navigator.html](../docs/design/pages/11g-zone-tab-navigator.html) 底部条
 *
 * 模式(mode 来自 zone.thinking_bar 字段):
 * - required: 脉冲点(36px 圆 + 脉冲动画 + 🤖) + 1 行文本 + 右侧 2 个按钮(查看详情 / 暂停)
 * - minimal:  状态点(8px) + 1 行短文本,无按钮
 * - hidden:   不渲染(返回 null)
 *
 * 与 ZoneBar 关系:
 * - ZoneBar(7 Tab)定位 shell 层 1 顶部,纯导航
 * - ThinkBar 定位 shell 层 1 底部,内容由当前 zone 注入
 *
 * 与 StatusBar 关系(已存在的项目状态栏):
 * - StatusBar 显示项目级 AI 状态(沿用 ADR-0007 决策 37)
 * - ThinkBar 在状态栏之下,显示 zone/overview 级 AI 状态(issue 16)
 *
 * 过渡动画(issue 16 验收 #4):
 * - 内容切换时通过 `fadeKey` 触发 fade-in 动画(tailwindcss-animate)
 * - 切换 zone/overview/ambient 时 200ms 淡入,避免瞬变(ADR §风险缓解)
 */

export interface ThinkBarProps {
  mode: ZoneThinkingBar
  status: AIStatusLine
  /** 用于触发 fade-in 动画的 key —— 切换时内容变 → key 变 → 重新 fade */
  fadeKey?: string
}

export function ThinkBar({ mode, status, fadeKey }: ThinkBarProps) {
  if (mode === 'hidden') return null

  const isRequired = mode === 'required'

  return (
    <div
      data-testid="think-bar"
      data-mode={mode}
      data-hidden="false"
      className={[
        // wrapper (ThinkBarSlotFrame) 提供 sticky bottom;这里只关心视觉布局
        // 11g 原型配色:浅提升背景 + 顶部 brand 2px border
        'bg-bg-elevated border-t-2 border-brand',
        'flex items-center gap-3',
        'px-6 py-3',
        // 阴影(从原 .ai-think-bar 提取)
        'shadow-[0_-4px_12px_rgba(0,0,0,.04)]',
      ].join(' ')}
      aria-label="AI 思考条"
    >
      {isRequired ? (
        // required 模式:36px 圆形 + 脉冲 + 🤖
        <div
          data-testid="think-bar-pulse"
          className="relative w-9 h-9 rounded-full bg-brand-50 flex items-center justify-center before:content-[''] before:absolute before:inset-[-4px] before:rounded-full before:border-2 before:border-brand before:opacity-30 before:animate-pulse"
        >
          <span className="text-base" role="img" aria-label="AI">
            🤖
          </span>
        </div>
      ) : (
        // minimal 模式:8px 静态状态点
        <span
          data-testid="think-bar-dot"
          className="w-2 h-2 rounded-full bg-brand inline-block"
          aria-hidden
        />
      )}

      <div
        // key 触发 React unmount/mount,tailwindcss-animate 的 fade-in 提供 200ms 过渡
        key={fadeKey}
        className="flex-1 text-sm text-text-1 min-w-0 animate-in fade-in duration-200"
      >
        <strong data-testid="think-bar-title" className="text-brand-700">
          {status.title}
        </strong>
        <span data-testid="think-bar-sub" className="text-text-3 ml-2">
          {status.sub}
        </span>
      </div>

      {isRequired && (
        <div
          data-testid="think-bar-actions"
          className="flex items-center gap-2"
        >
          <button
            type="button"
            data-testid="think-bar-btn-detail"
            className="h-8 px-3 rounded-md text-sm text-text-1 hover:bg-bg-subtle"
          >
            查看详情
          </button>
          <button
            type="button"
            data-testid="think-bar-btn-pause"
            className="h-8 px-3 rounded-md text-sm bg-brand text-white hover:bg-brand-700"
          >
            ⏸ 暂停
          </button>
        </div>
      )}
    </div>
  )
}
