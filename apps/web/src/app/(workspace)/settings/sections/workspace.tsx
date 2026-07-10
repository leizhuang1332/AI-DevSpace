'use client'

import type { WorkspaceInfo } from '@ai-devspace/shared'
import { agentFetch } from '@/lib/agent-client'

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

export function WorkspaceSection({ info }: WorkspaceSectionProps) {
  async function handleOpen() {
    try {
      await agentFetch('/api/workspace/open', { method: 'POST', body: '{}' })
    } catch {
      // 占位端点；本期不实际打开
    }
  }

  return (
    <section
      data-testid="section-workspace"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">工作空间</h2>
      <div className="text-sm text-text-3 mb-4">~/.aidevspace/ 目录的物理位置</div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div className="text-sm font-medium text-text-1">工作空间根</div>
        <input
          readOnly
          value={info.root}
          data-testid="workspace-root"
          className="w-full max-w-[520px] px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none font-mono"
        />
      </div>

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
