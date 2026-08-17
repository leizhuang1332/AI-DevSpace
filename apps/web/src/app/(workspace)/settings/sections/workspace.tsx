'use client'

import { useEffect, useRef, useState } from 'react'
import type { WorkspaceInfo } from '@ai-devspace/shared'
import { AgentError, agentFetch } from '@/lib/agent-client'
import {
  useRestartAgent,
  useUpdateConfig,
  useValidateWorkspaceRoot,
} from '@/lib/config-hooks'

export interface WorkspaceSectionProps {
  info: WorkspaceInfo
  onAfterAction?: () => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * 三档校验色码 —— 与 agent 端 validate-path 端点的 errorCode 一一对应:
 *  - null: 未校验 / 校验中(无边框色,默认)
 *  - 'green': 通过(路径存在 + 是 workspace)
 *  - 'yellow': E_WS_ROOT_PATH_NOT_WORKSPACE(路径存在但非 workspace)
 *  - 'red': E_WS_ROOT_PATH_NOT_EXISTS(路径不存在)
 */
type ValidationState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'valid' }
  | { kind: 'not-workspace'; message: string }
  | { kind: 'not-exists'; message: string }

function borderClass(state: ValidationState): string {
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return 'border-border-strong'
    case 'valid':
      return 'border-green-500'
    case 'not-workspace':
      return 'border-yellow-500'
    case 'not-exists':
      return 'border-red-500'
  }
}

function messageFor(state: ValidationState): string | null {
  switch (state.kind) {
    case 'idle':
    case 'checking':
    case 'valid':
      return null
    case 'not-workspace':
      return state.message
    case 'not-exists':
      return state.message
  }
}

