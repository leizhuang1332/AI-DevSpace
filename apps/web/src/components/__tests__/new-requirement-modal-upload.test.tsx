/**
 * NewRequirementModal · ticket 03 (ADR-0015 D3) — Dialog PRD 上传预填
 *
 * 覆盖(.scratch/prd-upload-and-edit/issues/03 验收):
 * - PRD Markdown textarea 渲染(label "PRD Markdown(可选)")
 * - "📤 上传文件"按钮 + 隐藏 file input accept=.md,.txt,.docx
 * - 上传 .md → 调 parseForDialog → textarea 填入 markdown
 * - 上传 .docx → textarea 含 ![](assets/prd-1.png) 相对路径
 * - 闸门失败 → inline 红字提示(不弹 modal)
 * - 提交时若有 prdMarkdown → 一并传给 createRequirement(服务端写入 requirement.md)
 * - 提交时若无 prdMarkdown → 不传 prdMarkdown 字段(对齐默认模板路径)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockCreateRequirement = vi.fn()
const mockIsCreateRequirementError = vi.fn()
vi.mock('@/lib/requirement', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/requirement')>(
      '@/lib/requirement',
    )
  return {
    ...actual,
    createRequirement: (...args: unknown[]) => mockCreateRequirement(...args),
    isCreateRequirementError: (...args: unknown[]) =>
      mockIsCreateRequirementError(...args),
  }
})

const mockParseForDialog = vi.fn()
vi.mock('@/lib/requirement-upload', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/requirement-upload')>(
      '@/lib/requirement-upload',
    )
  return {
    ...actual,
    parseForDialog: (...args: unknown[]) => mockParseForDialog(...args),
  }
})

/** 从真实 lib 导入 D6 统一文案(测试 mock 用同一字符串,断言自动同步) */
import { UNIFIED_BANNER_MESSAGE } from '@/lib/requirement-upload'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
}))

// ---- FileReader mock(jsdom 不实现 readAsDataURL)----
import { installMockFileReader } from '@/lib/__tests__/file-reader-mock'

beforeEach(() => {
  mockCreateRequirement.mockReset()
  mockCreateRequirement.mockResolvedValue({
    id: 'req-007-退款功能优化',
    title: '退款功能优化',
    createdAt: '2026-07-17T10:00:00.000Z',
  })
  mockIsCreateRequirementError.mockReturnValue(false)
  mockParseForDialog.mockReset()
  mockPush.mockReset()
  installMockFileReader()
})

afterEach(() => cleanup())

import {
  UIOverlayProvider,
  useUIOverlay,
} from '@/components/ui-overlay-store'
import { NewRequirementModal } from '@/components/new-requirement-modal'

function renderModal() {
  function Trigger() {
    const { open } = useUIOverlay()
    return (
      <button type="button" data-testid="trigger-btn" onClick={() => open('cmdN')}>
        trigger
      </button>
    )
  }
  return render(
    <UIOverlayProvider>
      <Trigger />
      <NewRequirementModal />
    </UIOverlayProvider>,
  )
}

