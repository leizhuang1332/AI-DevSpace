'use client'

import { useState } from 'react'
import { agentFetch } from '@/lib/agent-client'

export interface DangerSectionProps {
  workspaceRoot: string
}

export function DangerSection({ workspaceRoot }: DangerSectionProps) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function handleUninstall() {
    setPending(true)
    try {
      await agentFetch<{ ok: true }>('/api/workspace/uninstall', {
        method: 'POST',
        body: '{}',
      })
      setToast('卸载功能开发中（issue 后续实现）')
    } catch (err) {
      // 501 = 占位端点尚未实现
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 501) {
        setToast('卸载功能开发中（issue 后续实现）')
      } else {
        setToast('卸载请求失败')
      }
    } finally {
      setPending(false)
      setConfirming(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  return (
    <section
      data-testid="section-danger"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">危险操作</h2>
      <div className="text-sm text-text-3 mb-4">备份、迁移、卸载</div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div>
          <div className="text-sm font-medium text-text-1">打包工作空间</div>
          <div className="text-xs text-text-3 mt-0.5">生成 aidevspace-backup-YYYYMMDD.tar.gz</div>
        </div>
        <button
          disabled
          className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
          title="后续 issue"
        >
          ⤓ 下载备份
        </button>
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div>
          <div className="text-sm font-medium text-text-1">完全卸载</div>
          <div className="text-xs text-text-3 mt-0.5 font-mono break-all">
            删除 {workspaceRoot} + 停止 Agent 进程
          </div>
        </div>
        {!confirming ? (
          <button
            data-testid="uninstall-btn"
            onClick={() => setConfirming(true)}
            className="h-7 px-3 bg-[#fef2f2] text-error border border-[#fecaca] rounded-md text-sm font-medium self-start"
          >
            卸载 AI DevSpace
          </button>
        ) : (
          <div
            data-testid="uninstall-confirm"
            className="flex items-center gap-2 p-2 bg-[#fef2f2] border border-[#fecaca] rounded-md"
          >
            <span className="text-sm text-error">确认删除整个工作空间？</span>
            <button
              data-testid="uninstall-cancel"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm"
            >
              取消
            </button>
            <button
              data-testid="uninstall-confirm-btn"
              onClick={handleUninstall}
              disabled={pending}
              className="h-7 px-3 bg-error text-white rounded-md text-sm font-medium"
            >
              {pending ? '卸载中…' : '确认卸载'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div
          data-testid="danger-toast"
          className="mt-3 p-2 bg-[#fff7ed] border border-[#fed7aa] rounded-md text-sm text-[#9a3412]"
        >
          {toast}
        </div>
      )}
    </section>
  )
}
