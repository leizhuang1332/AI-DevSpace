import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Config } from '@ai-devspace/shared'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return { ...actual, agentFetch: vi.fn() }
})

import * as agentClient from '@/lib/agent-client'
import { AgentSection } from '@/app/(workspace)/settings/sections/agent'
const agentFetchMock = agentClient.agentFetch as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  }
}

const baseConfig: Config = { agentEndpoint: 'http://localhost:7777' }

beforeEach(() => agentFetchMock.mockReset())

describe('AgentSection', () => {
  it('加载中显示检测中', () => {
    agentFetchMock.mockReturnValueOnce(new Promise(() => {}))
    const { wrapper } = makeWrapper()
    render(<AgentSection config={baseConfig} />, { wrapper })
    expect(screen.getByTestId('agent-status').textContent).toMatch(/检测中/)
  })

  it('健康时显示已连接 + workspaceRoot', async () => {
    agentFetchMock.mockResolvedValueOnce({
      ok: true,
      name: 'agent',
      workspaceRoot: '/h/.aidevspace',
    })
    const { wrapper } = makeWrapper()
    render(<AgentSection config={baseConfig} />, { wrapper })
    await waitFor(() =>
      expect(screen.getByTestId('agent-status').textContent).toMatch(/已连接/),
    )
    expect(screen.getByTestId('agent-status').textContent).toMatch(/\/h\/\.aidevspace/)
  })

  it('失败时显示已断开', async () => {
    agentFetchMock.mockRejectedValueOnce(new Error('network'))
    const { wrapper } = makeWrapper()
    render(<AgentSection config={baseConfig} />, { wrapper })
    await waitFor(() =>
      expect(screen.getByTestId('agent-status').textContent).toMatch(/已断开/),
    )
  })

  it('展示 agentEndpoint', () => {
    agentFetchMock.mockReturnValueOnce(new Promise(() => {}))
    const { wrapper } = makeWrapper()
    render(<AgentSection config={{ agentEndpoint: 'http://example:9999' }} />, { wrapper })
    expect(screen.getByTestId('agent-endpoint')).toHaveValue('http://example:9999')
  })
})
