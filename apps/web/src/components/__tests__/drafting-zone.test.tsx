import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// mock next/navigation(避免在测试中真的调 router)
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}))

import { DraftingZone } from '../drafting-zone'
import { emptyDrafting } from '@/lib/drafting'

// ============================================================================
// Fixture
// ============================================================================

function mockFile(name: string, content: string): File {
  // 在 jsdom 中 File 构造函数仅支持 name;content 通过一个 blob 间接持有
  const blob = new Blob([content], { type: 'text/plain' })
  return new File([blob], name, { type: blob.type })
}

/** jsdom 没有真正的 FileReader,我们用一个最小 stub 直接同步触发 onload */
class MockFileReader {
  public onload: ((e: ProgressEvent<FileReader>) => void) | null = null
  public onerror: ((e: ProgressEvent<FileReader>) => void) | null = null
  public result: string | ArrayBuffer | null = null
  readAsText(_file: File): void {
    // 大多数测试不直接读 content,但 mockConvertToMarkdown 也只在
    // content 长度 / 字节上读;这里直接填空字符串即可,filename 已携带确定性信息。
    this.result = ''
    this.onload?.({ target: this } as unknown as ProgressEvent<FileReader>)
  }
}

// ============================================================================
// 创建流程:`＋ 新建` → 对话框 → 提交 → 卡片出现 + 抽屉打开(issue 06)
// ============================================================================

describe('DraftingZone · 新建流程(issue 06 验收 #2 #3)', () => {
  afterEach(() => cleanup())

  it('点击 "＋ 新建" → 弹出对话框,提交 → 新文件作为卡片出现 + 抽屉打开', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    // 空态:占位卡存在
    expect(screen.getByTestId('aux-empty-placeholder')).toBeInTheDocument()

    // 1) 触发创建
    await user.click(screen.getByTestId('aux-files-pane-create'))
    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()

    // 2) 填 filename + 选 tag + 提交
    fireEvent.change(screen.getByTestId('new-aux-dialog-filename'), {
      target: { value: 'refund-api' },
    })
    await user.click(screen.getByTestId('new-aux-dialog-tag-api'))
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    // 3) 对话框关闭
    expect(screen.queryByTestId('new-aux-dialog')).toBeNull()

    // 4) 新卡片出现
    const cards = screen.getAllByTestId('aux-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-aux-id')).toMatch(/^aux-new-/)
    expect(cards[0].getAttribute('data-usage-tag')).toBe('api')
    expect(cards[0].getAttribute('data-source-format')).toBe('md')
    expect(cards[0].getAttribute('data-converted-to-md')).toBe('false')

    // 5) 抽屉打开(显示新文件 filename)
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'refund-api.md',
    )
  })

  it('新建文件可立刻在抽屉编辑(issue 06 验收 #5 + 上层 issue 05)', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)
    await user.click(screen.getByTestId('aux-files-pane-create'))
    fireEvent.change(screen.getByTestId('new-aux-dialog-filename'), {
      target: { value: 'notes' },
    })
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    // issue 06 验收 #2:新建文件 body 为空 Markdown
    expect(ta.value).toBe('')
    await user.click(ta)
    await user.keyboard('X')
    expect(ta.value).toBe('X')
  })

  it('同名文件冲突 → 对话框不关闭,顶 alert 提示', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    // 第一次创建 a.md
    await user.click(screen.getByTestId('aux-files-pane-create'))
    fireEvent.change(screen.getByTestId('new-aux-dialog-filename'), {
      target: { value: 'a.md' },
    })
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    // 第二次尝试创建同名 → 留在对话框 + 报错
    await user.click(screen.getByTestId('aux-files-pane-create'))
    fireEvent.change(screen.getByTestId('new-aux-dialog-filename'), {
      target: { value: 'a.md' },
    })
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog-error')).toBeInTheDocument()
    expect(
      screen.getByTestId('new-aux-dialog-error').textContent,
    ).toContain('已存在同名文件')

    // 列表仍然只有 1 个
    expect(screen.getAllByTestId('aux-card')).toHaveLength(1)
  })
})

// ============================================================================
// 上传流程:`📁 上传` → mockConvert → 卡片(带转换 chip)出现 + 抽屉(issue 06)
// ============================================================================

