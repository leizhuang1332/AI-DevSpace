import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuxFile, UsageTag } from '@ai-devspace/shared'
import { AuxDrawer } from '../aux-drawer'

// ============================================================================
// Fixture factory
// ============================================================================

function makeAux(overrides: Partial<AuxFile> = {}): AuxFile {
  return {
    id: 'aux-1',
    filename: 'api-draft.md',
    body: '# 退款 API 草案\n\n## POST /refunds',
    usage_tag: 'api',
    source_format: 'md',
    converted_to_md: false,
    ...overrides,
  }
}

const tagIconMap: Record<UsageTag, string> = {
  api: '📐',
  data: '📊',
  research: '📑',
  sop: '📄',
  ui: '🎨',
  other: '📎',
}

// ============================================================================
// 渲染条件(issue 05 验收 #1, #5 锚点)
// ============================================================================

describe('AuxDrawer · 渲染条件', () => {
  afterEach(() => cleanup())

  it('openAuxId=null → 不渲染抽屉 DOM', () => {
    render(
      <AuxDrawer
        openAuxId={null}
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.queryByTestId('aux-drawer-backdrop')).toBeNull()
    expect(screen.queryByTestId('aux-drawer')).toBeNull()
  })

  it('openAuxId=<id> → 渲染 backdrop + drawer', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', filename: 'api-draft.md' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer-backdrop')).toBeInTheDocument()
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
  })

  it('openAuxId 指向不存在的 aux id → 抽屉不渲染(防御性)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-ghost"
        auxFiles={[makeAux({ id: 'aux-1' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.queryByTestId('aux-drawer')).toBeNull()
  })

  it('drawer 头部显示文件 icon / filename / meta 行', () => {
    const file = makeAux({
      id: 'aux-1',
      filename: 'api-draft.md',
      usage_tag: 'api',
      source_format: 'md',
      body: '# API 草案',
    })
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[file]}
        auxBodies={{ 'aux-1': file.body }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer-icon').textContent).toBe(
      tagIconMap[file.usage_tag],
    )
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe(
      'api-draft.md',
    )
    // meta 行包含 source_format
    expect(screen.getByTestId('aux-drawer-meta').textContent).toContain('md')
  })

  it('drawer 头包含可见的 ✕ 关闭按钮', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const closeBtn = screen.getByTestId('aux-drawer-close')
    expect(closeBtn).toBeInTheDocument()
    expect(closeBtn.textContent).toContain('关闭')
  })
})

// ============================================================================
// 60% 宽度 + min/max width(issue 05 验收 #2)
// ============================================================================

describe('AuxDrawer · 宽度约束', () => {
  afterEach(() => cleanup())

  it('drawer root 上有 inline style,width=60%', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const drawer = screen.getByTestId('aux-drawer')
    const style = (drawer as HTMLElement).style
    expect(style.width).toBe('60%')
    expect(style.minWidth).toBeTruthy()
    expect(style.maxWidth).toBeTruthy()
  })

  it('min-width ≥ 480px(保证抽屉不塌缩)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const drawer = screen.getByTestId('aux-drawer')
    const minWidth = parseInt(
      (drawer as HTMLElement).style.minWidth || '0',
      10,
    )
    expect(minWidth).toBeGreaterThanOrEqual(480)
  })

  it('max-width ≤ 880px(避免抽屉过宽)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const drawer = screen.getByTestId('aux-drawer')
    const maxWidth = parseInt(
      (drawer as HTMLElement).style.maxWidth || '0',
      10,
    )
    expect(maxWidth).toBeLessThanOrEqual(880)
  })
})

// ============================================================================
// 关闭路径(issue 05 验收 #3 #4 #11)
// ============================================================================

