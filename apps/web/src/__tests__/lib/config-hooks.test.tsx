import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WorkspaceInfo } from '@ai-devspace/shared'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return {
    ...actual,
    agentFetch: vi.fn(),
  }
})

import { useWorkspace, useUpdateConfig } from '@/lib/config-hooks'
import * as agentClient from '@/lib/agent-client'

const agentFetchMock = agentClient.agentFetch as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  }
}

const fakeInfo: WorkspaceInfo = {
  root: '/h/.aidevspace',
  exists: true,
  createdAt: 1000,
  subdirs: { requirements: true, repos: true, knowledge: true, skills: true, logs: true },
  configPath: '/h/.aidevspace/config.yaml',
  config: { theme: 'system', typewriterSpeed: 'medium', 'ai.provider': 'claude-code' },
  gitignorePath: '/h/.aidevspace/.gitignore',
  gitignoreExists: true,
  diskUsageBytes: 0,
}

beforeEach(() => {
  agentFetchMock.mockReset()
})

describe('slice 16: useWorkspace', () => {
  it('fetch /api/workspace 成功后返回 data', async () => {
    agentFetchMock.mockResolvedValueOnce(fakeInfo)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(fakeInfo)
    expect(agentFetchMock).toHaveBeenCalledWith('/api/workspace')
  })

  it('fetch 失败时 isError + error', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(500, { error: 'internal' }),
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useWorkspace(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as agentClient.AgentError).status).toBe(500)
  })
})

describe('slice 17: useUpdateConfig', () => {
  it('调用 PATCH /api/workspace/config 成功后更新 cache 中的 config', async () => {
    agentFetchMock.mockResolvedValueOnce({
      ok: true,
      config: { ...fakeInfo.config, theme: 'dark' },
    })

    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(['workspace'], fakeInfo)

    const { result } = renderHook(() => useUpdateConfig(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ theme: 'dark' })
    })

    const cached = qc.getQueryData<WorkspaceInfo>(['workspace'])
    expect(cached?.config.theme).toBe('dark')

    expect(agentFetchMock).toHaveBeenCalledWith(
      '/api/workspace/config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ theme: 'dark' }),
      }),
    )
  })

  it('mutation 失败时不更新 cache', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(400, { error: 'invalid_patch' }),
    )
    const { wrapper, qc } = makeWrapper()
    qc.setQueryData(['workspace'], fakeInfo)

    const { result } = renderHook(() => useUpdateConfig(), { wrapper })

    await act(async () => {
      await result.current
        .mutateAsync({ theme: 'BAD' as unknown as 'system' })
        .catch(() => {})
    })

    const cached = qc.getQueryData<WorkspaceInfo>(['workspace'])
    expect(cached?.config.theme).toBe('system')
  })
})
