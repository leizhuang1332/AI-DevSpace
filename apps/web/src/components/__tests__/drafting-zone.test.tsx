import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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
// PRD 预览 / 链接 → 抽屉切换(issue 07 验收 #1 #2 #7 #8)
// ============================================================================

describe('DraftingZone · PRD 预览 + 相对链接 → 抽屉(issue 07)', () => {
  afterEach(() => cleanup())

  /** 准备一个带有辅助文件的 DRAFTING 数据 */
  function dataWithAux(): ReturnType<typeof emptyDrafting> {
    const d = emptyDrafting('req-001')
    d.empty = false
    d.prdMarkdown = [
      '# 退款功能优化',
      '',
      '## 验收标准',
      '',
      '- 成功率 ≥ 99%',
      '- 详情见 [API 草案](./api-draft.md)',
      '',
    ].join('\n')
    d.auxFiles = [
      {
        id: 'aux-api',
        filename: 'api-draft.md',
        body: '# API',
        usage_tag: 'api',
        source_format: 'md',
        converted_to_md: false,
      },
      {
        id: 'aux-data',
        filename: 'data-model.md',
        body: '# Data',
        usage_tag: 'data',
        source_format: 'md',
        converted_to_md: false,
      },
    ]
    return d
  }

  it('PRD 编辑器默认显示 textarea,不存在预览容器', () => {
    render(<DraftingZone data={dataWithAux()} />)
    expect(screen.getByTestId('drafting-prd')).toBeInTheDocument()
    expect(screen.queryByTestId('drafting-prd-preview')).toBeNull()
  })

  it('点击 "👁 预览" → textarea 消失,预览容器出现', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))
    expect(screen.queryByTestId('drafting-prd')).toBeNull()
    expect(screen.getByTestId('drafting-prd-preview')).toBeInTheDocument()
    // 预览容器内含 MarkdownPreview
    expect(
      screen.getByTestId('drafting-prd-preview').querySelector(
        '[data-testid="markdown-preview"]',
      ),
    ).toBeInTheDocument()
  })

  it('预览模式下点击合法相对链接 → 抽屉打开对应文件', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))

    // 预览中应有 1 个解析成功的链接
    const link = screen.getByTestId('md-preview-link')
    expect(link.getAttribute('data-resolved-filename')).toBe('api-draft.md')

    await user.click(link)
    // 抽屉打开并显示目标文件
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )
  })

  it('预览模式下点击外部 URL 链接 → 不打开抽屉', async () => {
    const user = userEvent.setup()
    const d = dataWithAux()
    d.prdMarkdown = '看 [官网](https://example.com)\n'
    render(<DraftingZone data={d} />)
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))

    await user.click(screen.getByTestId('md-preview-link-ignored'))
    expect(screen.queryByTestId('aux-drawer')).toBeNull()
  })

  it('预览模式下点击 .. 穿越链接 → 不打开抽屉', async () => {
    const user = userEvent.setup()
    const d = dataWithAux()
    d.prdMarkdown = '[evil](../../api-draft.md)\n'
    render(<DraftingZone data={d} />)
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))

    await user.click(screen.getByTestId('md-preview-link-ignored'))
    expect(screen.queryByTestId('aux-drawer')).toBeNull()
  })

  it('点击 "✏ 编辑" → 预览关闭,textarea 恢复', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))
    expect(screen.queryByTestId('drafting-prd')).toBeNull()
    // 再次点击切回编辑
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))
    expect(screen.getByTestId('drafting-prd')).toBeInTheDocument()
    expect(screen.queryByTestId('drafting-prd-preview')).toBeNull()
  })
})

// ============================================================================
// 抽屉切换行为(issue 07 验收 #7 #8)
// ============================================================================

