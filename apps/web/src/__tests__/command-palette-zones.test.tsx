/**
 * CommandPalette 工位搜索测试(issue 14 · ADR-0012 §7)
 *
 * 验收:
 * - Cmd+K 唤起命令面板,输入 "exe" 出现 "切到 EXECUTING 工位" 选项
 * - 选中后回车跳转 /requirements/<currentId>/<zone-route>/
 * - 与既有 / 命令前缀 + ⌘I AI 提问切换不冲突
 * - Overview Tab 点击回到 /requirements/[id]/(无 ZoneBar 状态)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---- 受控 mock:next/navigation + next/link ----
let mockPathname = '/requirements/REF-001/drafting'
const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// ---- 受控 mock:UIOverlay store(控制 CommandPalette 的打开/关闭) ----
let mockCmdKOpen = false
const mockClose = vi.fn(() => {
  mockCmdKOpen = false
})
vi.mock('@/components/ui-overlay-store', () => ({
  useUIOverlay: () => ({
    cmdK: mockCmdKOpen,
    cmdSlash: false,
    cmdN: false,
    open: vi.fn(),
    close: mockClose,
  }),
}))

// 必须放在 vi.mock 之后
import { CommandPalette } from '@/components/command-palette'

beforeEach(() => {
  mockPathname = '/requirements/REF-001/drafting'
  mockCmdKOpen = true
  mockPush.mockClear()
  mockReplace.mockClear()
  mockClose.mockClear()
})

afterEach(() => cleanup())

describe('CommandPalette 工位搜索(ADR-0012 §7 · issue 14)', () => {
  describe('工位匹配', () => {
    it('输入 "exe" 出现 "切到 EXECUTING 工位" 选项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()
      expect(screen.getByTestId('cmd-zone-executing')).toHaveTextContent(/切到 EXECUTING 工位/)
    })

    it('输入 "wrp" 出现 WRAP-UP 工位项(route_segment wrap-up 匹配)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'wrp')
      expect(screen.getByTestId('cmd-zone-wrapup')).toBeInTheDocument()
    })

    it('输入 "执行中" 匹配 EXECUTING(display_name 包含)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '执行中')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()
    })

    it('输入 "clar" 出现 CLARIFYING 工位项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'clar')
      expect(screen.getByTestId('cmd-zone-clarifying')).toBeInTheDocument()
    })

    it('输入 "ana" 出现 ANALYZING 工位项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'ana')
      expect(screen.getByTestId('cmd-zone-analyzing')).toBeInTheDocument()
    })

    it('大小写不敏感:输入 "EXE" 也匹配 EXECUTING', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'EXE')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()
    })

    it('@zone 前缀(ADR §7):"@executing" 等价 "executing"', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@executing')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()
    })

    it('@zone 前缀中文场景:"@exe" 仍匹配 EXECUTING', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@exe')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()
    })

    it('纯 "@" 不触发搜索(剥掉后空 query)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })

    it('无匹配时不显示工位项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'zzzzz')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
      expect(screen.queryByTestId('cmd-zone-drafting')).toBeNull()
    })

    it('工位项与现有 ALL 命令共存(输入 "打" 既有 command item,工位项不会出现)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '打开')
      // 原始 ALL 中 "打开 design/02-api.md" 存在
      expect(screen.getByText(/打开 design\/02-api.md/)).toBeInTheDocument()
      // 工位不匹配
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })
  })

  describe('工位项点击跳转', () => {
    it('点击 EXECUTING 工位项后 router.push 到 /requirements/REF-001/executing/', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      await user.click(screen.getByTestId('cmd-zone-executing'))
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/executing/')
    })

    it('点击 WRAP-UP 工位项跳到 wrap-up route_segment(不是 wrapup id)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'wrp')
      await user.click(screen.getByTestId('cmd-zone-wrapup'))
      // route_segment 与 id 解耦:wrap-up route → wrapup id
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/wrap-up/')
    })

    it('点击工位项同时关闭命令面板', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      await user.click(screen.getByTestId('cmd-zone-executing'))
      expect(mockClose).toHaveBeenCalled()
    })

    it('工位项在不同需求 id 下生成正确 URL', async () => {
      mockPathname = '/requirements/REQ-999/analyzing'
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'draft')
      await user.click(screen.getByTestId('cmd-zone-drafting'))
      expect(mockPush).toHaveBeenCalledWith('/requirements/REQ-999/drafting/')
    })

    it('焦点在工位项上按 Enter 跳转(spec 验收:"选中后回车跳转")', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      const item = screen.getByTestId('cmd-zone-executing')
      item.focus()
      await user.keyboard('{Enter}')
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/executing/')
    })
  })

  describe('与现有三段式不冲突', () => {
    it('输入 ">" 前缀不触发工位搜索(命令前缀优先)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '>exe')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })

    it('AI 模式下工位搜索不出现(query 进 AI 提问分支)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      // 模拟 ⌘I 切到 AI 模式
      fireEvent.keyDown(window, { key: 'i', metaKey: true })
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })

    it('history 模式(点击"历史"按钮)不显示工位搜索', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.click(screen.getByRole('button', { name: '历史' }))
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })

    it('Overview 页(`/requirements/REF-001/`)点击 "Overview" 工位项跳到 /requirements/REF-001/', async () => {
      mockPathname = '/requirements/REF-001/drafting'
      const user = userEvent.setup()
      render(<CommandPalette />)
      // 输入 "overview" 匹配 Overview 工位项
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'overview')
      expect(screen.getByTestId('cmd-zone-overview')).toBeInTheDocument()
      await user.click(screen.getByTestId('cmd-zone-overview'))
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/')
    })

    it('面板关闭(overlay 关闭)时不渲染内容', () => {
      mockCmdKOpen = false
      render(<CommandPalette />)
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })
  })

  describe('空 query 边界', () => {
    it('空 query 不渲染工位项(没有筛选输入不显示工位结果)', () => {
      render(<CommandPalette />)
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
      expect(screen.queryByTestId('cmd-zone-drafting')).toBeNull()
    })

    it('Query 重新打开面板时清空(已有 effect 行为,验证工位项也跟随)', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      expect(screen.getByTestId('cmd-zone-executing')).toBeInTheDocument()

      // 模拟关闭 → 重开
      mockCmdKOpen = false
      rerender(<CommandPalette />)
      mockCmdKOpen = true
      rerender(<CommandPalette />)
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })
  })
})