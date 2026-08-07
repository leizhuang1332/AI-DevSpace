'use client'

/**
 * board NewTaskModal(manual 创建)— issue 07 / ADR-0027 D3
 *
 * 表单字段:
 * - title(必填)
 * - content(textarea,Markdown)
 * - priority(4 选 1 + 无,默认无)
 * - status(5 选 1,默认 backlog;由列头 `+` 触发时可预填)
 * - assignee(可选,user id 字符串)
 * - labels(逗号分隔 → 数组)
 *
 * 提交 → `useCreateBoardCard` mutation;成功后 onClose。
 * 不触发 Run(守门 zero-touch)。
 *
 * 后端强制 `source='manual'` + `parent_id=reqId`,客户端不传这两个字段。
 */

import { useState, useEffect } from 'react'
import type { TaskCardPriorityT, TaskCardStatusT } from '@ai-devspace/shared'
import { useCreateBoardCard } from '@/lib/board-hooks'
import { STATUS_COLUMN_ORDER, STATUS_COLUMNS } from '@/lib/board'

export interface NewTaskModalProps {
  requirementId: string
  open: boolean
  onClose: () => void
  /** 预填 status(列头 `+` 触发时传入该列 status) */
  defaultStatus?: TaskCardStatusT
}

const PRIORITY_OPTIONS: Array<TaskCardPriorityT | 'none'> = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
]

export function NewTaskModal({
  requirementId,
  open,
  onClose,
  defaultStatus = 'backlog',
}: NewTaskModalProps) {
  const createMutation = useCreateBoardCard(requirementId)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<TaskCardPriorityT | 'none'>('none')
  const [status, setStatus] = useState<TaskCardStatusT>(defaultStatus)
  const [assignee, setAssignee] = useState('')
  const [labels, setLabels] = useState('')

  // 每次打开重置表单 + 应用 defaultStatus
  useEffect(() => {
    if (open) {
      setTitle('')
      setContent('')
      setPriority('none')
      setStatus(defaultStatus)
      setAssignee('')
      setLabels('')
    }
  }, [open, defaultStatus])

  if (!open) return null

  const canSubmit = title.trim().length > 0 && !createMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    createMutation.mutate(
      {
        title: title.trim(),
        content: content,
        status,
        priority: priority === 'none' ? null : priority,
        assignee: assignee.trim() === '' ? null : assignee.trim(),
        labels: labels
          .split(',')
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
      },
      {
        onSuccess: () => {
          onClose()
        },
      },
    )
  }

  return (
    <div
      data-testid="board-new-task-modal"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        data-testid="board-new-task-modal-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-1">新建任务</h2>
            <button
              type="button"
              data-testid="board-new-task-modal-close"
              onClick={onClose}
              className="text-text-3 hover:text-text-1 text-lg leading-none"
              aria-label="关闭"
            >
              ✕
            </button>
          </header>

          {/* title */}
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">标题 *</span>
            <input
              type="text"
              data-testid="board-new-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder="任务标题"
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
            />
          </label>

          {/* content */}
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">内容(Markdown)</span>
            <textarea
              data-testid="board-new-task-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="任务详细描述…"
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand resize-y"
            />
          </label>

          {/* priority + status */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-text-2">优先级</span>
              <select
                data-testid="board-new-task-priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as TaskCardPriorityT | 'none')
                }
                className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p === 'none' ? '无' : p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-text-2">状态</span>
              <select
                data-testid="board-new-task-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskCardStatusT)}
                className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
              >
                {STATUS_COLUMN_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_COLUMNS[s].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* assignee + labels */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-text-2">负责人</span>
              <input
                type="text"
                data-testid="board-new-task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="user id(可选)"
                className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-text-2">标签(逗号分隔)</span>
              <input
                type="text"
                data-testid="board-new-task-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                placeholder="security, backend"
                className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand"
              />
            </label>
          </div>

          {/* 错误提示 */}
          {createMutation.isError && (
            <div
              data-testid="board-new-task-error"
              className="text-sm text-error bg-error/10 px-3 py-2 rounded-md"
            >
              创建失败:{String(createMutation.error ?? '未知错误')}
            </div>
          )}

          {/* 操作 */}
          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="board-new-task-cancel"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="board-new-task-submit"
              disabled={!canSubmit}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? '创建中…' : '创建'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
