/**
 * WorkspaceSection 行内编辑 v2 (ADR-0037 D5)
 *
 * 12 case:
 *  1.  默认 readOnly(input readonly + ✏️ 按钮显示)
 *  2.  configDir readOnly input 始终显示
 *  3.  hover 点击 ✏️ → 进入 editing 模式(✏️ 消失,出现 保存/取消)
 *  4.  editing 模式下 input 自动 focus + 全选
 *  5.  输入新路径 → debounce 300ms → 调 validate hook 一次
 *  6.  validate 返 valid → 边框绿 + 保存按钮启用
 *  7.  validate 抛 E_WS_ROOT_PATH_NOT_WORKSPACE → 边框黄 + 错误文案
 *  8.  validate 抛 E_WS_ROOT_PATH_NOT_EXISTS → 边框红 + 错误文案
 *  9.  点保存(合法)→ PATCH /api/workspace/config + 切 saved + banner 出现
 *  10. banner 上的「↻ 重启 Agent」按钮 → POST /api/agent/restart
 *  11. 点取消 → 回滚到 info.dataRoot + 切回 readonly
 *  12. 保存失败 → 回滚 + 切回 readonly(不显示 banner)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WorkspaceInfo } from '@ai-devspace/shared'

vi.mock('@/lib/agent-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-client')>('@/lib/agent-client')
  return { ...actual, agentFetch: vi.fn() }
})

import * as agentClient from '@/lib/agent-client'
import { WorkspaceSection } from '@/app/(workspace)/settings/sections/workspace'
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

beforeEach(() => {
  agentFetchMock.mockReset()
  vi.useRealTimers()
})

describe('WorkspaceSection 行内编辑 v2 (ADR-0037 D5)', () => {
  it('case 1: 默认 readOnly — input readonly + ✏️ 按钮显示', () => {
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    const input = screen.getByTestId('workspace-root') as HTMLInputElement
    expect(input).toHaveAttribute('readonly')
    expect(input.value).toBe('/h/.aidevspace')
    expect(screen.getByTestId('edit-workspace-root')).toBeInTheDocument()
  })

  it('case 2: configDir readOnly input 始终显示 + 不可编辑', () => {
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    const cfg = screen.getByTestId('workspace-configdir') as HTMLInputElement
    expect(cfg).toHaveAttribute('readonly')
    expect(cfg.value).toBe('/h/.aidevspace')
  })

  it('case 3: 点击 ✏️ → 进入 editing 模式,出现保存/取消按钮', () => {
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    expect(screen.getByTestId('save-workspace-root')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-workspace-root')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-workspace-root')).toBeNull()
  })

  it('case 4: editing 模式 input 自动 focus + 全选', () => {
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    const input = screen.getByTestId('workspace-root') as HTMLInputElement
    input.focus = vi.fn()
    input.select = vi.fn()
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    expect(input.focus).toHaveBeenCalled()
    expect(input.select).toHaveBeenCalled()
  })

  it('case 5: 输入新路径 → debounce 300ms → 调 validate 一次', async () => {
    vi.useFakeTimers()
    agentFetchMock.mockResolvedValueOnce({
      exists: true,
      isWorkspace: true,
    })
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), {
      target: { value: '/new/path/with/reqs' },
    })
    // debounce 300ms 未到 → 不应调
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(agentFetchMock).not.toHaveBeenCalled()
    // 满 300ms → 调
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    expect(agentFetchMock).toHaveBeenCalledWith(
      '/api/workspace/validate-path',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/new/path/with/reqs' }),
      }),
    )
  })

  it('case 6: validate 返 valid → 保存按钮启用', async () => {
    agentFetchMock.mockResolvedValueOnce({ exists: true, isWorkspace: true })
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), {
      target: { value: '/new/valid/ws' },
    })
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/validate-path',
        expect.any(Object),
      ),
    )
    const saveBtn = screen.getByTestId('save-workspace-root') as HTMLButtonElement
    await waitFor(() => expect(saveBtn).not.toBeDisabled())
  })

  it('case 7: E_WS_ROOT_PATH_NOT_WORKSPACE → 黄边 + 文案', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(400, {
        error: 'E_WS_ROOT_PATH_NOT_WORKSPACE',
        message: '该路径缺少 workspace 痕迹',
      }),
    )
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), {
      target: { value: '/some/random/dir' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('workspace-validation-message')).toHaveTextContent(
        /workspace 痕迹/,
      ),
    )
    const saveBtn = screen.getByTestId('save-workspace-root') as HTMLButtonElement
    expect(saveBtn).toBeDisabled()
  })

  it('case 8: E_WS_ROOT_PATH_NOT_EXISTS → 红边 + 文案', async () => {
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(400, {
        error: 'E_WS_ROOT_PATH_NOT_EXISTS',
        message: '该路径不存在',
      }),
    )
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), {
      target: { value: '/no/such/path' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('workspace-validation-message')).toHaveTextContent(
        /不存在/,
      ),
    )
    const saveBtn = screen.getByTestId('save-workspace-root') as HTMLButtonElement
    expect(saveBtn).toBeDisabled()
  })

  it('case 9: 点保存(合法)→ PATCH + 切 saved + banner 出现', async () => {
    agentFetchMock.mockResolvedValueOnce({ exists: true, isWorkspace: true }) // validate
    agentFetchMock.mockResolvedValueOnce({
      // PATCH
      ok: true,
      config: { workspaceRoot: '/new/valid/ws' },
    })
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), {
      target: { value: '/new/valid/ws' },
    })
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/validate-path',
        expect.any(Object),
      ),
    )
    fireEvent.click(screen.getByTestId('save-workspace-root'))
    await waitFor(() => expect(screen.getByTestId('saved-banner')).toBeInTheDocument())
    expect(agentFetchMock).toHaveBeenCalledWith(
      '/api/workspace/config',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ workspaceRoot: '/new/valid/ws' }),
      }),
    )
  })

  it('case 10: banner 上点 restart → POST /api/agent/restart', async () => {
    agentFetchMock.mockResolvedValueOnce({ exists: true, isWorkspace: true }) // validate
    agentFetchMock.mockResolvedValueOnce({ ok: true, config: { workspaceRoot: '/x' } }) // PATCH
    agentFetchMock.mockResolvedValueOnce({
      // restart
      ok: true,
      reason: 'workspaceRoot-changed',
      ts: Date.now(),
      message: 'restarting',
    })
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), { target: { value: '/x' } })
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/validate-path',
        expect.any(Object),
      ),
    )
    fireEvent.click(screen.getByTestId('save-workspace-root'))
    await waitFor(() => screen.getByTestId('saved-banner'))
    fireEvent.click(screen.getByTestId('restart-agent-btn'))
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/agent/restart',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('case 11: 取消 → 回滚到 info.dataRoot + 切回 readonly', async () => {
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), { target: { value: '/tmp' } })
    fireEvent.click(screen.getByTestId('cancel-workspace-root'))
    const input = screen.getByTestId('workspace-root') as HTMLInputElement
    expect(input.value).toBe('/h/.aidevspace')
    expect(input).toHaveAttribute('readonly')
    expect(screen.getByTestId('edit-workspace-root')).toBeInTheDocument()
  })

  it('case 12: 保存失败 → 切回 readonly,不显示 banner', async () => {
    agentFetchMock.mockResolvedValueOnce({ exists: true, isWorkspace: true })
    agentFetchMock.mockRejectedValueOnce(
      new agentClient.AgentError(500, { error: 'internal' }),
    )
    const { wrapper } = makeWrapper()
    render(<WorkspaceSection info={fakeInfo} />, { wrapper })
    fireEvent.click(screen.getByTestId('edit-workspace-root'))
    fireEvent.change(screen.getByTestId('workspace-root'), { target: { value: '/x' } })
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenCalledWith(
        '/api/workspace/validate-path',
        expect.any(Object),
      ),
    )
    fireEvent.click(screen.getByTestId('save-workspace-root'))
    await waitFor(() => expect(screen.getByTestId('edit-workspace-root')).toBeInTheDocument())
    expect(screen.queryByTestId('saved-banner')).toBeNull()
  })
})