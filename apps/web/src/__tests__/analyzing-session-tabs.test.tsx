import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SessionTabs } from '@/components/session-tabs'
import type { AnalysisSession } from '@/lib/analyzing'

afterEach(() => {
  cleanup()
})

function mkSessions(): AnalysisSession[] {
  return [
    {
      id: 'sess-arch',
      label: '架构',
      angle: 'architecture',
      detectedCount: 3,
      isStreaming: false,
    },
    {
      id: 'sess-data',
      label: '数据',
      angle: 'data',
      detectedCount: 5,
      isStreaming: true,
    },
    {
      id: 'sess-interface',
      label: '接口',
      angle: 'interface',
      detectedCount: 8,
      isStreaming: false,
    },
  ]
}

function getTabById(sessionId: string): HTMLElement {
  const container = screen.getByTestId('session-tabs')
  const tab = container.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`)
  if (!tab) throw new Error(`Tab with sessionId="${sessionId}" not found`)
  return tab
}

function getAngleBtn(angle: string): HTMLElement {
  return screen.getByTestId(`session-create-angle-${angle}`)
}

describe('SessionTabs · 多 Tab 渲染', () => {
  it('sessions 数组每个元素渲染一个 Tab', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const tabs = screen.getAllByTestId('session-tab')
    expect(tabs).toHaveLength(3)
  })

  it('每个 Tab 显示 label + icon + 数字徽章(detectedCount)', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const archTab = getTabById('sess-arch')
    expect(archTab.textContent).toContain('架构')
    expect(archTab.textContent).toContain('📐')
    const badge = within(archTab).getByTestId('session-tab-badge')
    expect(badge.textContent).toBe('3')

    const dataTab = getTabById('sess-data')
    const dataBadge = within(dataTab).getByTestId('session-tab-badge')
    expect(dataBadge.textContent).toBe('5')
  })

  it('每个 Tab 渲染 isStreaming 时显示运行中圆点', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dataTab = getTabById('sess-data')
    expect(within(dataTab).getByTestId('session-tab-streaming')).toBeInTheDocument()

    const archTab = getTabById('sess-arch')
    expect(within(archTab).queryByTestId('session-tab-streaming')).toBeNull()
  })

  it('[+ 新建] 按钮始终可见', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('session-tab-create-btn')).toBeInTheDocument()
  })
})

describe('SessionTabs · active Tab 视觉态', () => {
  it('active Tab data-active=true;非 active Tab data-active=false', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(getTabById('sess-arch').getAttribute('data-active')).toBe('false')
    expect(getTabById('sess-data').getAttribute('data-active')).toBe('true')
    expect(getTabById('sess-data').getAttribute('aria-selected')).toBe('true')
  })

  it('点击 Tab → 触发 onSwitch(sessionId)', () => {
    const onSwitch = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={onSwitch}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(getTabById('sess-arch'))
    expect(onSwitch).toHaveBeenCalledWith('sess-arch')
  })

  it('点击 active Tab 也触发 onSwitch(让上层决定是否响应)', () => {
    const onSwitch = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={onSwitch}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(getTabById('sess-data'))
    expect(onSwitch).toHaveBeenCalledWith('sess-data')
  })
})

describe('SessionTabs · 默认 activeId', () => {
  it('activeId 与 sessions[0].id 不一致时,仍以 props.activeId 为准', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-interface"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(getTabById('sess-interface').getAttribute('data-active')).toBe('true')
  })
})

describe('SessionTabs · [+ 新建] 对话框', () => {
  it('点击 [+ 新建] 按钮 → 弹出对话框', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))
    expect(screen.getByTestId('session-create-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('session-create-input')).toBeInTheDocument()
  })

  it('对话框内默认选中 custom 角度', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))
    expect(getAngleBtn('custom').getAttribute('data-selected')).toBe('true')
  })

  it('点击不同 angle 按钮 → 切换选中', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))
    fireEvent.click(getAngleBtn('data'))
    expect(getAngleBtn('data').getAttribute('data-selected')).toBe('true')
    expect(getAngleBtn('custom').getAttribute('data-selected')).toBe('false')
  })

  it('输入空 label → [创建] 按钮 disabled', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))
    const confirmBtn = screen.getByTestId('session-create-confirm') as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)
  })

  it('输入 label + 选 angle + 点 [创建] → 触发 onCreate({label, angle}) 并关闭对话框', () => {
    const onCreate = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))

    const input = screen.getByTestId('session-create-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '退款幂等' } })
    fireEvent.click(getAngleBtn('data'))
    fireEvent.click(screen.getByTestId('session-create-confirm'))

    expect(onCreate).toHaveBeenCalledWith({ label: '退款幂等', angle: 'data' })
    expect(screen.queryByTestId('session-create-dialog')).toBeNull()
  })

  it('点 [取消] → 关闭对话框 + 不触发 onCreate', () => {
    const onCreate = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('session-tab-create-btn'))
    fireEvent.click(screen.getByTestId('session-create-cancel'))
    expect(screen.queryByTestId('session-create-dialog')).toBeNull()
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('SessionTabs · 关闭 Tab', () => {
  it('每个 Tab 显示关闭按钮(>1 个 Tab 时)', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const closeButtons = screen.getAllByTestId('session-tab-close')
    expect(closeButtons).toHaveLength(3)
  })

  it('点 × → 触发 onClose(sessionId)', () => {
    const onClose = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={onClose}
      />,
    )
    const archTab = getTabById('sess-arch')
    fireEvent.click(within(archTab).getByTestId('session-tab-close'))
    expect(onClose).toHaveBeenCalledWith('sess-arch')
  })

  it('点 × 时不会触发 onSwitch(stopPropagation)', () => {
    const onSwitch = vi.fn()
    const onClose = vi.fn()
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={onSwitch}
        onCreate={vi.fn()}
        onClose={onClose}
      />,
    )
    const archTab = getTabById('sess-arch')
    fireEvent.click(within(archTab).getByTestId('session-tab-close'))
    expect(onClose).toHaveBeenCalledWith('sess-arch')
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('只剩 1 个 Tab 时不显示关闭按钮(最后一个不可关闭)', () => {
    render(
      <SessionTabs
        sessions={[
          {
            id: 'only',
            label: '架构',
            angle: 'architecture',
            detectedCount: 3,
            isStreaming: false,
          },
        ]}
        activeId="only"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('session-tab-close')).toBeNull()
  })
})

describe('SessionTabs · 角度图标', () => {
  it('根据 angle 渲染对应 icon', () => {
    render(
      <SessionTabs
        sessions={mkSessions()}
        activeId="sess-data"
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(getTabById('sess-arch').getAttribute('data-angle')).toBe('architecture')
    expect(getTabById('sess-arch').textContent).toContain('📐')
    expect(getTabById('sess-data').getAttribute('data-angle')).toBe('data')
    expect(getTabById('sess-data').textContent).toContain('💾')
    expect(getTabById('sess-interface').getAttribute('data-angle')).toBe('interface')
    expect(getTabById('sess-interface').textContent).toContain('🔌')
  })
})