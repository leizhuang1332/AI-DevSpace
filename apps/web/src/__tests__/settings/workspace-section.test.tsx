import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { WorkspaceSection } from '@/app/(workspace)/settings/sections/workspace'
import type { WorkspaceInfo } from '@ai-devspace/shared'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return { ...actual, agentFetch: vi.fn() }
})

import * as agentClient from '@/lib/agent-client'
const agentFetchMock = agentClient.agentFetch as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const fakeInfo: WorkspaceInfo = {
  root: '/h/.aidevspace',
  configDir: '/h/.aidevspace',
  dataRoot: '/h/.aidevspace',
  exists: true,
  createdAt: 1000,
  subdirs: { requirements: true, repos: true, knowledge: true, skills: true, logs: true },
  configPath: '/h/.aidevspace/config.yaml',
  config: {},
  gitignorePath: '/h/.aidevspace/.gitignore',
  gitignoreExists: true,
  diskUsageBytes: 12_345_678,
}

beforeEach(() => agentFetchMock.mockReset())

describe('WorkspaceSection (slice baseline)', () => {
  it('展示数据目录根路径', () => {
    render(<WorkspaceSection info={fakeInfo} />, { wrapper: makeWrapper() })
    const input = screen.getByTestId('workspace-root') as HTMLInputElement
    expect(input.value).toBe('/h/.aidevspace')
    expect(input).toHaveAttribute('readonly')
  })

  it('展示配置目录(只读)', () => {
    render(<WorkspaceSection info={fakeInfo} />, { wrapper: makeWrapper() })
    const cfg = screen.getByTestId('workspace-configdir') as HTMLInputElement
    expect(cfg.value).toBe('/h/.aidevspace')
    expect(cfg).toHaveAttribute('readonly')
  })

  it('展示格式化的磁盘占用', () => {
    render(<WorkspaceSection info={fakeInfo} />, { wrapper: makeWrapper() })
    const usage = screen.getByTestId('disk-usage')
    expect(usage.textContent).toMatch(/11\.8 MB/)
  })

  it('点击"在文件管理器打开"调用 /api/workspace/open（忽略 501 错误）', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(501, { error: 'not_implemented' }),
    )
    render(<WorkspaceSection info={fakeInfo} />, { wrapper: makeWrapper() })
    fireEvent.click(screen.getByTestId('open-workspace-btn'))
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/open',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })
})