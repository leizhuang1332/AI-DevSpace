import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuxFile } from '@ai-devspace/shared'
import { MarkdownPreview } from '../markdown-preview'

// ============================================================================
// Fixture:典型 Requirement 的辅助文件清单(用于 resolveAuxLink 匹配)
// ============================================================================

const auxFiles: AuxFile[] = [
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
  {
    id: 'aux-sop',
    filename: 'sop.docx', // 非 .md —— 解析器应忽略
    body: 'x',
    usage_tag: 'sop',
    source_format: 'docx',
    converted_to_md: true,
  },
]

afterEach(() => cleanup())

// ============================================================================
// 基础渲染(issue 07 验收 #1):标题 / 段落 / 列表 / 代码块 / 链接
// ============================================================================

describe('MarkdownPreview · 块级渲染(issue 07 验收 #1)', () => {
  it('空 markdown → 不渲染任何 block,但容器存在', () => {
    render(
      <MarkdownPreview
        markdown=""
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('md-preview-heading')).toBeNull()
    expect(screen.queryByTestId('md-preview-paragraph')).toBeNull()
    expect(screen.queryByTestId('md-preview-list')).toBeNull()
    expect(screen.queryByTestId('md-preview-code')).toBeNull()
  })

  it('H1 / H2 / H3 各自正确渲染并标注 level', () => {
    const md = '# H1 标题\n\n## H2 标题\n\n### H3 标题\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    const headings = screen.getAllByTestId('md-preview-heading')
    expect(headings.map((h) => h.textContent)).toEqual([
      'H1 标题',
      'H2 标题',
      'H3 标题',
    ])
    expect(headings.map((h) => h.getAttribute('data-heading-level'))).toEqual([
      '1',
      '2',
      '3',
    ])
  })

  it('H4 及更深不渲染(预览只到 H3,锚点条同理)', () => {
    const md = '#### H4 忽略\n##### H5 忽略\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    expect(screen.queryByTestId('md-preview-heading')).toBeNull()
  })

  it('段落渲染为 <p>(连续非空行合并)', () => {
    const md = '第一段\n继续第一段\n\n第二段\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    const paras = screen.getAllByTestId('md-preview-paragraph')
    expect(paras).toHaveLength(2)
    // 连续行合并 → 第一段不应包含单独换行
    expect(paras[0].textContent).toContain('继续第一段')
    expect(paras[0].textContent).not.toContain('第二段')
  })

  it('无序列表渲染为 <ul><li>(含 - [ ] / - [x] 任务项)', () => {
    const md = '- item 1\n- item 2\n- [ ] todo 1\n- [x] done\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    const list = screen.getByTestId('md-preview-list')
    expect(list.tagName.toLowerCase()).toBe('ul')
    const items = list.querySelectorAll('li')
    expect(items).toHaveLength(4)
    expect(items[0].textContent).toBe('item 1')
    expect(items[2].textContent).toBe('todo 1')
    expect(items[3].textContent).toBe('done')
  })

  it('fenced 代码块 正确捕获 language + body', () => {
    const md = '```json\n{"k":"v"}\n```\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    const code = screen.getByTestId('md-preview-code')
    expect(code.getAttribute('data-code-lang')).toBe('json')
    expect(code.textContent).toContain('{"k":"v"}')
  })

  it('inline code 在段落中用 <code> 包裹', () => {
    const md = '这是 `inline code` 测试\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    const para = screen.getByTestId('md-preview-paragraph')
    const codeEl = para.querySelector('code')
    expect(codeEl).not.toBeNull()
    expect(codeEl?.textContent).toBe('inline code')
  })
})

// ============================================================================
// 链接解析 — 命中已知辅助文件(issue 07 验收 #2)
// ============================================================================

