import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuxFile } from '@ai-devspace/shared'
import { AuxFilesPane } from '../aux-files-pane'

// ============================================================================
// Fixture factory
// ============================================================================

function makeAux(overrides: Partial<AuxFile> = {}): AuxFile {
  return {
    id: 'aux-1',
    filename: 'api-draft.md',
    body: '# API 草案\n\n退款接口',
    usage_tag: 'api',
    source_format: 'md',
    converted_to_md: false,
    ...overrides,
  }
}

// ============================================================================
// 渲染(issue 04 验收 #1 #2 #7)
// ============================================================================

describe('AuxFilesPane · 渲染', () => {
  it('testid = aux-files-pane + 头部 + 网格', () => {
    render(<AuxFilesPane auxFiles={[makeAux()]} />)
    expect(screen.getByTestId('aux-files-pane')).toBeInTheDocument()
    expect(screen.getByTestId('aux-files-pane-head')).toBeInTheDocument()
    expect(screen.getByTestId('aux-files-grid')).toBeInTheDocument()
  })

  it('head 标题 "辅助材料" 存在', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    const head = screen.getByTestId('aux-files-pane-head')
    expect(head.textContent).toContain('辅助材料')
  })

  it('非空时 subtitle 显示文件数', () => {
    render(
      <AuxFilesPane
        auxFiles={[
          makeAux({ id: 'a', filename: 'a.md' }),
          makeAux({ id: 'b', filename: 'b.md' }),
          makeAux({ id: 'c', filename: 'c.md' }),
        ]}
      />,
    )
    const sub = screen.getByTestId('aux-files-pane-subtitle')
    expect(sub.textContent).toContain('3 个文件')
    expect(sub.textContent).toContain('全部为 md')
  })

  it('空态 subtitle 包含 "0 个文件"', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    const sub = screen.getByTestId('aux-files-pane-subtitle')
    expect(sub.textContent).toContain('0 个文件')
  })

  it('网格使用 grid-template-columns:repeat(auto-fill,minmax(180px,1fr))', () => {
    render(<AuxFilesPane auxFiles={[makeAux()]} />)
    const grid = screen.getByTestId('aux-files-grid') as HTMLElement
    expect(grid.style.gridTemplateColumns).toContain('180px')
    expect(grid.style.gridTemplateColumns).toContain('auto-fill')
  })
})

// ============================================================================
// 卡片网格(issue 04 验收 #1 #2)
// ============================================================================

