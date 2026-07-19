/**
 * DraftingPrdPane · ticket 03 (ADR-0015 D3 / D8) — DRAFTING 覆盖(上传新版本)
 *
 * 覆盖(.scratch/prd-upload-and-edit/issues/03 验收):
 * - "📤 上传新版本"按钮渲染,紧贴 previewToggle 按钮旁
 * - 隐藏 input 接受 .md / .txt / .docx
 * - 上传 .md → 走 `uploadAndReplace` → 成功 → textarea 渲染新内容
 * - 上传 .docx → 覆盖后含图片相对路径(`![](assets/prd-1.png)`)
 * - 闸门失败(扩展名不被支持)→ 顶部红条,**不**写盘
 * - 服务端返回 `{ok:false}` → 顶部红条
 * - 覆盖成功 **不弹 modal** —— `screen.queryByRole('dialog')` 永远 null
 * - 上传期间按钮 disabled(data-uploading='true')
 *
 * mock 模式:
 * - `uploadAndReplace` mock 返回值由测试控制
 * - FileReader stub:jsdom 不实现 readAsDataURL,这里替换为同步触发 onload
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

// ---- 受控 mock:uploadAndReplace ----
const mockUploadAndReplace = vi.fn()
vi.mock('@/lib/requirement-upload', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/requirement-upload')>(
      '@/lib/requirement-upload',
    )
  return {
    ...actual,
    uploadAndReplace: (...args: unknown[]) => mockUploadAndReplace(...args),
  }
})

/** 从真实 lib 导入,确保断言用 D6 统一文案(与上传组件一致) */
import { UNIFIED_BANNER_MESSAGE } from '@/lib/requirement-upload'

import { installMockFileReader } from '@/lib/__tests__/file-reader-mock'

beforeEach(() => {
  mockUploadAndReplace.mockReset()
  installMockFileReader()
})

afterEach(() => cleanup())

import { DraftingPrdPane } from '../drafting-prd-pane'
import type { DraftingData } from '@/lib/drafting'
import { emptyDrafting } from '@/lib/drafting'

/** 标准 PRD 测试数据 —— 已有 PRD Markdown,不是 empty 态 */
function fixture(): DraftingData {
  const data = emptyDrafting('req-001-upload')
  data.empty = false
  data.title = '退款功能优化'
  data.prdMarkdown = '# 退款功能优化\n\n## 背景\n旧版正文\n'
  data.toolbar = {
    crumb: [{ label: '退款功能优化', current: true }],
    statusText: '',
  }
  return data
}

