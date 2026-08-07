/**
 * CommandPalette 工位搜索测试(issue 14 · ADR-0012 §7 · ADR-0026:4 section)
 *
 * 验收:
 * - Cmd+K 唤起命令面板,输入 "boa" 出现 "切到 BOARD 工位" 选项
 * - 选中后回车跳转 /requirements/<currentId>/<zone-route>/
 * - 与既有 / 命令前缀 + ⌘I AI 提问切换不冲突
 * - Overview Tab 点击回到 /requirements/[id]/(无 ZoneBar 状态)
 *
 * ADR-0026:CLARIFYING / DESIGNING / EXECUTING 三工位退役,搜索用例改为
 * board / analyzing / wrapup / drafting。
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
const mockOpen = vi.fn()
const mockCloseKey = vi.fn()
vi.mock('@/components/ui-overlay-store', () => ({
  useUIOverlay: () => ({
    cmdK: mockCmdKOpen,
    cmdSlash: false,
    cmdN: false,
    open: mockOpen,
    close: mockClose,
    closeKey: mockCloseKey,
    restoreFocus: vi.fn(),
  }),
}))

// ---- 受控 mock:AnalyzingHistoryFabController(analyzing-fab ticket 04 · ADR-0022 D5.2) ----
// 默认无 controller,各 describe 块按需覆写。
type FakeController = {
  requirementId: string
  runCount: number
  isOpen: boolean
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}
let mockHistoryFabController: FakeController | null = null
const mockOpenHistoryFab = vi.fn()
const mockCloseHistoryFab = vi.fn()
const buildFakeController = (
  requirementId: string,
  runCount: number,
): FakeController => ({
  requirementId,
  runCount,
  isOpen: false,
  open: mockOpenHistoryFab,
  close: mockCloseHistoryFab,
})
vi.mock('@/components/analyzing-history-fab-controller', () => ({
  AnalyzingHistoryFabControllerProvider: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
  useAnalyzingHistoryFabController: () => null,
  useAnalyzingHistoryFabControllerValue: () => mockHistoryFabController,
}))

// 必须放在 vi.mock 之后
import { CommandPalette } from '@/components/command-palette'

beforeEach(() => {
  mockPathname = '/requirements/REF-001/drafting'
  mockCmdKOpen = true
  mockPush.mockClear()
  mockReplace.mockClear()
  mockClose.mockClear()
  mockOpen.mockClear()
  mockCloseKey.mockClear()
  mockHistoryFabController = null
  mockOpenHistoryFab.mockClear()
  mockCloseHistoryFab.mockClear()
})

afterEach(() => cleanup())

describe('CommandPalette 工位搜索(ADR-0012 §7 · issue 14 · ADR-0026:4 section)', () => {
  describe('工位匹配', () => {
    it('输入 "boa" 出现 "切到 BOARD 工位" 选项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()
      expect(screen.getByTestId('cmd-zone-board')).toHaveTextContent(/切到 BOARD 工位/)
    })

    it('输入 "wrp" 出现 WRAP-UP 工位项(routeSegment wrap-up 匹配)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'wrp')
      expect(screen.getByTestId('cmd-zone-wrapup')).toBeInTheDocument()
    })

    it('输入 "看板" 匹配 BOARD(displayName 包含)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '看板')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()
    })

    it('退役工位不再匹配:输入 "exe" 不出现 EXECUTING(已退役)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'exe')
      expect(screen.queryByTestId('cmd-zone-executing')).toBeNull()
    })

    it('退役工位不再匹配:输入 "clar" 不出现 CLARIFYING(已退役)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'clar')
      expect(screen.queryByTestId('cmd-zone-clarifying')).toBeNull()
    })

    it('输入 "ana" 出现 ANALYZING 工位项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'ana')
      expect(screen.getByTestId('cmd-zone-analyzing')).toBeInTheDocument()
    })

    it('大小写不敏感:输入 "BOA" 也匹配 BOARD', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'BOA')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()
    })

    it('@zone 前缀(ADR §7):"@board" 等价 "board"', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@board')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()
    })

    it('@zone 前缀中文场景:"@boa" 仍匹配 BOARD', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@boa')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()
    })

    it('纯 "@" 不触发搜索(剥掉后空 query)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '@')
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })

    it('无匹配时不显示工位项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'zzzzz')
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
      expect(screen.queryByTestId('cmd-zone-drafting')).toBeNull()
    })

    it('工位项与现有 ALL 命令共存(输入 "打" 既有 command item,工位项不会出现)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '打开')
      // 原始 ALL 中 "打开 design/02-api.md" 存在
      expect(screen.getByText(/打开 design\/02-api.md/)).toBeInTheDocument()
      // 工位不匹配
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })
  })

  describe('工位项点击跳转', () => {
    it('点击 BOARD 工位项后 router.push 到 /requirements/REF-001/board/', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      await user.click(screen.getByTestId('cmd-zone-board'))
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/board/')
    })

    it('点击 WRAP-UP 工位项跳到 wrap-up routeSegment(不是 wrapup id)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'wrp')
      await user.click(screen.getByTestId('cmd-zone-wrapup'))
      // routeSegment 与 id 解耦:wrap-up route → wrapup id
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/wrap-up/')
    })

    it('点击工位项同时关闭命令面板', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      await user.click(screen.getByTestId('cmd-zone-board'))
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
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      const item = screen.getByTestId('cmd-zone-board')
      item.focus()
      await user.keyboard('{Enter}')
      expect(mockPush).toHaveBeenCalledWith('/requirements/REF-001/board/')
    })
  })

  describe('与现有三段式不冲突', () => {
    it('输入 ">" 前缀不触发工位搜索(命令前缀优先)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '>boa')
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })

    it('AI 模式下工位搜索不出现(query 进 AI 提问分支)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      // 模拟 ⌘I 切到 AI 模式
      fireEvent.keyDown(window, { key: 'i', metaKey: true })
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })

    it('history 模式(点击"历史"按钮)不显示工位搜索', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.click(screen.getByRole('button', { name: '历史' }))
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
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
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })
  })

  describe('空 query 边界', () => {
    it('空 query 不渲染工位项(没有筛选输入不显示工位结果)', () => {
      render(<CommandPalette />)
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
      expect(screen.queryByTestId('cmd-zone-drafting')).toBeNull()
    })

    it('Query 重新打开面板时清空(已有 effect 行为,验证工位项也跟随)', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), 'boa')
      expect(screen.getByTestId('cmd-zone-board')).toBeInTheDocument()

      // 模拟关闭 → 重开
      mockCmdKOpen = false
      rerender(<CommandPalette />)
      mockCmdKOpen = true
      rerender(<CommandPalette />)
      expect(screen.queryByTestId('cmd-zone-board')).toBeNull()
    })
  })

  // ============================================================================
  // issue 03 触发入口 #2:命令面板搜「新建需求」
  // ============================================================================
  describe('「新建需求」命令项(issue 03 触发入口 #2)', () => {
    it('输入 "新建需求" 出现 cmd-new-requirement 项', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '新建需求')
      expect(screen.getByTestId('cmd-new-requirement')).toBeInTheDocument()
      expect(screen.getByTestId('cmd-new-requirement')).toHaveTextContent(/新建需求/)
    })

    it('点击「新建需求」 → 调用 mocked open("cmdN") + closeKey("cmdK")', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '新建需求')
      await user.click(screen.getByTestId('cmd-new-requirement'))
      expect(mockOpen).toHaveBeenCalledWith('cmdN')
      // 用 closeKey 避免 React 18 batching 把 open 覆盖(issue 03 触发入口 #2)
      expect(mockCloseKey).toHaveBeenCalledWith('cmdK')
    })

    it('「新建需求」项渲染为可交互 button(非 div)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '新建需求')
      const item = screen.getByTestId('cmd-new-requirement')
      expect(item.tagName).toBe('BUTTON')
    })
  })

  // ============================================================================
  // analyzing-fab ticket 04 · ADR-0022 D5.2:
  // Cmd+K 「🗂️ 历史分析」命令(命名沿用「需求操作」section)
  //
  // 验收:
  // - 搜「历史」出现 `cmd-history-fab` 项
  // - 描述包含当前 reqId + N 计数(实时跟随 controller.runCount)
  // - 点选 → controller.open('historyFab') + closeKey('cmdK')
  // - 无 controller / requirementId 不匹配 → 命令 disabled(降级文案 +
  //   data-disabled="true",不挂 click handler)
  // ============================================================================
  describe('「🗂️ 历史分析」命令项(analyzing-fab ticket 04 · ADR-0022 D5.2)', () => {
    it('搜「历史」出现 cmd-history-fab 项(默认 disabled,无 controller)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      expect(screen.getByTestId('cmd-history-fab')).toBeInTheDocument()
      expect(screen.getByTestId('cmd-history-fab')).toHaveTextContent(/历史分析/)
    })

    it('controller 存在且 requirementId 匹配 → 命令 enabled,desc 包含 reqId + N 计数', async () => {
      mockPathname = '/requirements/REQ-CMDK/analyzing'
      mockHistoryFabController = buildFakeController('REQ-CMDK', 7)
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      const item = screen.getByTestId('cmd-history-fab')
      // 启用态 → 渲染为可交互 button(非 div)
      expect(item.tagName).toBe('BUTTON')
      // desc 包含 reqId + N
      expect(item).toHaveTextContent(/REQ-CMDK/)
      expect(item).toHaveTextContent(/共 7 个 Run/)
      // 不带 data-disabled
      expect(item.getAttribute('data-disabled')).toBeNull()
    })

    it('点击 enabled 命令 → controller.open("historyFab") + closeKey("cmdK")', async () => {
      mockPathname = '/requirements/REQ-CMDK/analyzing'
      mockHistoryFabController = buildFakeController('REQ-CMDK', 2)
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      await user.click(screen.getByTestId('cmd-history-fab'))
      expect(mockOpenHistoryFab).toHaveBeenCalledWith('historyFab')
      // 用 closeKey 避免 React 18 batching 把 open 覆盖(沿用「新建需求」范式)
      expect(mockCloseKey).toHaveBeenCalledWith('cmdK')
    })

    it('controller 不存在(无 AnalyzingZone) → 命令 disabled(data-disabled="true")', async () => {
      mockPathname = '/requirements/REQ-CMDK/'
      // mockHistoryFabController = null (默认)
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      const item = screen.getByTestId('cmd-history-fab')
      // 禁用态 → 渲染为 div(data-disabled="true"),并展示降级文案
      expect(item.tagName).toBe('DIV')
      expect(item.getAttribute('data-disabled')).toBe('true')
      expect(item).toHaveTextContent(/请进入需求后再用/)
    })

    it('controller 存在但 requirementId 不匹配(跨 req 跳转过渡) → 命令 disabled', async () => {
      // 用户在 REQ-CMDK/analyzing;controller 来自 REQ-OTHER(stale);
      // 应 disabled —— 避免 stale 残留导致 Cmd+K 跳错面板
      mockPathname = '/requirements/REQ-CMDK/analyzing'
      mockHistoryFabController = buildFakeController('REQ-OTHER', 3)
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      const item = screen.getByTestId('cmd-history-fab')
      expect(item.tagName).toBe('DIV')
      expect(item.getAttribute('data-disabled')).toBe('true')
      expect(item).toHaveTextContent(/请进入需求后再用/)
      // 无 controller.open 调用(若误点也不触发)
      expect(mockOpenHistoryFab).not.toHaveBeenCalled()
    })

    it('disabled 命令点击不会调 controller.open(不挂 click handler)', async () => {
      mockPathname = '/requirements/REQ-OVERVIEW/' // 不在 req 内 → 无 req context
      mockHistoryFabController = null
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      await user.click(screen.getByTestId('cmd-history-fab'))
      expect(mockOpenHistoryFab).not.toHaveBeenCalled()
      expect(mockCloseKey).not.toHaveBeenCalled()
    })

    it('Overview 概览页(`/requirements/<id>/` 无 zone)→ 命令 disabled', async () => {
      mockPathname = '/requirements/REQ-OVERVIEW/'
      mockHistoryFabController = null
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      const item = screen.getByTestId('cmd-history-fab')
      expect(item.getAttribute('data-disabled')).toBe('true')
    })

    it('完全在 workspace 根(`/`)→ 命令 disabled', async () => {
      mockPathname = '/'
      mockHistoryFabController = null
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史')
      const item = screen.getByTestId('cmd-history-fab')
      expect(item.getAttribute('data-disabled')).toBe('true')
    })

    it('controller.runCount 实时更新:desc 在两次渲染间从「共 5」变「共 6」(SSE 追加 Run 模拟)', () => {
      mockPathname = '/requirements/REQ-CMDK/analyzing'
      mockHistoryFabController = buildFakeController('REQ-CMDK', 5)
      const { rerender } = render(<CommandPalette />)
      // 用 query 直接查 textContent,避开 autoFocus input
      expect(document.body.textContent ?? '').toMatch(/共 5 个 Run/)

      mockHistoryFabController = buildFakeController('REQ-CMDK', 6)
      rerender(<CommandPalette />)
      expect(document.body.textContent ?? '').toMatch(/共 6 个 Run/)
    })

    it('「🗂️ 历史分析」命令被搜索过滤:搜「历史」命中 label 「历史分析」', async () => {
      mockHistoryFabController = null
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.type(screen.getByPlaceholderText(/搜索命令/), '历史分析')
      const item = screen.getByTestId('cmd-history-fab')
      expect(item).toBeInTheDocument()
      expect(item).toHaveTextContent(/历史分析/)
      // 搜「历史」不命中其他命令(避免现有 「新建需求」/「code-stage」误匹配)
      expect(screen.queryByTestId('cmd-new-requirement')).toBeNull()
    })
  })
})