'use client'

/**
 * 辅助文件空态占位卡(issue 04 验收 #7)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.add-card` 区域
 *
 * 当 Requirement 的 `auxFiles` 列表为空时,辅助文件面板显示这张虚线卡片,
 * 而不是一片空白;点击 → 唤起"新建/上传"动作(issue 06 接入)。
 *
 * 行为:
 * - 单卡占满网格的最小列宽(180px minmax);视觉上仍保持"卡片形态"一致性
 * - 点击 / 键盘 Enter → 调用 `onCreate()`
 * - hover:边框由 dashed-strong 变 brand,文字由 text-3 变 brand-600
 */

export interface EmptyAuxPlaceholderProps {
  /** 点击占位卡时回调;不传则禁用 hover/click 视觉反馈 */
  onCreate?: () => void
}

export function EmptyAuxPlaceholder({
  onCreate,
}: EmptyAuxPlaceholderProps) {
  const handleClick = () => {
    onCreate?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onCreate) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCreate()
    }
  }

  return (
    <div
      data-testid="aux-empty-placeholder"
      role={onCreate ? 'button' : undefined}
      tabIndex={onCreate ? 0 : -1}
      aria-label="新建或上传辅助文件"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'flex flex-col items-center justify-center gap-1 min-h-[90px] p-3',
        'border border-dashed border-border-strong rounded-lg',
        'bg-transparent text-text-3 text-sm',
        onCreate &&
          'cursor-pointer transition-[border-color,color,background-color] duration-150',
        onCreate && 'hover:border-brand hover:text-brand-600 hover:bg-brand-50',
        onCreate && 'focus:outline-none focus:ring-2 focus:ring-brand-50',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="text-lg leading-none" aria-hidden>
        ＋
      </span>
      <span data-testid="aux-empty-placeholder-label" className="text-xs">
        新建/上传
      </span>
    </div>
  )
}