describe('MarkdownPreview · 链接解析(issue 07 验收 #2)', () => {
  it('合法相对路径 → 渲染为 <button>,点击 → onAuxLinkClick(target)', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    const md = '参考 [API 草案](./api-draft.md)\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    const link = screen.getByTestId('md-preview-link')
    expect(link.tagName.toLowerCase()).toBe('button')
    expect(link.getAttribute('data-link-target')).toBe('./api-draft.md')
    expect(link.getAttribute('data-resolved-filename')).toBe('api-draft.md')
    expect(link.getAttribute('data-resolved-id')).toBe('aux-api')
    await user.click(link)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(auxFiles[0])
  })

  it('嵌套路径如 [x](./sub/data-model.md) → 解析到 basename,命中 data-model.md', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    const md = '见 [数据字典](./sub/data-model.md)\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    const link = screen.getByTestId('md-preview-link')
    expect(link.getAttribute('data-resolved-filename')).toBe('data-model.md')
    expect(link.getAttribute('data-resolved-id')).toBe('aux-data')
    await user.click(link)
    expect(onClick).toHaveBeenCalledWith(auxFiles[1])
  })

  it('多个有效链接共存 → 每个都成为独立可点击按钮', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    const md = '见 [A](./api-draft.md) 与 [B](./data-model.md)\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    const links = screen.getAllByTestId('md-preview-link')
    expect(links).toHaveLength(2)
    await user.click(links[0])
    await user.click(links[1])
    expect(onClick).toHaveBeenCalledTimes(2)
    expect(onClick.mock.calls[0][0]).toBe(auxFiles[0])
    expect(onClick.mock.calls[1][0]).toBe(auxFiles[1])
  })

  it('链接文本出现在按钮里(用户可见)', () => {
    render(
      <MarkdownPreview
        markdown={'参考 [API 草案](./api-draft.md) 内容\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={() => {}}
      />,
    )
    expect(screen.getByTestId('md-preview-link').textContent).toBe('API 草案')
  })
})

// ============================================================================
// 链接解析 — 各种"忽略"路径(issue 07 验收 #3 #4 #5 #6)
// ============================================================================

