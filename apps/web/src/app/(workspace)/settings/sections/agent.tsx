'use client'

import { useQuery } from '@tanstack/react-query'
import type { Config } from '@ai-devspace/shared'
import { agentFetch } from '@/lib/agent-client'

export interface AgentSectionProps {
  config: Config
}

interface AgentHealth {
  ok: boolean
  name?: string
  workspaceRoot?: string
}

export function AgentSection({ config }: AgentSectionProps) {
  const health = useQuery({
    queryKey: ['agent', 'health'],
    queryFn: () => agentFetch<AgentHealth>('/api/health'),
    staleTime: 10_000,
  })

  const endpoint = (config.agentEndpoint as string) ?? 'http://localhost:7777'

  return (
    <section
      data-testid="section-agent"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">Agent 连接</h2>
      <div className="text-sm text-text-3 mb-4">Web 工作台 ↔ 本地 Agent 守护进程</div>

      <div
        className="flex items-center gap-3 p-3 bg-[#dcfce7] rounded-md text-sm text-[#166534] mb-4"
        data-testid="agent-status"
      >
        <span
          className={`w-2 h-2 rounded-full ${
            health.isError ? 'bg-error' : health.isLoading ? 'bg-warning' : 'bg-success'
          } animate-pulse`}
        />
        <div>
          <strong>
            {health.isError ? '已断开' : health.isLoading ? '检测中…' : '已连接'}
          </strong>
          {' · '}Agent 端口 <code className="font-mono bg-white px-1.5 py-0.5 rounded-sm text-[#166534]">
            7777
          </code>
          {' · '}{' '}
          工作空间根{' '}
          <code className="font-mono bg-white px-1.5 py-0.5 rounded-sm text-[#166534]">
            {health.data?.workspaceRoot ?? '—'}
          </code>
        </div>
        <span className="flex-1" />
        <span className="h-6 px-2.5 rounded-md bg-white border border-[#86efac] text-[#166534] text-xs flex items-center font-medium">
          ●{' '}
          {health.isError ? '离线' : health.isLoading ? '探测' : '健康'}
        </span>
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div className="text-sm font-medium text-text-1">Agent 端点</div>
        <input
          readOnly
          value={endpoint}
          data-testid="agent-endpoint"
          className="w-full max-w-[520px] px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none focus:border-brand-500 focus:bg-bg-elevated font-mono"
        />
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div>
          <div className="text-sm font-medium text-text-1">鉴权 Token</div>
          <div className="text-xs text-text-3 mt-0.5">写入 ~/.aidevspace/config.yaml</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            disabled
            value="••••••••••••••••"
            data-testid="agent-token"
            className="w-full max-w-[280px] px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none font-mono"
          />
          <button
            disabled
            className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
            title="issue 03 接入后启用"
          >
            重置
          </button>
        </div>
      </div>
    </section>
  )
}
