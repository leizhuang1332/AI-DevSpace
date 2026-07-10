'use client'

import { useState } from 'react'
import { useWorkspace, useUpdateConfig } from '@/lib/config-hooks'
import { AppearanceSection } from './sections/appearance'
import { AiExperienceSection } from './sections/ai-experience'
import { WorkspaceSection } from './sections/workspace'
import { AgentSection } from './sections/agent'
import { DangerSection } from './sections/danger'
import type { ConfigPatch } from '@ai-devspace/shared'

const SECTIONS = [
  { key: 'appearance', label: '🎨 外观' },
  { key: 'ai', label: '🤖 AI 体验' },
  { key: 'workspace', label: '📂 工作空间' },
  { key: 'agent', label: '🔌 Agent 连接' },
  { key: 'danger', label: '⚠️ 高级 · 重置' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

const SECTION_TITLES: Record<SectionKey, string> = {
  appearance: '外观',
  ai: 'AI 体验',
  workspace: '工作空间',
  agent: 'Agent 连接',
  danger: '高级 · 重置',
}

export function SettingsShell() {
  const ws = useWorkspace()
  const mut = useUpdateConfig()
  const [active, setActive] = useState<SectionKey>('appearance')

  if (ws.isLoading) {
    return (
      <div className="grid grid-cols-[240px_1fr] min-h-[calc(100vh-72px)]">
        <aside className="bg-bg-elevated border-r border-border p-4" />
        <main className="p-6 lg:p-8 overflow-auto max-w-[920px]" data-testid="settings-loading">
          <div className="space-y-3">
            <div className="h-8 w-32 bg-bg-subtle rounded animate-pulse" />
            <div className="h-32 bg-bg-subtle rounded-lg animate-pulse" />
            <div className="h-32 bg-bg-subtle rounded-lg animate-pulse" />
          </div>
        </main>
      </div>
    )
  }

  if (ws.isError) {
    return (
      <div className="p-8 max-w-[920px]" data-testid="settings-error">
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-md p-4 text-sm text-error">
          <strong>加载失败</strong>
          <div className="mt-1 text-xs">{(ws.error as Error)?.message}</div>
          <button
            onClick={() => ws.refetch()}
            className="mt-3 h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  const info = ws.data!

  async function patch(p: ConfigPatch) {
    try {
      await mut.mutateAsync(p)
    } catch {
      // 失败时 react-query 已处理错误状态
    }
  }

  const busy = mut.isPending

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-[calc(100vh-72px)]">
      <aside className="bg-bg-elevated border-r border-border p-4 overflow-auto">
        <h3 className="text-[11px] text-text-3 uppercase tracking-wider font-medium px-2 mb-2">
          设置
        </h3>
        {SECTIONS.map((s) => {
          const isActive = s.key === active
          return (
            <div
              key={s.key}
              data-testid={`nav-${s.key}`}
              onClick={() => setActive(s.key)}
              className={`px-3 py-1.5 rounded-sm text-sm cursor-pointer mb-0.5 ${
                isActive
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'
              }`}
            >
              {s.label}
            </div>
          )
        })}
      </aside>

      <main className="p-6 lg:p-8 overflow-auto max-w-[920px]" data-testid="settings-main">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold" data-testid="settings-title">
            {SECTION_TITLES[active]}
          </h1>
          <div className="text-text-2 text-md mt-1">
            {active === 'workspace' && '查看工作空间物理位置'}
            {active === 'agent' && '查看与本机 Agent 守护进程的连接状态'}
            {active === 'danger' && '备份、迁移、卸载'}
            {(active === 'appearance' || active === 'ai') && '所有改动写入 ~/.aidevspace/config.yaml'}
          </div>
        </div>

        {active === 'appearance' && (
          <AppearanceSection config={info.config} onPatch={patch} busy={busy} />
        )}
        {active === 'ai' && (
          <AiExperienceSection config={info.config} onPatch={patch} busy={busy} />
        )}
        {active === 'workspace' && <WorkspaceSection info={info} />}
        {active === 'agent' && <AgentSection config={info.config} />}
        {active === 'danger' && <DangerSection workspaceRoot={info.root} />}

        {mut.isError && (
          <div
            data-testid="settings-save-error"
            className="mt-3 p-2 bg-[#fef2f2] border border-[#fecaca] rounded-md text-sm text-error"
          >
            保存失败：{(mut.error as Error)?.message}
          </div>
        )}
      </main>
    </div>
  )
}