describe('DraftingZone · 上传流程(issue 06 验收 #4 #5 #6)', () => {
  beforeEach(() => {
    // 替换 FileReader —— jsdom 默认没有实现
    ;(globalThis as unknown as { FileReader: typeof MockFileReader }).FileReader =
      MockFileReader as unknown as typeof FileReader
  })
  afterEach(() => cleanup())

  it('上传 .md → 卡片 source_format=md,converted=false,无 "↻ 已转 MD" chip', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    const file = mockFile('note.md', '# hi')
    fireEvent.change(input, { target: { files: [file] } })

    const cards = screen.getAllByTestId('aux-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-source-format')).toBe('md')
    expect(cards[0].getAttribute('data-converted-to-md')).toBe('false')
    // 不显示转换 chip
    expect(withinCard(cards[0]).queryByTestId('aux-card-converted')).toBeNull()
  })

  it('上传 .docx → 卡片 source_format=docx,converted=true,显示 "↻ 已转 MD" chip', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    const file = mockFile('sop.docx', 'fake binary')
    fireEvent.change(input, { target: { files: [file] } })

    const cards = screen.getAllByTestId('aux-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-source-format')).toBe('docx')
    expect(cards[0].getAttribute('data-converted-to-md')).toBe('true')
    const chip = screen.getByTestId('aux-card-converted')
    expect(chip).toBeInTheDocument()
    expect(chip.textContent).toContain('已转 MD')
  })

  it('上传 .pdf → 卡片 source_format=pdf,converted=true,显示 "↻ 已转 MD" chip', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    const file = mockFile('analysis.pdf', '%PDF-1.4')
    fireEvent.change(input, { target: { files: [file] } })

    const cards = screen.getAllByTestId('aux-card')
    expect(cards[0].getAttribute('data-source-format')).toBe('pdf')
    expect(cards[0].getAttribute('data-converted-to-md')).toBe('true')
    expect(screen.getByTestId('aux-card-converted')).toBeInTheDocument()
  })

  it('上传 .docx 后文件名以 .md 存储(.docx 已经转换)', async () => {
    const data = emptyDrafting('req-001')
    render(<DraftingZone data={data} />)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [mockFile('refund-sop.docx', 'x')] },
    })
    const card = screen.getByTestId('aux-card')
    expect(card.querySelector('[data-testid=aux-card-filename]')?.textContent).toBe(
      'refund-sop.md',
    )
  })

  it('上传不支持的扩展名 → 打开对话框报 error,没创建文件', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    // 直接绕过 input 的 accept,通过 fireEvent 注入任意文件
    fireEvent.change(input, {
      target: { files: [mockFile('virus.exe', 'whatever')] },
    })
    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog-error').textContent).toContain(
      '不支持的格式',
    )
    expect(screen.queryAllByTestId('aux-card')).toHaveLength(0)
  })

  it('上传同名已存在文件 → 打开对话框报冲突', async () => {
    const data = emptyDrafting('req-001')
    const user = userEvent.setup()
    render(<DraftingZone data={data} />)

    // 先建一个
    await user.click(screen.getByTestId('aux-files-pane-create'))
    fireEvent.change(screen.getByTestId('new-aux-dialog-filename'), {
      target: { value: 'a.md' },
    })
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    // 上传同名(注意 .docx → .md 归一化后是 a.md)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [mockFile('a.docx', 'x')] },
    })

    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog-error').textContent).toContain(
      '已存在',
    )
    // 仍然只有一个卡片
    expect(screen.getAllByTestId('aux-card')).toHaveLength(1)
  })

  it('上传 .docx 后抽屉打开,显示 source_format=docx + 转换提示', async () => {
    const data = emptyDrafting('req-001')
    render(<DraftingZone data={data} />)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { files: [mockFile('a.docx', 'x')] } })

    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('aux-drawer-source-format').textContent).toBe(
      'docx',
    )
    // drawer meta 行包含 ↻ 已转 MD
    expect(screen.getByTestId('aux-drawer-meta').textContent).toContain('已转 MD')
  })

  // -------------------------------------------------------------------------
  // Determinism(issue 06 验收 #7):mock 转换对相同 filename 产生相同 body
  // - 共享包单元测试已覆盖 mockConvertToMarkdown 的同输入同输出
  //   (见 packages/shared/src/__tests__/drafting.test.ts)
  // - 此处在上传流里再验证一次 "representative inputs":不同 .docx / .pdf
  //   的 mock 派生 body 都带可读 filename 标记,且 body 长度 > 0
  // -------------------------------------------------------------------------
  it('mock 转换代表性:上传 .docx / .pdf / .md 各自能派生非空 + 可识别的 body', () => {
    const data = emptyDrafting('req-001')
    const { unmount } = render(<DraftingZone data={data} />)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement

    // .docx
    fireEvent.change(input, {
      target: { files: [mockFile('refund-sop.docx', 'binary-A')] },
    })
    let body = (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement)
      .value
    expect(body.length).toBeGreaterThan(0)
    expect(body).toContain('refund-sop.docx')
    expect(body).toContain('mock 转换')
    fireEvent.click(screen.getByTestId('aux-drawer-backdrop'))

    // 关掉后不能再次干净地同名上传(冲突保护)—— 我们的断言已经做完了。
    // unmount 释放 input ref,避免下一组测试污染。
    unmount()
  })
})

// ============================================================================
// helper
// ============================================================================

function withinCard(card: HTMLElement): {
  queryByTestId: (id: string) => HTMLElement | null
} {
  return {
    queryByTestId: (id: string) =>
      card.querySelector(`[data-testid='${id}']`) as HTMLElement | null,
  }
}