export function WorkspaceSection({ info, onAfterAction }: WorkspaceSectionProps) {
  // 当前生效 root(来自 WorkspaceInfo)—— 保存前显示这个;保存后立刻刷新
  const [mode, setMode] = useState<'readonly' | 'editing' | 'saved'>('readonly')
  const [draft, setDraft] = useState<string>(info.dataRoot)
  const [validation, setValidation] = useState<ValidationState>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const validate = useValidateWorkspaceRoot()
  const update = useUpdateConfig()
  const restart = useRestartAgent()

  // 编辑 mode 自动 focus + 全选
  useEffect(() => {
    if (mode === 'editing' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [mode])

  // 离开 editing 模式时清掉 debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function startEditing() {
    setDraft(info.dataRoot)
    setValidation({ kind: 'idle' })
    setMode('editing')
  }

  function cancelEditing() {
    setDraft(info.dataRoot)
    setValidation({ kind: 'idle' })
    setMode('readonly')
  }

  function onDraftChange(v: string) {
    setDraft(v)
    setValidation({ kind: 'checking' })
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runValidate(v), 300)
  }

  async function runValidate(path: string) {
    if (!path.trim()) {
      setValidation({ kind: 'idle' })
      return
    }
    try {
      const r = await validate.mutateAsync(path)
      setValidation(
        r.exists && r.isWorkspace ? { kind: 'valid' } : { kind: 'idle' },
      )
    } catch (err) {
      const e = err as AgentError & {
        errorCode?: string
        message?: string
      }
      const body = e.body as
        | {
            error?: string
            message?: string
          }
        | undefined
      const code = body?.error ?? e.errorCode
      const message = body?.message ?? e.message ?? '路径无效'
      if (code === 'E_WS_ROOT_PATH_NOT_EXISTS') {
        setValidation({ kind: 'not-exists', message })
      } else if (code === 'E_WS_ROOT_PATH_NOT_WORKSPACE') {
        setValidation({ kind: 'not-workspace', message })
      } else {
        setValidation({ kind: 'not-exists', message })
      }
    }
  }

  async function save() {
    if (validation.kind !== 'valid') return
    try {
      await update.mutateAsync({ workspaceRoot: draft })
      setMode('saved')
      onAfterAction?.()
    } catch {
      setMode('readonly')
    }
  }

  async function handleOpen() {
    try {
      await agentFetch('/api/workspace/open', { method: 'POST', body: '{}' })
    } catch {
      // 占位端点；本期不实际打开
    }
  }

  async function handleRestart() {
    try {
      await restart.mutateAsync('workspaceRoot-changed')
      setMode('readonly')
    } catch {
      // 失败提示留给上层
    }
  }

  return (
    <section
      data-testid="section-workspace"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">工作空间</h2>
      <div className="text-sm text-text-3 mb-4">
        配置目录 ~/.aidevspace/(永远存 config.yaml)与数据目录(requirements / knowledge / skills / analysis-skills)。
        改 root 不影响现有数据,新数据写入新位置;重启 Agent 后生效。
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div className="text-sm font-medium text-text-1">配置目录 (configDir)</div>
        <input
          readOnly
          value={info.configDir}
          data-testid="workspace-configdir"
          className="w-full max-w-[520px] px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none font-mono"
        />
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div className="text-sm font-medium text-text-1">数据目录 (dataRoot)</div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            readOnly={mode !== 'editing'}
            value={mode === 'saved' ? draft : mode === 'editing' ? draft : info.dataRoot}
            onChange={(e) => onDraftChange(e.target.value)}
            data-testid="workspace-root"
            className={`w-full max-w-[520px] px-3 py-2 bg-bg-subtle border ${borderClass(validation)} rounded-md text-md text-text-1 outline-none font-mono`}
          />
          {mode === 'readonly' && (
            <button
              onClick={startEditing}
              data-testid="edit-workspace-root"
              className="h-8 px-2 bg-bg-elevated border border-border-strong rounded-md text-sm"
              aria-label="编辑数据目录"
            >
              ✏️
            </button>
          )}
          {mode === 'editing' && (
            <>
              <button
                onClick={save}
                disabled={validation.kind !== 'valid' || update.isPending}
                data-testid="save-workspace-root"
                className="h-8 px-3 bg-blue-600 text-white rounded-md text-sm disabled:opacity-40"
              >
                {update.isPending ? '保存中…' : '保存'}
              </button>
              <button
                onClick={cancelEditing}
                data-testid="cancel-workspace-root"
                className="h-8 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm"
              >
                取消
              </button>
            </>
          )}
        </div>
        {messageFor(validation) && (
          <div
            className="text-xs text-text-2 max-w-[520px]"
            data-testid="workspace-validation-message"
          >
            {messageFor(validation)}
          </div>
        )}
      </div>

      {mode === 'saved' && (
        <div
          data-testid="saved-banner"
          className="my-3 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-900 flex items-center gap-3"
        >
          <span>✓ 已保存 · 新路径需重启 Agent 后生效</span>
          <button
            onClick={handleRestart}
            disabled={restart.isPending}
            data-testid="restart-agent-btn"
            className="h-7 px-3 bg-green-600 text-white rounded-md text-xs font-medium disabled:opacity-40"
          >
            {restart.isPending ? '重启中…' : '↻ 重启 Agent'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div className="text-sm font-medium text-text-1">磁盘占用</div>
        <div className="text-sm text-text-2" data-testid="disk-usage">
          <strong>{formatBytes(info.diskUsageBytes)}</strong>
          <span className="text-text-3 ml-2">
            （{info.subdirs.requirements ? '✓' : '·'} requirements ·{' '}
            {info.subdirs.repos ? '✓' : '·'} repos ·{' '}
            {info.subdirs.knowledge ? '✓' : '·'} knowledge ·{' '}
            {info.subdirs.skills ? '✓' : '·'} skills ·{' '}
            {info.subdirs.logs ? '✓' : '·'} logs）
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div />
        <button
          onClick={handleOpen}
          data-testid="open-workspace-btn"
          className="h-8 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium self-start"
        >
          📂 在文件管理器打开
        </button>
      </div>
    </section>
  )
}