describe('AuxDrawer · 关闭路径', () => {
  afterEach(() => cleanup())

  it('点击 backdrop → onClose 被调一次', async () => {
    const onClose = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={onClose}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-drawer-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击 drawer 内部(内容区)→ 不触发 onClose', async () => {
    const onClose = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={onClose}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const user = userEvent.setup()
    // 点 drawer pane 主体 → 不应冒泡到 backdrop
    await user.click(screen.getByTestId('aux-drawer-pane'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点击头部 ✕ 关闭按钮 → onClose 被调一次', async () => {
    const onClose = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={onClose}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-drawer-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按 Escape → onClose 被调一次', async () => {
    const onClose = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={onClose}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const user = userEvent.setup()
    // 任意元素聚焦后按 Escape
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('✕ 关闭按钮有 aria-label 便于读屏', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(
      screen.getByTestId('aux-drawer-close').getAttribute('aria-label'),
    ).toContain('关闭')
  })
})

// ============================================================================
// 可访问性 / dialog 语义(issue 05 验收 #5)
// ============================================================================

describe('AuxDrawer · dialog 语义', () => {
  afterEach(() => cleanup())

  it('drawer 节点 role=dialog', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', filename: 'data-model.md' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer').getAttribute('role')).toBe('dialog')
  })

  it('drawer 节点 aria-modal=true', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer').getAttribute('aria-modal')).toBe(
      'true',
    )
  })

  it('drawer 节点 aria-label 含文件名', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', filename: 'data-model.md' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const label = screen.getByTestId('aux-drawer').getAttribute('aria-label')
    expect(label).toContain('data-model.md')
  })

  it('drawer 内 textarea 有 aria-label 关联到文件名', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', filename: 'data-model.md' })]}
        auxBodies={{ 'aux-1': '内容' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const textarea = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    const label = textarea.getAttribute('aria-label')
    expect(label).toContain('data-model.md')
  })
})

// ============================================================================
// 编辑器 + 内容(issue 05 验收 #6 #7 #8)
// ============================================================================

describe('AuxDrawer · 编辑器与编辑持久化', () => {
  afterEach(() => cleanup())

  it('drawer 内含一个 textarea(data-testid=aux-drawer-editor)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '初始 body' })]}
        auxBodies={{ 'aux-1': '初始 body' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    expect(ta).toBeInTheDocument()
    expect(ta.value).toBe('初始 body')
  })

  it('编辑 textarea → 回调收到新内容与当前打开文件 id', async () => {
    const onBodyChange = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: 'old' })]}
        auxBodies={{ 'aux-1': 'old' }}
        onClose={() => {}}
        onBodyChange={onBodyChange}
        autosaveIntervalMs={30_000}
      />,
    )
    const user = userEvent.setup()
    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    await user.click(ta)
    await user.keyboard('X')
    expect(onBodyChange).toHaveBeenCalled()
    // 最新一次调用携带 (id, newBody)
    const lastCall = onBodyChange.mock.calls.at(-1)!
    const [calledId, calledBody] = lastCall as [string, string]
    expect(calledId).toBe('aux-1')
    expect(calledBody).toContain('X')
  })

  it('关闭再打开同一文件 → editedBodies 中的内容被恢复(无数据丢失)', () => {
    // 先渲染 + 切换到新内容(模拟 close + 重渲染)
    const { rerender } = render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '原始' })]}
        auxBodies={{ 'aux-1': '原始' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('原始')

    // 模拟关闭(openAuxId=null),抽屉消失
    rerender(
      <AuxDrawer
        openAuxId={null}
        auxFiles={[makeAux()]}
        auxBodies={{ 'aux-1': '原始' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.queryByTestId('aux-drawer')).toBeNull()

    // 再次打开同一个文件 + editedBodies 里已保存新内容 → 抽屉重新渲染并恢复新内容
    rerender(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '原始' })]}
        auxBodies={{ 'aux-1': '用户后续编辑' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('用户后续编辑')
  })

  it('editedBodies 没有该 id 的内容 → 抽屉从 AuxFile.body 装载', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '来自 AuxFile.body' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('来自 AuxFile.body')
  })

  it('切换到第二个文件 → drawer 显示第二个文件的内容', () => {
    const { rerender } = render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[
          makeAux({ id: 'aux-1', filename: 'a.md', body: '内容 A' }),
          makeAux({ id: 'aux-2', filename: 'b.md', body: '内容 B' }),
        ]}
        auxBodies={{ 'aux-1': '内容 A', 'aux-2': '内容 B' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe('a.md')
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('内容 A')

    rerender(
      <AuxDrawer
        openAuxId="aux-2"
        auxFiles={[
          makeAux({ id: 'aux-1', filename: 'a.md', body: '内容 A' }),
          makeAux({ id: 'aux-2', filename: 'b.md', body: '内容 B' }),
        ]}
        auxBodies={{ 'aux-1': '内容 A', 'aux-2': '内容 B' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(screen.getByTestId('aux-drawer-filename').textContent).toBe('b.md')
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('内容 B')
  })
})

// ============================================================================
// 自动保存(issue 05 验收 #7)
// ============================================================================

describe('AuxDrawer · 自动保存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('30s 自动保存指示:有内容时显示 "已保存 · x 秒前"', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '有内容' })]}
        auxBodies={{ 'aux-1': '有内容' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    // 起始没有 lastSaved → 指示不渲染
    expect(screen.queryByTestId('aux-drawer-autosaved')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('aux-drawer-autosaved')).toBeInTheDocument()
  })

  it('editor 内容为空 → autosave tick 被抑制(不显示时间戳)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', body: '' })]}
        auxBodies={{ 'aux-1': '' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.queryByTestId('aux-drawer-autosaved')).toBeNull()
  })

  it('卸载组件时清理定时器', () => {
    const { unmount } = render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{ 'aux-1': '有内容' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(() => unmount()).not.toThrow()
  })
})

