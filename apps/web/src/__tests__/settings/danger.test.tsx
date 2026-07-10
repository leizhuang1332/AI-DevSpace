import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DangerSection } from '@/app/(workspace)/settings/sections/danger'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return { ...actual, agentFetch: vi.fn() }
})

import * as agentClient from '@/lib/agent-client'
const agentFetchMock = agentClient.agentFetch as ReturnType<typeof vi.fn>

beforeEach(() => agentFetchMock.mockReset())

describe('DangerSection', () => {
  it('默认显示"卸载 AI DevSpace"按钮 + 显示当前路径', () => {
    render(<DangerSection workspaceRoot="/h/.aidevspace" />)
    expect(screen.getByTestId('uninstall-btn')).toBeInTheDocument()
    expect(screen.getByText(/\/h\/\.aidevspace/)).toBeInTheDocument()
  })

  it('点卸载 → 显示确认条', () => {
    render(<DangerSection workspaceRoot="/h/.aidevspace" />)
    fireEvent.click(screen.getByTestId('uninstall-btn'))
    expect(screen.getByTestId('uninstall-confirm')).toBeInTheDocument()
  })

  it('点取消 → 回到初始态', () => {
    render(<DangerSection workspaceRoot="/h/.aidevspace" />)
    fireEvent.click(screen.getByTestId('uninstall-btn'))
    fireEvent.click(screen.getByTestId('uninstall-cancel'))
    expect(screen.queryByTestId('uninstall-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('uninstall-btn')).toBeInTheDocument()
  })

  it('点确认卸载 → 调用 /api/workspace/uninstall + 显示 toast（501 也展示开发中文案）', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(501, { error: 'not_implemented' }),
    )
    render(<DangerSection workspaceRoot="/h/.aidevspace" />)
    fireEvent.click(screen.getByTestId('uninstall-btn'))
    fireEvent.click(screen.getByTestId('uninstall-confirm-btn'))
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/uninstall',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() => expect(screen.getByTestId('danger-toast')).toBeInTheDocument())
    expect(screen.getByTestId('danger-toast').textContent).toMatch(/开发中/)
  })
})
