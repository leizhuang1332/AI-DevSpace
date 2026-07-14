import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuxFile, UsageTag } from '@ai-devspace/shared'
import { AuxFileCard } from '../aux-file-card'

// ============================================================================
// Fixture factory
// ============================================================================

function makeAux(overrides: Partial<AuxFile> = {}): AuxFile {
  return {
    id: 'aux-1',
    filename: 'api-draft.md',
    body: '# API 草案\n\n退款接口草案',
    usage_tag: 'api',
    source_format: 'md',
    converted_to_md: false,
    ...overrides,
  }
}

// ============================================================================
// 渲染(issue 04 验收 #2)
// ============================================================================

describe('AuxFileCard · 渲染', () => {
  it('根节点 testid = aux-card,带上 data-aux-id', () => {
    render(<AuxFileCard aux={makeAux({ id: 'aux-xyz' })} />)
    const card = screen.getByTestId('aux-card')
    expect(card).toBeInTheDocument()
    expect(card.getAttribute('data-aux-id')).toBe('aux-xyz')
  })

  it('渲染 filename', () => {
    render(<AuxFileCard aux={makeAux({ filename: 'data-model.md' })} />)
    const filename = screen.getByTestId('aux-card-filename')
    expect(filename).toBeInTheDocument()
    expect(filename.textContent).toBe('data-model.md')
  })

  it('渲染 source_format chip', () => {
    render(
      <AuxFileCard aux={makeAux({ source_format: 'docx' })} />,
    )
    const format = screen.getByTestId('aux-card-format')
    expect(format).toBeInTheDocument()
    expect(format.textContent).toBe('docx')
  })

  it('渲染 body 预览(首个非标题非空行)', () => {
    render(
      <AuxFileCard
        aux={makeAux({ body: '# 标题\n\n退款接口草案 · 第 1 版' })}
      />,
    )
    const preview = screen.getByTestId('aux-card-preview')
    expect(preview).toBeInTheDocument()
    expect(preview.textContent).toBe('退款接口草案 · 第 1 版')
  })

  it('body 全是标题行 → 预览为空(不渲染 preview 节点)', () => {
    render(
      <AuxFileCard
        aux={makeAux({ body: '# 标题 1\n## 标题 2\n### 标题 3' })}
      />,
    )
    expect(screen.queryByTestId('aux-card-preview')).toBeNull()
  })
})

// ============================================================================
// Usage tag → icon + label(issue 04 验收 #2)
// ============================================================================

describe('AuxFileCard · usage_tag 映射', () => {
  const tagCases: { tag: UsageTag; icon: string; label: string }[] = [
    { tag: 'api', icon: '📐', label: 'API 草案' },
    { tag: 'data', icon: '📊', label: '数据字典' },
    { tag: 'research', icon: '📑', label: '调研' },
    { tag: 'sop', icon: '📄', label: 'SOP' },
    { tag: 'ui', icon: '🎨', label: 'UI 草图' },
    { tag: 'other', icon: '📎', label: '其他' },
  ]

  for (const { tag, icon, label } of tagCases) {
    it(`${tag} → icon=${icon}, label=${label}`, () => {
      render(<AuxFileCard aux={makeAux({ usage_tag: tag })} />)
      const iconEl = screen.getByTestId('aux-card-icon')
      expect(iconEl.textContent).toBe(icon)
      const tagEl = screen.getByTestId('aux-card-usage-tag')
      expect(tagEl.textContent).toBe(label)
      expect(tagEl.getAttribute('data-usage-label')).toBe(label)
      expect(
        screen.getByTestId('aux-card').getAttribute('data-usage-tag'),
      ).toBe(tag)
    })
  }
})

// ============================================================================
// converted_to_md 指示(issue 04 mock 转换验收)
// ============================================================================

describe('AuxFileCard · converted_to_md 标识', () => {
  it('converted_to_md=true → 显示 "↻ 已转 MD"', () => {
    render(
      <AuxFileCard
        aux={makeAux({ source_format: 'docx', converted_to_md: true })}
      />,
    )
    const converted = screen.getByTestId('aux-card-converted')
    expect(converted).toBeInTheDocument()
    expect(converted.textContent).toContain('已转 MD')
  })

  it('converted_to_md=false → 不显示 "↻ 已转 MD"', () => {
    render(
      <AuxFileCard
        aux={makeAux({ source_format: 'md', converted_to_md: false })}
      />,
    )
    expect(screen.queryByTestId('aux-card-converted')).toBeNull()
  })
})

// ============================================================================
// 交互(issue 04 占位 onOpen 回调 → issue 05 抽屉)
// ============================================================================

describe('AuxFileCard · 交互', () => {
  it('点击卡片 → 调用 onOpen(id)', async () => {
    const onOpen = vi.fn()
    render(
      <AuxFileCard aux={makeAux({ id: 'aux-42' })} onOpen={onOpen} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-card'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('aux-42')
  })

  it('键盘 Enter → 调用 onOpen(id)', async () => {
    const onOpen = vi.fn()
    render(
      <AuxFileCard aux={makeAux({ id: 'aux-42' })} onOpen={onOpen} />,
    )
    const user = userEvent.setup()
    const card = screen.getByTestId('aux-card')
    card.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('aux-42')
  })

  it('键盘 Space → 调用 onOpen(id)', async () => {
    const onOpen = vi.fn()
    render(
      <AuxFileCard aux={makeAux({ id: 'aux-42' })} onOpen={onOpen} />,
    )
    const user = userEvent.setup()
    const card = screen.getByTestId('aux-card')
    card.focus()
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledWith('aux-42')
  })

  it('不传 onOpen → 卡片不可交互(role/tabindex 退化)', () => {
    render(<AuxFileCard aux={makeAux()} />)
    const card = screen.getByTestId('aux-card')
    expect(card.getAttribute('role')).toBeNull()
    expect(card.getAttribute('tabindex')).toBe('-1')
  })

  it('aria-label 包含 usage tag label 与 filename', () => {
    render(
      <AuxFileCard
        aux={makeAux({ usage_tag: 'data', filename: 'data-model.md' })}
      />,
    )
    const card = screen.getByTestId('aux-card')
    expect(card.getAttribute('aria-label')).toContain('数据字典')
    expect(card.getAttribute('aria-label')).toContain('data-model.md')
  })
})