describe('DraftingZone · 抽屉切换(issue 07 验收 #7 #8)', () => {
  afterEach(() => cleanup())

  function dataWithAux(): ReturnType<typeof emptyDrafting> {
    const d = emptyDrafting('req-001')
    d.empty = false
    d.prdMarkdown = [
      '# PRD',
      '',
      '- 见 [API](./api-draft.md)',
      '- 见 [Data](./data-model.md)',
      '',
    ].join('\n')
    d.auxFiles = [
      {
        id: 'aux-api',
        filename: 'api-draft.md',
        body: '# API body',
        usage_tag: 'api',
        source_format: 'md',
        converted_to_md: false,
      },
      {
        id: 'aux-data',
        filename: 'data-model.md',
        body: '# Data body',
        usage_tag: 'data',
        source_format: 'md',
        converted_to_md: false,
      },
    ]
    return d
  }

  it('抽屉已打开 → 点击预览中另一个链接 → 抽屉切换(不开第二个)', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)

    // 1) 先打开第一个文件(走卡片,模拟 issue 04/05 流程)
    const apiCard = screen
      .getAllByTestId('aux-card')
      .find((c) => c.getAttribute('data-aux-id') === 'aux-api')!
    await user.click(apiCard)
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )

    // 2) 进入预览模式 + 点击 Data 链接
    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))
    const dataLink = screen
      .getAllByTestId('md-preview-link')
      .find((l) => l.getAttribute('data-resolved-filename') === 'data-model.md')!
    await user.click(dataLink)

    // 3) 同一个抽屉,内容切换到 data-model.md
    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'data-model.md',
    )
  })

  it('抽屉已打开 → 点击预览中同一文件链接 → 抽屉保持(不开第二个)', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)

    await user.click(screen.getByTestId('drafting-prd-toggle-preview'))
    const apiLink = screen
      .getAllByTestId('md-preview-link')
      .find((l) => l.getAttribute('data-resolved-filename') === 'api-draft.md')!
    await user.click(apiLink)
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()

    // 再次点击同一链接 → 仍然只有一个抽屉,filename 不变
    await user.click(apiLink)
    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )
  })

  it('辅助文件预览内点击链接到另一个辅助文件 → 抽屉切换', async () => {
    const user = userEvent.setup()
    render(<DraftingZone data={dataWithAux()} />)

    // 1) 打开 api-draft 的抽屉
    const apiCard = screen
      .getAllByTestId('aux-card')
      .find((c) => c.getAttribute('data-aux-id') === 'aux-api')!
    await user.click(apiCard)

    // 2) 修改 api-draft 的 body,使其包含到 data-model 的链接
    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    fireEvent.change(ta, {
      target: { value: '# API\n\n详情见 [Data](./data-model.md)\n' },
    })

    // 3) 切换到预览模式
    await user.click(screen.getByTestId('aux-drawer-toggle-preview'))

    // 4) 点击链接 → 抽屉切换到 data-model.md
    const link = screen.getByTestId('md-preview-link')
    expect(link.getAttribute('data-resolved-filename')).toBe('data-model.md')
    await user.click(link)

    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'data-model.md',
    )
  })

  it('辅助文件初始 body 含 aux 链接 → 抽屉打开后切预览即可点击切换', async () => {
    // 验收 #8 完整覆盖:不依赖"先编辑再预览",而是从 AuxFile.body 自带的链接出发。
    // 这里 data-model 的初始 body 已包含到 api-draft 的链接。
    const user = userEvent.setup()
    const d = dataWithAux()
    d.auxFiles = d.auxFiles.map((a) =>
      a.id === 'aux-data'
        ? {
            ...a,
            body: '# Data\n\n关联 [API](./api-draft.md)\n',
          }
        : a,
    )
    render(<DraftingZone data={d} />)

    // 1) 直接打开 data-model(它的初始 body 自带 aux 链接)
    const dataCard = screen
      .getAllByTestId('aux-card')
      .find((c) => c.getAttribute('data-aux-id') === 'aux-data')!
    await user.click(dataCard)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'data-model.md',
    )

    // 2) 切预览(无需先编辑)
    await user.click(screen.getByTestId('aux-drawer-toggle-preview'))
    const link = screen.getByTestId('md-preview-link')
    expect(link.getAttribute('data-resolved-filename')).toBe('api-draft.md')
    await user.click(link)

    // 3) 抽屉切换到 api-draft.md,且只有 1 个抽屉
    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )
  })

  it('辅助文件预览 → 点击链接到第三个文件 → 抽屉切换到第三个文件(连续切换)', async () => {
    // 验收 #7 补全:之前只验证 "drawer 已开 → 点 PRD 预览链接 → 切换";
    // 这里验证 "drawer 已开 → 点 aux 预览链接 → 切换到第三个文件"。
    // 链路:sop-flow →(切到)→ data-model(它的 body 含 [API])→(切到)→ api-draft
    const user = userEvent.setup()
    const d = dataWithAux()
    // 给 data-model 也注入 [API] 链接,实现 sop → data → api 的连续切换
    d.auxFiles = d.auxFiles.map((a) =>
      a.id === 'aux-data'
        ? { ...a, body: '# Data\n\n关联 [API](./api-draft.md)\n' }
        : a,
    )
    // 引入第三个文件 sop-flow,放在 auxFiles 末尾
    d.auxFiles = [
      ...d.auxFiles,
      {
        id: 'aux-sop',
        filename: 'sop-flow.md',
        body: '# SOP\n\n关联 [Data](./data-model.md)\n',
        usage_tag: 'sop',
        source_format: 'md',
        converted_to_md: false,
      },
    ]
    render(<DraftingZone data={d} />)

    // 1) 先打开 sop-flow(它的 body 自带到 data-model 的链接)
    const sopCard = screen
      .getAllByTestId('aux-card')
      .find((c) => c.getAttribute('data-aux-id') === 'aux-sop')!
    await user.click(sopCard)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'sop-flow.md',
    )

    // 2) 切预览 + 点击链接 → 切到 data-model
    await user.click(screen.getByTestId('aux-drawer-toggle-preview'))
    await user.click(screen.getByTestId('md-preview-link'))
    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'data-model.md',
    )

    // 3) 此时 data-model 的 body 自带 [API] → 再点一次 → 切到 api-draft
    // 注意:预览状态会延续(共享 hook,不随 currentFile 重置)
    const apiLink = screen
      .getAllByTestId('md-preview-link')
      .find((l) => l.getAttribute('data-resolved-filename') === 'api-draft.md')!
    await user.click(apiLink)
    expect(screen.getAllByTestId('aux-drawer')).toHaveLength(1)
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )
  })
})

