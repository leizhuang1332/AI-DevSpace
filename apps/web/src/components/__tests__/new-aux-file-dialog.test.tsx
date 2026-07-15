import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UsageTag } from '@ai-devspace/shared'
import { NewAuxFileDialog } from '../new-aux-file-dialog'

// ============================================================================
// Fixture
// ============================================================================

const ALL_TAGS: UsageTag[] = [
  'api',
  'data',
  'research',
  'sop',
  'ui',
  'other',
]

function renderDialog(props: Partial<React.ComponentProps<typeof NewAuxFileDialog>> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const utils = render(
    <NewAuxFileDialog
      open
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  )
  return { onSubmit, onClose, ...utils }
}

// ============================================================================
// 渲染条件
// ============================================================================

describe('NewAuxFileDialog · 渲染(issue 06 验收 #2)', () => {
  it('open=false → 不渲染任何 DOM', () => {
    const { container } = render(
      <NewAuxFileDialog open={false} onSubmit={() => {}} onClose={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('open=true → 渲染 backdrop + dialog + title', () => {
    renderDialog()
    expect(screen.getByTestId('new-aux-dialog-backdrop')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog-title')).toHaveTextContent('新建辅助文件')
  })

  it('dialog role=dialog + aria-modal=true + aria-labelledby 指向标题', () => {
    renderDialog()
    const dialog = screen.getByTestId('new-aux-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = document.getElementById(labelledBy as string)
    expect(heading).not.toBeNull()
    expect(heading?.getAttribute('data-testid')).toBe('new-aux-dialog-title')
  })

  it('包含 filename 输入框 + 6 个 usage_tag 单选', () => {
    renderDialog()
    expect(screen.getByTestId('new-aux-dialog-filename')).toBeInTheDocument()
    expect(screen.getByTestId('new-aux-dialog-tags')).toBeInTheDocument()
    for (const tag of ALL_TAGS) {
      expect(
        screen.getByTestId(`new-aux-dialog-tag-${tag}`),
      ).toBeInTheDocument()
    }
  })

  it('默认选中 api(issue 06 验收:默认 tag = api)', () => {
    renderDialog()
    const api = screen.getByTestId('new-aux-dialog-tag-api')
    expect(api.getAttribute('aria-checked')).toBe('true')
    expect(api.getAttribute('data-selected')).toBe('true')
  })
})

// ============================================================================
// filename 自动补 .md(issue 06 验收 #2:创建的是 Markdown 文件)
// ============================================================================

describe('NewAuxFileDialog · filename 自动补 .md', () => {
  it('输入无扩展名 → preview 显示带 .md 的最终文件名', () => {
    renderDialog()
    const input = screen.getByTestId(
      'new-aux-dialog-filename',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'refund-api' } })
    const preview = screen.getByTestId('new-aux-dialog-filename-preview')
    expect(preview.textContent).toContain('refund-api.md')
  })

  it('输入已含 .md → 不重复补', () => {
    renderDialog()
    const input = screen.getByTestId(
      'new-aux-dialog-filename',
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'refund-api.md' } })
    const preview = screen.getByTestId('new-aux-dialog-filename-preview')
    expect(preview.textContent).toContain('refund-api.md')
    expect(preview.textContent).not.toContain('.md.md')
  })
})

// ============================================================================
// usage_tag 单选(6 种受控枚举)
// ============================================================================

describe('NewAuxFileDialog · usage_tag 选择', () => {
  for (const tag of ALL_TAGS) {
    it(`点击 "${tag}" → 该单选 aria-checked=true,其它都 false`, async () => {
      renderDialog()
      const user = userEvent.setup()
      await user.click(screen.getByTestId(`new-aux-dialog-tag-${tag}`))
      for (const t of ALL_TAGS) {
        const expectSelected = t === tag
        expect(
          screen
            .getByTestId(`new-aux-dialog-tag-${t}`)
            .getAttribute('aria-checked'),
        ).toBe(expectSelected ? 'true' : 'false')
      }
    })
  }
})

// ============================================================================
// 提交 / onSubmit(issue 06 验收 #2)
// ============================================================================

describe('NewAuxFileDialog · 提交', () => {
  it('filename 空 → 提交按钮 disabled', () => {
    renderDialog()
    expect(screen.getByTestId('new-aux-dialog-submit')).toBeDisabled()
  })

  it('填 filename + 选 sop + 点 "创建" → onSubmit 收到正确 {filename(.md), usage_tag}', async () => {
    const { onSubmit } = renderDialog()
    const user = userEvent.setup()

    fireEvent.change(
      screen.getByTestId('new-aux-dialog-filename'),
      { target: { value: 'refund-sop' } },
    )
    await user.click(screen.getByTestId('new-aux-dialog-tag-sop'))
    await user.click(screen.getByTestId('new-aux-dialog-submit'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      filename: 'refund-sop.md',
      usage_tag: 'sop',
    })
  })

  it('form submit(Enter 在 input)→ onSubmit 收到结果', async () => {
    const { onSubmit } = renderDialog()
    const user = userEvent.setup()

    fireEvent.change(
      screen.getByTestId('new-aux-dialog-filename'),
      { target: { value: 'data-model.md' } },
    )
    // 默认 tag = api 不点
    const input = screen.getByTestId('new-aux-dialog-filename')
    input.focus()
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledWith({
      filename: 'data-model.md',
      usage_tag: 'api',
    })
  })

  it('whitespace-only filename → 按钮 disabled', () => {
    renderDialog()
    fireEvent.change(
      screen.getByTestId('new-aux-dialog-filename'),
      { target: { value: '   ' } },
    )
    expect(screen.getByTestId('new-aux-dialog-submit')).toBeDisabled()
  })
})

// ============================================================================
// 关闭路径
// ============================================================================

describe('NewAuxFileDialog · 关闭路径', () => {
  it('点击 ✕ → onClose 被调', async () => {
    const { onClose } = renderDialog()
    await userEvent.setup().click(screen.getByTestId('new-aux-dialog-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点 "取消" → onClose 被调', async () => {
    const { onClose } = renderDialog()
    await userEvent.setup().click(screen.getByTestId('new-aux-dialog-cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape → onClose 被调', async () => {
    const { onClose } = renderDialog()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点 backdrop(空白处)→ onClose 被调', async () => {
    const { onClose } = renderDialog()
    const user = userEvent.setup()
    // mousedown 在 backdrop 上(不是 dialog 本体)
    fireEvent.mouseDown(screen.getByTestId('new-aux-dialog-backdrop'))
    await user.click(screen.getByTestId('new-aux-dialog-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// errorMessage(冲突 / 错误提示)
// ============================================================================

describe('NewAuxFileDialog · errorMessage', () => {
  it('errorMessage=null → 不渲染 alert 节点', () => {
    renderDialog({ errorMessage: null })
    expect(screen.queryByTestId('new-aux-dialog-error')).toBeNull()
  })

  it('errorMessage 字符串 → 渲染 alert + 文本内容', () => {
    renderDialog({ errorMessage: '已存在同名文件 "a.md",请换一个文件名。' })
    const alert = screen.getByTestId('new-aux-dialog-error')
    expect(alert).toBeInTheDocument()
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('已存在同名文件')
  })
})

// ============================================================================
// 打开时 reset
// ============================================================================

describe('NewAuxFileDialog · 打开时 reset', () => {
  it('同实例 open 切换:false → true 清空之前输入', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <NewAuxFileDialog open onSubmit={onSubmit} onClose={onClose} />,
    )
    fireEvent.change(
      screen.getByTestId('new-aux-dialog-filename'),
      { target: { value: 'old-name' } },
    )
    // 关闭 → 重渲染为 closed
    rerender(
      <NewAuxFileDialog open={false} onSubmit={onSubmit} onClose={onClose} />,
    )
    // 再次打开
    rerender(
      <NewAuxFileDialog open onSubmit={onSubmit} onClose={onClose} />,
    )
    const input = screen.getByTestId(
      'new-aux-dialog-filename',
    ) as HTMLInputElement
    expect(input.value).toBe('')
  })
})