describe('AuxFilesPane · 卡片网格', () => {
  it('每条 auxFiles 渲染为一张 aux-card', () => {
    const files = [
      makeAux({ id: 'a', filename: 'a.md' }),
      makeAux({ id: 'b', filename: 'b.md' }),
      makeAux({ id: 'c', filename: 'c.md' }),
    ]
    render(<AuxFilesPane auxFiles={files} />)
    const cards = screen.getAllByTestId('aux-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].getAttribute('data-aux-id')).toBe('a')
    expect(cards[1].getAttribute('data-aux-id')).toBe('b')
    expect(cards[2].getAttribute('data-aux-id')).toBe('c')
  })

  it('点击卡片 → onOpen(auxId) 被调', async () => {
    const onOpen = vi.fn()
    render(
      <AuxFilesPane
        auxFiles={[
          makeAux({ id: 'a', filename: 'a.md' }),
          makeAux({ id: 'b', filename: 'b.md' }),
        ]}
        onOpen={onOpen}
      />,
    )
    const user = userEvent.setup()
    const cards = screen.getAllByTestId('aux-card')
    await user.click(cards[1])
    expect(onOpen).toHaveBeenCalledWith('b')
  })

  it('data-card-count 与 auxFiles.length 一致', () => {
    render(
      <AuxFilesPane
        auxFiles={[
          makeAux({ id: 'a' }),
          makeAux({ id: 'b' }),
          makeAux({ id: 'c' }),
          makeAux({ id: 'd' }),
        ]}
      />,
    )
    expect(
      screen.getByTestId('aux-files-pane').getAttribute('data-card-count'),
    ).toBe('4')
  })
})

// ============================================================================
// 空态(issue 04 验收 #7)
// ============================================================================

describe('AuxFilesPane · 空态', () => {
  it('auxFiles = [] → 渲染 EmptyAuxPlaceholder', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    expect(screen.getByTestId('aux-empty-placeholder')).toBeInTheDocument()
    expect(screen.queryAllByTestId('aux-card')).toHaveLength(0)
  })

  it('空态 data-empty = "true"', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    expect(
      screen.getByTestId('aux-files-pane').getAttribute('data-empty'),
    ).toBe('true')
  })

  it('点击占位卡 → onCreate 被调', async () => {
    const onCreate = vi.fn()
    render(<AuxFilesPane auxFiles={[]} onCreate={onCreate} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-empty-placeholder'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// 可访问性
// ============================================================================

describe('AuxFilesPane · 可访问性', () => {
  it('面板带 aria-label', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    expect(
      screen.getByTestId('aux-files-pane').getAttribute('aria-label'),
    ).toBe('辅助文件')
  })

  it('head 包含 actions slot(testid=aux-files-pane-actions 存在)', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    expect(screen.getByTestId('aux-files-pane-actions')).toBeInTheDocument()
  })
})

// ============================================================================
// 头部创建/上传按钮(issue 06 验收 #1)
// ============================================================================

describe('AuxFilesPane · 头部按钮(issue 06)', () => {
  it('渲染 "＋ 新建" 与 "📁 上传" 两个按钮', () => {
    render(
      <AuxFilesPane
        auxFiles={[]}
        onCreateClick={() => {}}
        onUpload={() => {}}
      />,
    )
    expect(screen.getByTestId('aux-files-pane-create')).toBeInTheDocument()
    expect(screen.getByTestId('aux-files-pane-upload')).toBeInTheDocument()
    expect(screen.getByTestId('aux-files-pane-create').textContent).toContain('新建')
    expect(screen.getByTestId('aux-files-pane-upload').textContent).toContain('上传')
  })

  it('头部包含一个隐藏的 <input type="file" accept=".md,.docx,.pdf">', () => {
    render(<AuxFilesPane auxFiles={[]} onUpload={() => {}} />)
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    expect(input.type).toBe('file')
    // 多 mime 拼接时 jest-dom 不会自动 lowercase;断言等于已知字符串
    expect(input.getAttribute('accept')).toBe('.md,.docx,.pdf')
  })

  it('点击 "＋ 新建" → onCreateClick 被调一次', async () => {
    const onCreateClick = vi.fn()
    render(
      <AuxFilesPane
        auxFiles={[]}
        onCreateClick={onCreateClick}
        onUpload={() => {}}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-files-pane-create'))
    expect(onCreateClick).toHaveBeenCalledTimes(1)
  })

  it('点击 "📁 上传" → 触发 <input type=file>.click()(隐藏 input 仍然存在)', async () => {
    // jsdom 不实现 input.click() 的真实"打开系统对话框"行为,所以这里断言:
    // 1) 点击 upload 按钮不抛错
    // 2) 隐藏的 file input 仍然可被后续 change 事件选中 → onUpload 被调
    const onUpload = vi.fn()
    render(
      <AuxFilesPane
        auxFiles={[makeAux()]}
        onCreateClick={() => {}}
        onUpload={onUpload}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-files-pane-upload'))
    // 直接通过 fireEvent 触发 change,模拟用户在文件选择对话框中选了文件
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    const file = new File(['# hi'], 'note.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(onUpload).toHaveBeenCalledWith(file)
  })

  it('不传 onCreateClick / onUpload → 按钮 disabled(只读场景)', () => {
    render(<AuxFilesPane auxFiles={[]} />)
    expect(screen.getByTestId('aux-files-pane-create')).toBeDisabled()
    expect(screen.getByTestId('aux-files-pane-upload')).toBeDisabled()
  })

  it('change 后 input.value 自动重置 → 连续选同一文件能再次触发', () => {
    const onUpload = vi.fn()
    render(
      <AuxFilesPane
        auxFiles={[]}
        onCreateClick={() => {}}
        onUpload={onUpload}
      />,
    )
    const input = screen.getByTestId(
      'aux-files-pane-upload-input',
    ) as HTMLInputElement
    const file = new File(['a'], 'note.md', { type: 'text/markdown' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledTimes(1)
    // 第二次选同一个文件
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledTimes(2)
    // value 已被重置为空字符串
    expect(input.value).toBe('')
  })
})