describe('NewRequirementModal · ticket 03 上传预填', () => {
  it('渲染:PRD Markdown textarea + 📤 上传文件按钮 + 隐藏 file input', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    expect(screen.getByTestId('new-req-modal-prd')).toBeInTheDocument()
    expect(screen.getByTestId('new-req-modal-upload-prd')).toBeInTheDocument()
    const input = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.md,.txt,.docx')
    expect(input.className).toContain('hidden')
  })

  it('上传 .md → 走 parseForDialog → textarea 填入 markdown + 成功提示', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: true,
      data: { markdown: '# 退款功能优化\n\n## 背景\n从 docx 解析而来', images: [] },
    })

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    const file = new File(['# from docx'], 'prd.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockParseForDialog).toHaveBeenCalledWith(file)
    })
    await waitFor(() => {
      const ta = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
      expect(ta.value).toBe('# 退款功能优化\n\n## 背景\n从 docx 解析而来')
    })
    // 顶部 hint 显示已解析
    const hint = screen.getByTestId('new-req-modal-upload-hint')
    expect(hint.textContent).toContain('已从 prd.md 解析')
  })

  it('上传 .docx → textarea 含 ![](assets/prd-1.png) 相对路径(ticket 03 验收)', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: true,
      data: {
        markdown:
          '# 退款功能优化\n\n![](assets/prd-1.png)\n\n## 背景\ndocx 解析结果',
        images: [
          { name: 'prd-1', base64: 'iVBORw0KGgo=', mime: 'image/png' },
        ],
      },
    })

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    const file = new File(['fake'], 'sample.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      const ta = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
      expect(ta.value).toContain('![](assets/prd-1.png)')
    })
  })

  it('前端闸门失败(.exe)→ inline 红字提示,textarea 不变', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: false,
      reason: 'ext',
      message: UNIFIED_BANNER_MESSAGE,
    })

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [
          new File(['x'], 'evil.exe', { type: 'application/octet-stream' }),
        ],
      },
    })

    await waitFor(() => {
      const hint = screen.getByTestId('new-req-modal-upload-hint')
      // ticket 03 修复:D6 统一红条文案(不暴露具体 reason)
      expect(hint.textContent).toContain('无法解析此文件')
      expect(hint.textContent).toContain('包含过大图片')
    })
    // textarea 仍是空
    const ta = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
    expect(ta.value).toBe('')
    // ticket 03 Dialog 端:闸门失败时 modal 保持开启(用户在 dialog 内修正),
    // 但不弹额外 confirmation modal(用 inline hint 提示)
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('服务端闸门/解析失败 → inline 红字(沿用 parseForDialog 同一组 fallback 文案)', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: false,
      reason: 'parse-error',
      message: UNIFIED_BANNER_MESSAGE,
    })

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [
          new File(['fake'], 'fake.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        ],
      },
    })

    await waitFor(() => {
      const hint = screen.getByTestId('new-req-modal-upload-hint')
      expect(hint.textContent).toBe(UNIFIED_BANNER_MESSAGE)
    })
  })

  it('提交时若有 prdMarkdown → 把它传给 createRequirement', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: true,
      data: { markdown: '# 来自解析\n\nbody', images: [] },
    })

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    // 填 title
    const titleInput = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(titleInput, '退款功能优化')

    // 上传文件,预填 textarea
    const fileInput = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['# 来自解析'], 'prd.md', { type: 'text/markdown' })],
      },
    })
    await waitFor(() => {
      const ta = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
      expect(ta.value).toBe('# 来自解析\n\nbody')
    })

    // 提交
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(mockCreateRequirement).toHaveBeenCalledWith({
        title: '退款功能优化',
        prdMarkdown: '# 来自解析\n\nbody',
      })
    })
  })

  it('提交时若无 prdMarkdown(用户没上传)→ 只传 title(对齐 ticket 04 既有行为)', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const titleInput = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(titleInput, '退款功能优化')

    // 不上传任何文件,textarea 保持空
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(mockCreateRequirement).toHaveBeenCalledWith({
        title: '退款功能优化',
      })
    })
  })

  it('打开 → 关闭 → 再打开,prdMarkdown 字段被重置(决策 E10 — 取消无副作用)', async () => {
    mockParseForDialog.mockResolvedValueOnce({
      ok: true,
      data: { markdown: '第一次上传的内容', images: [] },
    })

    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')

    // 第一次打开
    await user.click(trigger)
    const fileInput = screen.getByTestId(
      'new-req-modal-upload-prd-input',
    ) as HTMLInputElement
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['content'], 'p.md', { type: 'text/markdown' }),
        ],
      },
    })
    await waitFor(() => {
      const ta = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
      expect(ta.value).toBe('第一次上传的内容')
    })

    // 关闭
    await user.click(screen.getByTestId('new-req-modal-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('new-req-modal')).toBeNull()
    })

    // 再打开,textarea 应被重置
    await user.click(trigger)
    const ta2 = screen.getByTestId('new-req-modal-prd') as HTMLTextAreaElement
    expect(ta2.value).toBe('')
  })
})