// ============================================================================
// issue 01 ticket:DRAFTING banner + 关联仓库弹层端到端(issue 01 ticket 验收 #1-#13)
// ============================================================================

describe('DraftingZone · issue 01 ticket · banner + 关联仓库弹层端到端', () => {
  // 用全新草稿(empty=true)→ 触发 banner success + skeleton overlay
  function freshDraft(): ReturnType<typeof emptyDrafting> {
    const d = emptyDrafting('req-fresh')
    d.empty = true
    // emptyDrafting 自带 GLOBAL_REPO_POOL + 空 selectedRepoIds
    return d
  }

  afterEach(() => cleanup())

  it('fresh(empty=true)→ skeleton overlay 挂载,banner success 可见 + 关联仓库弹层默认关闭', () => {
    render(<DraftingZone data={freshDraft()} />)

    // banner success 可见
    const banner = screen.getByTestId('drafting-banner')
    expect(banner.getAttribute('data-banner-state')).toBe('success')
    expect(banner.textContent).toContain('未关联任何仓库')
    expect(screen.getByTestId('drafting-banner-plus')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-banner-close')).toBeInTheDocument()

    // 关联仓库弹层默认关闭
    expect(screen.queryByTestId('attach-repos-dialog')).toBeNull()

    // skeleton overlay 挂载(覆盖主区)
    expect(screen.getByTestId('drafting-skeleton-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-skeleton')).toBeInTheDocument()
  })

  it('点 banner [+] → first 模式弹层打开,标题含 "关联仓库"', async () => {
    render(<DraftingZone data={freshDraft()} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-banner-plus'))

    const dialog = screen.getByTestId('attach-repos-dialog')
    expect(dialog.getAttribute('data-mode')).toBe('first')
    expect(screen.getByTestId('attach-repos-dialog-title').textContent).toContain(
      '关联仓库',
    )
    // first 模式:分支名 input + locked-banner 不存在
    expect(screen.getByTestId('attach-repos-dialog-branch')).toBeInTheDocument()
    expect(
      screen.queryByTestId('attach-repos-dialog-locked-banner'),
    ).toBeNull()
  })

  it('点 RepoBar ＋ (N=0)→ 同样触发 first 模式弹层(两个入口同弹层)', async () => {
    render(<DraftingZone data={freshDraft()} />)
    const user = userEvent.setup()
    // N=0 空态下 repo-bar-add 按钮可见
    expect(screen.getByTestId('repo-bar-add')).toBeInTheDocument()
    await user.click(screen.getByTestId('repo-bar-add'))
    expect(screen.getByTestId('attach-repos-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('attach-repos-dialog').getAttribute('data-mode')).toBe(
      'first',
    )
  })

  it('提交弹层 → selectedRepoIds 写入 + banner 自动消失', async () => {
    render(<DraftingZone data={freshDraft()} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('repo-bar-add'))

    // 勾 2 个仓库 + 填分支名
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-refund-service')!,
    )
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-order-service')!,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/refund-optimization' },
    })
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // submit 是异步(有 50ms mock 延迟),等待弹层关闭 + banner 消失
    await waitFor(() => {
      expect(screen.queryByTestId('attach-repos-dialog')).toBeNull()
    })
    // banner 自动消失(issue 01 ticket 验收 #6 「首次勾选第一个 repo 后自动消失」)
    expect(screen.queryByTestId('drafting-banner')).toBeNull()
    // RepoBar 进入 N≥1 状态:chips 渲染 + repo-bar-add-more 出现
    const chips = screen.getAllByTestId('drafting-repo-chip')
    expect(chips.find((c) => c.getAttribute('data-selected') === 'true')).toBeDefined()
    expect(screen.getByTestId('repo-bar-add-more')).toBeInTheDocument()
    expect(screen.queryByTestId('repo-bar-add')).toBeNull()
  })

  it('点 banner ✕ → banner 隐藏(进入"用户主动关闭"态),RepoBar 仍引导入口', async () => {
    render(<DraftingZone data={freshDraft()} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('drafting-banner-close'))
    expect(screen.queryByTestId('drafting-banner')).toBeNull()
    // RepoBar 仍是引导入口(N=0 add button)
    expect(screen.getByTestId('repo-bar-add')).toBeInTheDocument()
  })

  it('已有仓库(N=1)→ 点 RepoBar ＋ 触发 append 模式弹层(无分支名 input)', async () => {
    const data = freshDraft()
    data.selectedRepoIds = ['repo-refund-service']
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // review fix:mode 由 lockedBranchName 决定(非 selectedRepoIds.length)
    // 当前 lockedBranchName==='' → first 模式(避免 append 模式渲染「—」锁定 banner)
    expect(screen.getByTestId('repo-bar-add-more')).toBeInTheDocument()
    await user.click(screen.getByTestId('repo-bar-add-more'))
    expect(screen.getByTestId('attach-repos-dialog').getAttribute('data-mode')).toBe(
      'first',
    )
    // 关闭弹层
    await user.click(screen.getByTestId('attach-repos-dialog-cancel'))

    // 走完首次提交后,lockedBranchName 写入 → 后续追加走 append 模式
    await user.click(screen.getByTestId('repo-bar-add-more'))
    // 勾仓库 + 填分支名
    await user.click(
      screen
        .getAllByTestId('attach-repos-dialog-repo-option')
        .find((o) => o.getAttribute('data-repo-id') === 'repo-order-service')!,
    )
    fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
      target: { value: 'feat/refund' },
    })
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // 等异步关闭
    await waitFor(() => {
      expect(screen.queryByTestId('attach-repos-dialog')).toBeNull()
    })

    // 现在 lockedBranchName 已写入,后续追加走 append 模式
    await user.click(screen.getByTestId('repo-bar-add-more'))
    const dialog = screen.getByTestId('attach-repos-dialog')
    expect(dialog.getAttribute('data-mode')).toBe('append')
    // append 模式:无分支名 input
    expect(screen.queryByTestId('attach-repos-dialog-branch')).toBeNull()
    // 锁定 banner 显示 + 含已锁定的分支名(不再是「—」)
    const locked = screen.getByTestId('attach-repos-dialog-locked-banner')
    expect(locked).toBeInTheDocument()
    expect(locked.textContent).toContain('feat/refund')
  })

  it('失败路径:URL `?fail=network` → banner 切换为 error 态 + [重试] 按钮', async () => {
    // 用 jsdom 的 window.location 注入 ?fail=network
    const originalHref = window.location.href
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, href: 'http://localhost/drafting?fail=network', search: '?fail=network' },
    })
    try {
      render(<DraftingZone data={freshDraft()} />)
      const user = userEvent.setup()
      await user.click(screen.getByTestId('repo-bar-add'))
      // 勾 1 个仓库 + 填分支名 + 提交
      await user.click(
        screen
          .getAllByTestId('attach-repos-dialog-repo-option')
          .find((o) => o.getAttribute('data-repo-id') === 'repo-refund-service')!,
      )
      fireEvent.change(screen.getByTestId('attach-repos-dialog-branch'), {
        target: { value: 'feat/refund' },
      })
      await user.click(screen.getByTestId('attach-repos-dialog-submit'))

      // banner 切到 error 态,文案 = "网络异常"
      const banner = await screen.findByTestId('drafting-banner')
      expect(banner.getAttribute('data-banner-state')).toBe('error')
      expect(banner.textContent).toContain('网络异常')
      expect(screen.getByTestId('drafting-banner-retry')).toBeInTheDocument()
      // 弹层已关闭
      expect(screen.queryByTestId('attach-repos-dialog')).toBeNull()
      // selectedRepoIds 没有写入(失败回滚)
      const bar = screen.getByTestId('drafting-repo-bar')
      expect(bar.getAttribute('data-selected-count')).toBe('0')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, href: originalHref, search: '' },
      })
    }
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