describe('MarkdownPreview · 链接解析 truth table(issue 07 验收 #3-#6 #9)', () => {
  afterEach(() => cleanup())

  function getIgnoredLink(md: string): HTMLElement | null {
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={() => {}}
      />,
    )
    return screen.queryByTestId('md-preview-link-ignored')
  }

  it('fragment-only 链接(#section)→ 纯文本,不调用 onAuxLinkClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <MarkdownPreview
        markdown={'跳到 [背景](#背景)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    const span = screen.getByTestId('md-preview-link-ignored')
    expect(span.tagName.toLowerCase()).toBe('span')
    expect(span.getAttribute('data-link-target')).toBe('#背景')
    expect(span.textContent).toBe('背景')
    await user.click(span)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('外部 URL(http://) → 纯文本,不调用 onAuxLinkClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <MarkdownPreview
        markdown={'看 [官网](https://example.com)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    const span = screen.getByTestId('md-preview-link-ignored')!
    await user.click(span)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('mailto: 链接 → 纯文本,不调用 onAuxLinkClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <MarkdownPreview
        markdown={'写信给 [我](mailto:a@b.c)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    await user.click(screen.getByTestId('md-preview-link-ignored')!)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('.. 路径穿越(指向已知辅助文件) → 纯文本', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <MarkdownPreview
        markdown={'[evil](../../api-draft.md)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    await user.click(screen.getByTestId('md-preview-link-ignored')!)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('子路径中含 .. 段(如 subdir/../api-draft.md) → 纯文本', async () => {
    const onClick = vi.fn()
    render(
      <MarkdownPreview
        markdown={'[x](subdir/../api-draft.md)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(screen.getByTestId('md-preview-link-ignored')).toBeInTheDocument()
  })

  it('绝对路径(/etc/passwd) → 纯文本', async () => {
    const onClick = vi.fn()
    render(
      <MarkdownPreview
        markdown={'[x](/etc/passwd)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(screen.getByTestId('md-preview-link-ignored')).toBeInTheDocument()
  })

  it('目标指向非 Markdown 文件(.docx)→ 纯文本(尽管文件存在于 auxFiles)', async () => {
    const onClick = vi.fn()
    render(
      <MarkdownPreview
        markdown={'[sop](./sop.docx)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(screen.getByTestId('md-preview-link-ignored')).toBeInTheDocument()
  })

  it('目标指向不存在的辅助文件 → 纯文本', async () => {
    const onClick = vi.fn()
    render(
      <MarkdownPreview
        markdown={'[ghost](./ghost.md)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(screen.getByTestId('md-preview-link-ignored')).toBeInTheDocument()
  })

  it('空链接文本(target 为空)→ 不渲染为可点击链接', () => {
    // 当前 inline-link 正则要求 target 非空,所以 `[empty]()` 会作为纯文本
    // ("empty" 字符)走通。不强求结果形式,只要求"不会调用 onAuxLinkClick"。
    const onClick = vi.fn()
    render(
      <MarkdownPreview
        markdown={'[empty]()\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('混合:同一段里有效链接 + 外部 + fragment + 缺失文件 → 各按各自规则', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    const md =
      '[good](./api-draft.md) [bad http](https://x) [frag](#sec) [missing](./ghost.md)\n'
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    // 1 个有效
    expect(screen.getAllByTestId('md-preview-link')).toHaveLength(1)
    // 3 个被忽略
    expect(screen.getAllByTestId('md-preview-link-ignored')).toHaveLength(3)

    await user.click(screen.getByTestId('md-preview-link'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(auxFiles[0])
  })
})

// ============================================================================
// currentFile 语义(issue 01 注释:currentFile 不参与匹配,只作为接口锚点)
// ============================================================================

describe('MarkdownPreview · currentFile 形参', () => {
  it('currentFile 不同时,有效链接的解析结果一致', () => {
    const { rerender } = render(
      <MarkdownPreview
        markdown={'[x](./api-draft.md)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
        onAuxLinkClick={() => {}}
      />,
    )
    expect(screen.getByTestId('md-preview-link')).toBeInTheDocument()
    rerender(
      <MarkdownPreview
        markdown={'[x](./api-draft.md)\n'}
        currentFile="some-other.md"
        auxFiles={auxFiles}
        onAuxLinkClick={() => {}}
      />,
    )
    expect(screen.getByTestId('md-preview-link')).toBeInTheDocument()
  })

  it('data-current-file 属性反映 currentFile', () => {
    render(
      <MarkdownPreview
        markdown="hello"
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    expect(screen.getByTestId('markdown-preview').getAttribute('data-current-file')).toBe('PRD.md')
  })
})

// ============================================================================
// 辅助文件链接到辅助文件(issue 07 验收 #8 — aux files can link to aux files)
// ============================================================================

describe('MarkdownPreview · aux 文件预览(issue 07 验收 #8)', () => {
  it('当 currentFile 是某个 aux 的 filename,链接到另一个 aux 仍能解析', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    const md = '详情见 [API](./api-draft.md)\n'
    // 模拟"在 data-model.md 的预览里":currentFile 是 data-model.md
    render(
      <MarkdownPreview
        markdown={md}
        currentFile="data-model.md"
        auxFiles={auxFiles}
        onAuxLinkClick={onClick}
      />,
    )
    const link = screen.getByTestId('md-preview-link')
    expect(link.getAttribute('data-resolved-filename')).toBe('api-draft.md')
    await user.click(link)
    expect(onClick).toHaveBeenCalledWith(auxFiles[0])
  })
})

// ============================================================================
// 无 onAuxLinkClick 时的退化行为 — 链接降级为纯文本(避免抛出)
// ============================================================================

describe('MarkdownPreview · onAuxLinkClick 缺失时', () => {
  it('即使匹配成功,也不渲染按钮(避免 callback undefined → crash)', () => {
    render(
      <MarkdownPreview
        markdown={'[x](./api-draft.md)\n'}
        currentFile="PRD.md"
        auxFiles={auxFiles}
      />,
    )
    expect(screen.queryByTestId('md-preview-link')).toBeNull()
    expect(screen.getByTestId('md-preview-link-ignored')).toBeInTheDocument()
  })
})