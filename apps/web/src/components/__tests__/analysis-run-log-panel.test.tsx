import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnalysisLogEntry } from '@ai-devspace/shared'
import { AnalysisRunLogPanel } from '../analysis-run-log-panel'

afterEach(() => cleanup())

// ============================================================================
// Fixtures
// ============================================================================

const TEXT_ENTRY: AnalysisLogEntry = {
  kind: 'text',
  ts: '2026-08-01T10:00:01.000Z',
  text: '开始分析 PRD',
}

const TOOL_USE_ENTRY: AnalysisLogEntry = {
  kind: 'tool_use',
  ts: '2026-08-01T10:00:02.000Z',
  tool_use_id: 'tu-1',
  name: 'Read',
  input: { file_path: '/etc/secret', limit: 100 },
}

const TOOL_RESULT_ENTRY: AnalysisLogEntry = {
  kind: 'tool_result',
  ts: '2026-08-01T10:00:03.000Z',
  tool_use_id: 'tu-1',
  name: 'Read',
  output: { ok: true, lines: 42 },
}

// ============================================================================
// 验收 8:运行中 Run 默认展开;终态 Run 默认折叠(决策 39)
// ============================================================================

describe('AnalysisRunLogPanel · 默认展开 / 折叠(issue 06 验收 8)', () => {
  it('running 状态 + userToggle=null → 默认展开,body 可见', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="running"
        userToggle={null}
        onToggle={() => {}}
      />,
    )
    const panel = screen.getByTestId('analysis-run-log-panel')
    expect(panel.dataset.expanded).toBe('true')
    // body 应存在
    expect(screen.getByTestId('analysis-run-log-body')).toBeInTheDocument()
    // 状态提示文案
    expect(screen.getByTestId('analysis-run-log-status-hint').textContent).toContain('运行中')
  })

  it('succeeded 状态 + userToggle=null → 默认折叠,body 不可见', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="succeeded"
        userToggle={null}
        onToggle={() => {}}
      />,
    )
    const panel = screen.getByTestId('analysis-run-log-panel')
    expect(panel.dataset.expanded).toBe('false')
    expect(screen.queryByTestId('analysis-run-log-body')).toBeNull()
    expect(screen.getByTestId('analysis-run-log-status-hint').textContent).toContain('已终态')
  })

  it('failed 状态 + userToggle=null → 默认折叠', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="failed"
        userToggle={null}
        onToggle={() => {}}
      />,
    )
    const panel = screen.getByTestId('analysis-run-log-panel')
    expect(panel.dataset.expanded).toBe('false')
  })

  it('终态 Run 但 userToggle=true → 用户显式展开,body 可见', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="succeeded"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    const panel = screen.getByTestId('analysis-run-log-panel')
    expect(panel.dataset.expanded).toBe('true')
    expect(screen.getByTestId('analysis-run-log-body')).toBeInTheDocument()
  })

  it('运行中 Run 但 userToggle=false → 用户显式折叠', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="running"
        userToggle={false}
        onToggle={() => {}}
      />,
    )
    const panel = screen.getByTestId('analysis-run-log-panel')
    expect(panel.dataset.expanded).toBe('false')
  })
})

// ============================================================================
// 验收 9:用户手动展开 / 折叠切换 + 折叠状态仅 UI
// ============================================================================