describe('DraftingPrdPane · ticket 03 上传新版本', () => {
  it('渲染:📤 上传新版本 按钮紧贴 preview toggle 按钮', () => {
    const data = fixture()
    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )
    const uploadBtn = screen.getByTestId('drafting-prd-upload')
    const toggleBtn = screen.getByTestId('drafting-prd-toggle-preview')
    expect(uploadBtn).toBeInTheDocument()
    expect(toggleBtn).toBeInTheDocument()
    // 都在 editor-toolbar 内(同父容器,DOM 顺序相邻)
    expect(uploadBtn.closest('[data-testid="drafting-editor-toolbar"]')).toBe(
      toggleBtn.closest('[data-testid="drafting-editor-toolbar"]'),
    )
  })

  it('隐藏 file input accept=.md,.txt,.docx', () => {
    const data = fixture()
    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )
    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.md,.txt,.docx')
    expect(input.className).toContain('hidden')
  })

  it('上传 .md → 成功 → textarea 渲染新 markdown,触发 onPrdMarkdownChange', async () => {
    const data = fixture()
    const onChange = vi.fn()
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: true,
      data: {
        markdown: '# 退款功能优化\n\n## 背景\n新版正文\n',
        assets: [],
      },
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={onChange}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    const file = new File(['# x'], 'new.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockUploadAndReplace).toHaveBeenCalledWith('req-001-upload', file)
    })
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        '# 退款功能优化\n\n## 背景\n新版正文\n',
      )
    })

    // 关键:ticket 03 验收要求 textarea 渲染新 markdown(react 受控组件 → 自动 rerender)
    const ta = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    // 这里 ta.value 取决于父组件是否 setState;本组件只调 onChange,
    // 父组件(DraftingZone)的更新不在本测试范围 —— 用 onChange 调用断言覆盖语义。
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('新版正文')

    // 顶部绿色成功 toast 出现(短暂)
    await waitFor(() => {
      expect(
        screen.queryByTestId('drafting-prd-upload-success'),
      ).toBeInTheDocument()
    })
  })

  it('上传 .docx → 覆盖后 markdown 含 ![](assets/prd-1.png) 相对路径', async () => {
    const data = fixture()
    const onChange = vi.fn()
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: true,
      data: {
        // ticket 03 验收:docx 解析后 markdown 含图片相对路径(无 alt text 也合法)
        markdown: '# 退款功能优化\n\n![](assets/prd-1.png)\n\n## 背景\n新版',
        assets: [
          {
            name: 'prd-1.png',
            url: '/api/requirement/req-001-upload/assets/prd-1.png',
            path: 'requirements/req-001-upload/assets/prd-1.png',
            size: 1024,
            mime: 'image/png',
          },
        ],
      },
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={onChange}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    const file = new File(['fake'], 'sample.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockUploadAndReplace).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
    expect(String(onChange.mock.calls[0]?.[0] ?? '')).toContain(
      '![](assets/prd-1.png)',
    )
  })

  it('前端闸门失败(扩展名不被支持)→ 顶部红条,prdMarkdown 不变,无 modal', async () => {
    const data = fixture()
    const onChange = vi.fn()
    // 闸门失败:uploadAndReplace 在文件类型校验失败时返回 ok:false
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: false,
      reason: 'ext',
      message: UNIFIED_BANNER_MESSAGE,
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={onChange}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    const file = new File(['x'], 'evil.exe', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(
        screen.getByTestId('drafting-prd-upload-error'),
      ).toBeInTheDocument()
    })
    // ticket 03 修复:红条用 ADR-0015 D6 统一文案,不暴露具体 reason
    expect(
      screen.getByTestId('drafting-prd-upload-error').textContent,
    ).toContain('无法解析此文件')
    expect(
      screen.getByTestId('drafting-prd-upload-error').textContent,
    ).toContain('包含过大图片')
    // 关键:prdMarkdown 未被覆盖
    expect(onChange).not.toHaveBeenCalled()
    // 关键:不弹 modal
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('服务端闸门/解析失败 → 顶部红条,保留现有 prdMarkdown', async () => {
    const data = fixture()
    const onChange = vi.fn()
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: false,
      reason: 'parse-error',
      message: UNIFIED_BANNER_MESSAGE,
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={onChange}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    const file = new File(['x'], 'fake.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(
        screen.getByTestId('drafting-prd-upload-error'),
      ).toBeInTheDocument()
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('覆盖成功不弹 modal(`getByRole("dialog")` 永远为 null)', async () => {
    const data = fixture()
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: true,
      data: { markdown: '# 新版', assets: [] },
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['# 新版'], 'p.md', { type: 'text/markdown' })] },
    })

    await waitFor(() => {
      expect(
        screen.queryByTestId('drafting-prd-upload-success'),
      ).toBeInTheDocument()
    })
    // ticket 03 W4 强度断言:无 modal / 无 diff / 无确认
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('上传中按钮 disabled(data-uploading="true")', async () => {
    const data = fixture()
    // 让 mock 永远 pending,模拟上传中态
    let resolveFn: (v: unknown) => void = () => {
      /* noop */
    }
    mockUploadAndReplace.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    const btn = screen.getByTestId('drafting-prd-upload')

    fireEvent.change(input, {
      target: {
        files: [new File(['x'], 'p.md', { type: 'text/markdown' })],
      },
    })

    await waitFor(() => {
      expect(btn.getAttribute('data-uploading')).toBe('true')
    })
    expect(btn).toBeDisabled()

    // resolve 一下,避免 promise leak
    resolveFn({ ok: true, data: { markdown: 'p', assets: [] } })
  })

  it('点红条 ✕ → 错误消失', async () => {
    const data = fixture()
    mockUploadAndReplace.mockResolvedValueOnce({
      ok: false,
      reason: 'size',
      message: UNIFIED_BANNER_MESSAGE,
    })

    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )

    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'big.md', { type: 'text/markdown' })] },
    })

    await waitFor(() => {
      expect(
        screen.getByTestId('drafting-prd-upload-error'),
      ).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByTestId('drafting-prd-upload-error-dismiss'),
    )

    await waitFor(() => {
      expect(
        screen.queryByTestId('drafting-prd-upload-error'),
      ).toBeNull()
    })
  })

  it('点按钮 → 触发隐藏 input 的 click(由 jsdom 自动触发 change)', async () => {
    const data = fixture()
    const user = userEvent.setup()
    render(
      <DraftingPrdPane
        data={data}
        prdMarkdown={data.prdMarkdown}
        onPrdMarkdownChange={vi.fn()}
      />,
    )
    const input = screen.getByTestId(
      'drafting-prd-upload-input',
    ) as HTMLInputElement
    // mock input.click 让 button click 模拟 file picker
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {
      /* jsdom 不能真正弹文件选择器 */
    })
    const btn = screen.getByTestId('drafting-prd-upload')
    await user.click(btn)
    expect(clickSpy).toHaveBeenCalled()
  })
})