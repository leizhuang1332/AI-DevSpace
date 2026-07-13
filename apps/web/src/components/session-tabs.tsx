/**
 * ANALYZING 多会话 Tab 组件(ADR-0013 D7 · issue 19c VS3)
 *
 * 横向浏览器风格的 Tab 列表:
 * - 每个 Tab 显示 [数字徽章] + [icon] + [label] + [×关闭]
 * - active Tab 用 brand 紫色高亮 + 2px 下划线 + brand-50 背景
 * - 非 active Tab 灰文字 + hover 浅灰背景
 * - 末尾 [+ 新建会话] 按钮 → 弹小对话框(会话名 + angle 选择) → onCreate
 * - 最后一个 Tab 不可关闭(只剩 1 个 Tab 时 × 隐藏)
 *
 * 设计要点:
 * - 数据由 server 注入 props.sessions / props.activeId
 * - 切换 / 新建 / 关闭均通过回调向上抛,不直接操作 server(本 slice 仅 UI,后端落盘推迟到 VS5)
 * - 当前 active Tab 的渲染区分明显(brand-50 背景 + brand 文字 + 2px 下划线)
 * - 数字徽章 brand 紫底白字
 * - 关闭按钮:仅 Tab 数 > 1 时显示;非 active Tab 显示 ×;active Tab 也允许关闭(关闭后会自动切到邻居)
 *
 * 视觉参考:docs/design/pages/11h-A-zone-multisession-tabs.html "会话 Tab" 段
 */

'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ANALYSIS_SESSION_ANGLE_META,
  type AnalysisSession,
  type AnalysisSessionAngle,
} from '@/lib/analyzing'

export interface SessionTabsProps {
  sessions: AnalysisSession[]
  activeId: string
  onSwitch: (sessionId: string) => void
  /**
   * 创建新会话:组件只负责弹对话框 + 收输入,把 (label, angle) 抛给上层。
   * 上层(本 slice 为前端 mock)负责追加 sessions 并切换 active。
   */
  onCreate: (params: { label: string; angle: AnalysisSessionAngle }) => void
  /**
   * 关闭会话(本 slice 仅 UI,后端 chunks.jsonl 删除推迟到 VS5)。
   * 最后一个 Tab 不可关闭,故组件层就会拦截 onClose 调用,故 onClose 永远会收到
   * `sessions.length > 1` 的状态。
   */
  onClose: (sessionId: string) => void
}

/** Tab 单项渲染数据 */
interface TabViewModel extends AnalysisSession {
  icon: string
  closable: boolean
}

export function SessionTabs({
  sessions,
  activeId,
  onSwitch,
  onCreate,
  onClose,
}: SessionTabsProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const tabs: TabViewModel[] = sessions.map((s) => ({
    ...s,
    icon: ANALYSIS_SESSION_ANGLE_META[s.angle].icon,
    closable: sessions.length > 1,
  }))

  return (
    <div
      data-testid="session-tabs"
      className="flex items-center gap-0.5 px-6 bg-bg-elevated border-b border-border h-9"
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          onClick={() => onSwitch(tab.id)}
          onClose={() => onClose(tab.id)}
        />
      ))}
      <div className="flex-1" />
      <button
        type="button"
        data-testid="session-tab-create-btn"
        onClick={() => setCreateDialogOpen(true)}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium text-text-1 bg-bg-elevated border border-border hover:bg-bg-subtle"
      >
        + 新建
      </button>

      {createDialogOpen && (
        <CreateSessionDialog
          onCancel={() => setCreateDialogOpen(false)}
          onConfirm={(params) => {
            onCreate(params)
            setCreateDialogOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单 Tab
// ---------------------------------------------------------------------------

interface TabProps {
  tab: TabViewModel
  active: boolean
  onClick: () => void
  onClose: () => void
}

function Tab({ tab, active, onClick, onClose }: TabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="session-tab"
      data-session-id={tab.id}
      data-active={active ? 'true' : 'false'}
      data-angle={tab.angle}
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-semibold text-brand-700 bg-brand-50 border-b-2 border-brand cursor-pointer'
          : 'inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm text-text-2 hover:bg-bg-subtle border-b-2 border-transparent cursor-pointer'
      }
    >
      <span
        data-testid="session-tab-badge"
        className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-brand text-white"
      >
        {tab.detectedCount}
      </span>
      <span aria-hidden className="text-sm">
        {tab.icon}
      </span>
      <span data-testid="session-tab-label">{tab.label}</span>
      {tab.isStreaming && (
        <span
          data-testid="session-tab-streaming"
          aria-label="运行中"
          className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"
        />
      )}
      {tab.closable && (
        <button
          type="button"
          data-testid="session-tab-close"
          aria-label={`关闭 ${tab.label}`}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="ml-1 text-text-3 hover:text-error text-base leading-none w-4 h-4 inline-flex items-center justify-center rounded-sm"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 创建会话对话框
// ---------------------------------------------------------------------------

interface CreateSessionDialogProps {
  onCancel: () => void
  onConfirm: (params: { label: string; angle: AnalysisSessionAngle }) => void
}

const ANGLES: { value: AnalysisSessionAngle; label: string; icon: string }[] = (
  Object.entries(ANALYSIS_SESSION_ANGLE_META) as [AnalysisSessionAngle, { label: string; icon: string }][]
).map(([value, meta]) => ({
  value,
  label: meta.label,
  icon: meta.icon,
}))

function CreateSessionDialog({ onCancel, onConfirm }: CreateSessionDialogProps) {
  const [label, setLabel] = useState('')
  const [angle, setAngle] = useState<AnalysisSessionAngle>('custom')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = label.trim()
  const canSubmit = trimmed.length > 0

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm({ label: trimmed, angle })
  }

  return (
    <div
      data-testid="session-create-dialog"
      role="dialog"
      aria-label="新建会话"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-bg-elevated border border-border-strong rounded-lg shadow-xl px-5 py-4 w-[400px] flex flex-col gap-3"
      >
        <div className="text-base font-semibold text-text-1">新建分析会话</div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-text-2">会话名</span>
          <input
            ref={inputRef}
            type="text"
            data-testid="session-create-input"
            value={label}
            placeholder="例如:退款幂等 / 接口兼容..."
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel()
            }}
            className="h-9 px-3 rounded-md border border-border bg-bg text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs text-text-2">分析角度</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {ANGLES.map((a) => (
              <button
                key={a.value}
                type="button"
                data-testid={`session-create-angle-${a.value}`}
                data-angle={a.value}
                data-selected={angle === a.value ? 'true' : 'false'}
                onClick={() => setAngle(a.value)}
                className={
                  angle === a.value
                    ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium bg-brand-50 text-brand-700 border border-brand'
                    : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm text-text-1 bg-bg-elevated border border-border hover:bg-bg-subtle'
                }
              >
                <span aria-hidden>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            type="button"
            data-testid="session-create-cancel"
            onClick={onCancel}
            className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
          >
            取消
          </button>
          <button
            type="submit"
            data-testid="session-create-confirm"
            disabled={!canSubmit}
            className="h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            创建
          </button>
        </div>
      </form>
    </div>
  )
}