describe('AnalysisRunLogPanel · 切换行为(issue 06 验收 9)', () => {
  it('点 toggle 触发 onToggle,current true → false', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="running"
        userToggle={true}
        onToggle={onToggle}
      />,
    )
    await user.click(screen.getByTestId('analysis-run-log-toggle'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('点 toggle 触发 onToggle,current false → true', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="succeeded"
        userToggle={false}
        onToggle={onToggle}
      />,
    )
    await user.click(screen.getByTestId('analysis-run-log-toggle'))
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('aria-expanded 与 visual expanded 同步', () => {
    const { rerender } = render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="succeeded"
        userToggle={null}
        onToggle={() => {}}
      />,
    )
    const toggle = screen.getByTestId('analysis-run-log-toggle')
    // 默认折叠(succeeded)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // 父组件更新 userToggle=true → 展开
    rerender(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="succeeded"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByTestId('analysis-run-log-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  it('fireEvent 也可触发 toggle(保证键盘 / 测试可用)', () => {
    const onToggle = vi.fn()
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="running"
        userToggle={null}
        onToggle={onToggle}
      />,
    )
    fireEvent.click(screen.getByTestId('analysis-run-log-toggle'))
    expect(onToggle).toHaveBeenCalledWith(false)
  })
})

// ============================================================================
// 验收 6 / 7:entry 渲染 — text / tool_use / tool_result 都有
// ============================================================================

describe('AnalysisRunLogPanel · 渲染三种 entry(issue 06 验收 6)', () => {
  it('text entry 渲染文本 + 时间', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByTestId('analysis-run-log-entry')).toBeInTheDocument()
    // 文本内容
    expect(screen.getByText('开始分析 PRD')).toBeInTheDocument()
  })

  it('tool_use entry 渲染 tool 名 + input 序列化', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TOOL_USE_ENTRY]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    const entries = screen.getAllByTestId('analysis-run-log-entry')
    expect(entries.length).toBe(1)
    const entry = entries[0]!
    expect(entry.dataset.kind).toBe('tool_use')
    expect(entry.dataset.name).toBe('Read')
    expect(entry.dataset.toolUseId).toBe('tu-1')
    // input 应当 JSON 序列化渲染
    const input = screen.getByTestId('analysis-run-log-entry-input')
    expect(input.textContent).toContain('/etc/secret')
  })

  it('tool_result entry 渲染 output 序列化', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TOOL_RESULT_ENTRY]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    const entries = screen.getAllByTestId('analysis-run-log-entry')
    expect(entries.length).toBe(1)
    const entry = entries[0]!
    expect(entry.dataset.kind).toBe('tool_result')
    const output = screen.getByTestId('analysis-run-log-entry-output')
    expect(output.textContent).toContain('"ok": true')
  })

  it('混合 entries → counts 与 entry 列表都对', () => {
    render(
      <AnalysisRunLogPanel
        entries={[TEXT_ENTRY, TOOL_USE_ENTRY, TOOL_RESULT_ENTRY, TEXT_ENTRY]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    expect(screen.getAllByTestId('analysis-run-log-entry').length).toBe(4)
    const counts = screen.getByTestId('analysis-run-log-counts')
    expect(counts.textContent).toContain('2 文本')
    expect(counts.textContent).toContain('1 工具')
    expect(counts.textContent).toContain('1 结果')
  })

  it('空 entries → 显示"暂无 Run Log"', () => {
    render(
      <AnalysisRunLogPanel
        entries={[]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    expect(screen.getByTestId('analysis-run-log-empty').textContent).toContain('暂无 Run Log')
  })

  it('entry 计数 = 0 → counts 仍显示 0', () => {
    render(
      <AnalysisRunLogPanel
        entries={[]}
        runStatus="succeeded"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    const counts = screen.getByTestId('analysis-run-log-counts')
    expect(counts.textContent).toContain('0 文本')
    expect(counts.textContent).toContain('0 工具')
    expect(counts.textContent).toContain('0 结果')
  })
})

// ============================================================================
// 验收 6 + 决策 71-73:UI 不再对 secret 做二次遮盖(信任服务端脱敏)
// ============================================================================

describe('AnalysisRunLogPanel · 服务端脱敏后 UI 不补救', () => {
  it('text 含 [REDACTED] 占位符 → 直接渲染,不再正则遮盖', () => {
    render(
      <AnalysisRunLogPanel
        entries={[
          {
            kind: 'text',
            ts: '2026-08-01T10:00:01.000Z',
            text: 'Authorization: [REDACTED]',
          },
        ]}
        runStatus="running"
        userToggle={true}
        onToggle={() => {}}
      />,
    )
    // [REDACTED] 占位符应该原样出现 —— UI 不应再做脱敏
    expect(screen.getByText('Authorization: [REDACTED]')).toBeInTheDocument()
  })
})