// ============================================================================
// 字符计数 / 编辑器工具条(issue 05 视觉匹配)
// ============================================================================

describe('AuxDrawer · 编辑器工具条', () => {
  afterEach(() => cleanup())

  it('编辑器 toolbar 显示当前字符数', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1' })]}
        auxBodies={{ 'aux-1': 'abcde' }}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(
      screen.getByTestId('aux-drawer-editor-chars').getAttribute('data-chars'),
    ).toBe('5')
  })

  it('编辑后字符数同步', async () => {
    const onBodyChange = vi.fn()
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1' })]}
        auxBodies={{ 'aux-1': 'abc' }}
        onClose={() => {}}
        onBodyChange={onBodyChange}
        autosaveIntervalMs={30_000}
      />,
    )
    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'abcdefgh' } })
    expect(
      screen.getByTestId('aux-drawer-editor-chars').getAttribute('data-chars'),
    ).toBe('8')
  })
})

// ============================================================================
// dialog 语义 增强(issue 05 验收 #5)
// ============================================================================

describe('AuxDrawer · dialog 语义增强', () => {
  afterEach(() => cleanup())

  it('aria-labelledby 指向 drawer 头部 filename heading', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux({ id: 'aux-1', filename: 'data-model.md' })]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    const drawer = screen.getByTestId('aux-drawer')
    const labelledBy = drawer.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = document.getElementById(labelledBy as string)
    expect(heading).not.toBeNull()
    expect(heading?.getAttribute('data-testid')).toBe('aux-drawer-head-filename')
    expect(heading?.textContent).toBe('data-model.md')
  })

  it('焦点管理:打开抽屉 → 焦点移到关闭按钮(键盘可达)', () => {
    render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    // 渲染完成后,useEffect 应已把焦点放到关闭按钮
    const closeBtn = screen.getByTestId('aux-drawer-close')
    expect(document.activeElement).toBe(closeBtn)
  })

  it('焦点管理:关闭抽屉 → 焦点不丢,回到 openAuxId 变 null 之前的位置', () => {
    // 模拟"打开 aux-1(假设焦点在某 btn)→ 关闭"流程
    const triggerBtn = document.createElement('button')
    triggerBtn.textContent = 'trigger'
    document.body.appendChild(triggerBtn)
    triggerBtn.focus()

    const { rerender } = render(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    // 抽屉打开时焦点在关闭按钮
    expect(document.activeElement).toBe(screen.getByTestId('aux-drawer-close'))

    // 关闭(openAuxId -> null)
    rerender(
      <AuxDrawer
        openAuxId={null}
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    // 焦点应回到 triggerBtn
    expect(document.activeElement).toBe(triggerBtn)

    triggerBtn.remove()
  })

  it('重复打开相同文件 → 焦点可重新打到关闭按钮', () => {
    const { rerender } = render(
      <AuxDrawer
        openAuxId={null}
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    rerender(
      <AuxDrawer
        openAuxId="aux-1"
        auxFiles={[makeAux()]}
        auxBodies={{}}
        onClose={() => {}}
        onBodyChange={() => {}}
        autosaveIntervalMs={30_000}
      />,
    )
    expect(document.activeElement).toBe(screen.getByTestId('aux-drawer-close'))
  })
})
