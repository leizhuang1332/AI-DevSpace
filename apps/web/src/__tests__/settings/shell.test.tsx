import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WorkspaceInfo } from '@ai-devspace/shared'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return { ...actual, agentFetch: vi.fn() }
})

import * as agentClient from '@/lib/agent-client'
const agentFetchMock = agentClient.agentFetch as ReturnType<typeof vi.fn>

import { SettingsShell } from '@/app/(workspace)/settings/settings-shell'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
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
  config: { theme: 'system', typewriterSpeed: 'medium', silentWindowSeconds: 30, 'ai.provider': 'claude-code' },
  gitignorePath: '/h/.aidevspace/.gitignore',
  gitignoreExists: true,
  diskUsageBytes: 0,
}

beforeEach(() => agentFetchMock.mockReset())

describe('SettingsShell', () => {
  it('加载中显示骨架', async () => {
    agentFetchMock.mockReturnValueOnce(new Promise(() => {})) // never resolves
    const { wrapper } = makeWrapper()
    render(<SettingsShell />, { wrapper })
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument()
  })

  it('加载失败显示错误态 + 重试按钮', async () => {
    agentFetchMock.mockRejectedValueOnce(new agentClient.AgentError(500, { error: 'x' }))
    const { wrapper } = makeWrapper()
    render(<SettingsShell />, { wrapper })
    await waitFor(() => expect(screen.getByTestId('settings-error')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('加载成功后默认显示外观 section', async () => {
    agentFetchMock.mockResolvedValueOnce(fakeInfo)
    const { wrapper } = makeWrapper()
    render(<SettingsShell />, { wrapper })
    await waitFor(() => expect(screen.getByTestId('settings-main')).toBeInTheDocument())
    expect(screen.getByTestId('settings-title').textContent).toBe('外观')
    expect(screen.getByTestId('section-appearance')).toBeInTheDocument()
  })

  it('点侧导航切换 section', async () => {
    agentFetchMock
      .mockResolvedValueOnce(fakeInfo) // initial GET workspace
      .mockResolvedValueOnce({ ok: true, name: 'agent', workspaceRoot: '/h/.aidevspace' }) // AgentSection GET /api/health
    const { wrapper } = makeWrapper()
    render(<SettingsShell />, { wrapper })
    await waitFor(() => expect(screen.getByTestId('settings-main')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('nav-workspace'))
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('nav-agent'))
    expect(screen.getByTestId('section-agent')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('nav-danger'))
    expect(screen.getByTestId('section-danger')).toBeInTheDocument()
  })

  it('在 appearance 改动 theme 触发 PATCH', async () => {
    agentFetchMock
      .mockResolvedValueOnce(fakeInfo) // initial GET
      .mockResolvedValueOnce({ ok: true, config: { ...fakeInfo.config, theme: 'dark' } })

    const { wrapper } = makeWrapper()
    render(<SettingsShell />, { wrapper })
    await waitFor(() => expect(screen.getByTestId('section-appearance')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('radio', { name: '暗色' }))

    await waitFor(() => {
      const patchCall = agentFetchMock.mock.calls.find((c) => c[0] === '/api/workspace/config')
      expect(patchCall).toBeTruthy()
      expect(JSON.parse(patchCall![1]?.body as string)).toEqual({ theme: 'dark' })
    })
  })
})
