import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ThinkingStream, type ThinkingPhase } from '@/components/thinking-stream'
import type { AnalyzingChunk } from '@/lib/analyzing'

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 辅助:构造 N 条 chunks(主区左侧测试不依赖真实 mock)
// ---------------------------------------------------------------------------

function mkChunks(n: number): AnalyzingChunk[] {
  const result: AnalyzingChunk[] = []
  for (let i = 0; i < n; i++) {
    result.push({
      id: `c-${i + 1}`,
      ts: `14:23:0${i + 1}`,
      label: 'DETECT',
      text: `chunk-${i + 1} text`,
      kind: i % 3 === 0 ? 'subproblem' : i % 3 === 1 ? 'risk' : 'option',
      tone: i % 3 === 0 ? 'success' : i % 3 === 1 ? 'warn' : 'info',
    })
  }
  return result
}

// ============================================================================
// 渲染 — 三态分支(idle / typing / done)
// ============================================================================

describe('ThinkingStream · 渲染', () => {
  it('chunks 为空时显示"暂无思考流"占位', () => {
    render(<ThinkingStream chunks={[]} phase={{ kind: 'idle' }} paused={false} onSkip={vi.fn()} />)
    expect(screen.getByText('暂无思考流')).toBeInTheDocument()
    expect(screen.queryByTestId('analyzing-chunk-future')).toBeNull()
  })

  it('phase=idle → 全部 chunk 渲染为 future 占位', () => {
    const chunks = mkChunks(3)
    render(<ThinkingStream chunks={chunks} phase={{ kind: 'idle' }} paused={false} onSkip={vi.fn()} />)
    expect(screen.getAllByTestId('analyzing-chunk-future')).toHaveLength(3)
    expect(screen.queryByTestId('analyzing-chunk-current')).toBeNull()
    expect(screen.queryByTestId('analyzing-chunk-done')).toBeNull()
  })

  it('phase=typing(chunkIndex=0,typedLen=1) → 第 0 条 current,其余 future', () => {
    const chunks = mkChunks(3)
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 1 }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    const current = screen.getByTestId('analyzing-chunk-current')
    expect(current.getAttribute('data-chunk-id')).toBe('c-1')
    expect(current.getAttribute('data-typed-len')).toBe('1')
    expect(current.getAttribute('data-full-len')).toBe('12') // "chunk-1 text" 长度
    expect(current.querySelector('[data-testid="analyzing-typewriter-cursor"]')).not.toBeNull()
    expect(screen.getAllByTestId('analyzing-chunk-future')).toHaveLength(2)
  })

  it('phase=typing(typedLen=full) → 当前 chunk 走 done 形态', () => {
    // 实际由父组件驱动 typedLen === text.length 时切到 pausing,但本组件只看 typedLen;
    // 这里验证 typedLen=fullLen 时 current row 仍渲染完整文字(便于"点击跳过"立即显示完整)
    const chunks = mkChunks(2)
    const fullLen = chunks[0].text.length
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: fullLen }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    const current = screen.getByTestId('analyzing-chunk-current')
    expect(current.getAttribute('data-typed-len')).toBe(String(fullLen))
    expect(current.getAttribute('data-full-len')).toBe(String(fullLen))
  })

  it('phase=done → 全部 chunk 渲染为 done 形态', () => {
    const chunks = mkChunks(3)
    render(<ThinkingStream chunks={chunks} phase={{ kind: 'done' }} paused={false} onSkip={vi.fn()} />)
    expect(screen.getAllByTestId('analyzing-chunk-done')).toHaveLength(3)
    expect(screen.queryByTestId('analyzing-chunk-current')).toBeNull()
    expect(screen.queryByTestId('analyzing-chunk-future')).toBeNull()
  })

  it('phase=pausing(chunkIndex=1,typedLen=full) → 第 0 条 done,第 1 条 done,其余 future', () => {
    const chunks = mkChunks(3)
    const fullLen = chunks[1].text.length
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'pausing', chunkIndex: 1, typedLen: fullLen }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getAllByTestId('analyzing-chunk-done')).toHaveLength(2)
    expect(screen.getByTestId('analyzing-chunk-future')).toBeInTheDocument()
  })

  it('done row 的 tone 决定 border 颜色类(info→border-l-brand)', () => {
    const chunks: AnalyzingChunk[] = [
      { id: 'c-info', ts: '14:00:00', label: 'START', text: 'a', kind: 'narration', tone: 'info' },
      { id: 'c-warn', ts: '14:00:01', label: 'RISK', text: 'b', kind: 'risk', tone: 'warn' },
      { id: 'c-err', ts: '14:00:02', label: 'RISK', text: 'c', kind: 'risk', tone: 'err' },
      { id: 'c-success', ts: '14:00:03', label: 'OPTION', text: 'd', kind: 'option', tone: 'success' },
    ]
    render(<ThinkingStream chunks={chunks} phase={{ kind: 'done' }} paused={false} onSkip={vi.fn()} />)
    const rows = screen.getAllByTestId('analyzing-chunk-done')
    expect(rows).toHaveLength(4)
    expect(rows[0].className).toContain('border-l-brand')
    expect(rows[1].className).toContain('border-l-warning')
    expect(rows[2].className).toContain('border-l-error')
    expect(rows[3].className).toContain('border-l-success')
  })
})

// ============================================================================
// 暂停提示
// ============================================================================

describe('ThinkingStream · 暂停', () => {
  it('paused=true → 进度文案后追加" · 已暂停",根 data-paused=true', () => {
    const chunks = mkChunks(2)
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 1 }}
        paused={true}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByTestId('analyzing-stream').getAttribute('data-paused')).toBe('true')
    expect(screen.getByTestId('analyzing-stream-progress').textContent).toContain('已暂停')
  })

  it('paused=false → 不显示"已暂停"', () => {
    const chunks = mkChunks(2)
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 1 }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    expect(screen.getByTestId('analyzing-stream-progress').textContent).not.toContain('已暂停')
  })
})

// ============================================================================
// 跳过点击(issue 19b 验收)
// ============================================================================

describe('ThinkingStream · 点击跳过当前 chunk', () => {
  it('点击流区 → 触发 onSkip 回调', () => {
    const onSkip = vi.fn()
    const chunks = mkChunks(3)
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 1 }}
        paused={false}
        onSkip={onSkip}
      />,
    )
    fireEvent.click(screen.getByTestId('analyzing-stream-body'))
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('phase=idle 时点击也触发 onSkip(由父组件决定语义)', () => {
    // 父组件的 skipTypewriter 仅在 typing 时生效,本组件不区分 phase
    // — 这是为了"任意位置点击都能给父组件一次机会"的简化设计
    const onSkip = vi.fn()
    render(
      <ThinkingStream chunks={mkChunks(3)} phase={{ kind: 'idle' }} paused={false} onSkip={onSkip} />,
    )
    fireEvent.click(screen.getByTestId('analyzing-stream-body'))
    expect(onSkip).toHaveBeenCalledOnce()
  })
})

// ============================================================================
// chunks 增长(SSE 推送新 chunk)—— 父组件更新 chunks,组件自动重渲
// ============================================================================

describe('ThinkingStream · chunks 增长(SSE 推送)', () => {
  it('初始 2 条 → 追加 1 条 → 渲染 3 条,新增的 c-3 走 future 形态', () => {
    const chunks = mkChunks(2)
    const phase: ThinkingPhase = { kind: 'typing', chunkIndex: 0, typedLen: 1 }
    const { rerender } = render(<ThinkingStream chunks={chunks} phase={phase} paused={false} onSkip={vi.fn()} />)
    expect(screen.getByTestId('analyzing-stream').getAttribute('data-chunk-count')).toBe('2')

    const appendedChunk: AnalyzingChunk = {
      id: 'c-3',
      ts: '14:23:30',
      label: 'INFER',
      text: 'appended after SSE',
      kind: 'narration',
      tone: 'info',
    }
    const appended = [...chunks, appendedChunk]
    rerender(<ThinkingStream chunks={appended} phase={phase} paused={false} onSkip={vi.fn()} />)
    expect(screen.getByTestId('analyzing-stream').getAttribute('data-chunk-count')).toBe('3')
    // 推进 chunkIndex 至 2 时,新 chunk 才会进 current
    rerender(
      <ThinkingStream
        chunks={appended}
        phase={{ kind: 'typing', chunkIndex: 2, typedLen: 1 }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    const current = screen.getByTestId('analyzing-chunk-current')
    expect(current.getAttribute('data-chunk-id')).toBe('c-3')
  })

  it('暂停时(paused=true)插入新 chunk,新 chunk 暂不显示在打字区,仅 future 占位', () => {
    const chunks = mkChunks(2)
    const phase: ThinkingPhase = { kind: 'pausing', chunkIndex: 0, typedLen: 12 }
    const { rerender } = render(<ThinkingStream chunks={chunks} phase={phase} paused={true} onSkip={vi.fn()} />)
    expect(screen.getByTestId('analyzing-stream').getAttribute('data-paused')).toBe('true')

    // 用户暂停时插话 → 推送新 chunk 进来,但 paused 时打字机不动,新 chunk 仍 future
    const appendedChunk: AnalyzingChunk = {
      id: 'c-appended',
      ts: '14:23:30',
      label: 'INFER',
      text: 'appended after interject',
      kind: 'narration',
      tone: 'info',
    }
    const appended = [...chunks, appendedChunk]
    rerender(<ThinkingStream chunks={appended} phase={phase} paused={true} onSkip={vi.fn()} />)
    // 后续 chunkIndex 不变(因为 paused),所以新 chunk 仍是 future
    const futures = screen.getAllByTestId('analyzing-chunk-future')
    expect(futures.length).toBeGreaterThan(0)
    expect(futures.some((el) => el.getAttribute('data-chunk-id') === 'c-appended')).toBe(true)
  })
})

// ============================================================================
// 打字机脉动光标存在性(issue 19b 验收 #1:每条 chunk 显示时间戳 + 标签 + 文字 + 脉动光标)
// ============================================================================

describe('ThinkingStream · 打字机光标', () => {
  it('current row 含 data-testid="analyzing-typewriter-cursor"', () => {
    render(
      <ThinkingStream
        chunks={mkChunks(2)}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 1 }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    const cursor = screen.getByTestId('analyzing-typewriter-cursor')
    expect(cursor).toBeInTheDocument()
    expect(cursor.className).toContain('animate-pulse')
  })

  it('done row 不含光标(已打完无需 cursor)', () => {
    render(<ThinkingStream chunks={mkChunks(2)} phase={{ kind: 'done' }} paused={false} onSkip={vi.fn()} />)
    expect(screen.queryByTestId('analyzing-typewriter-cursor')).toBeNull()
  })

  it('current row 含 ts + label + typed text', () => {
    const chunks: AnalyzingChunk[] = [
      { id: 'c-1', ts: '14:23:01', label: 'DETECT', text: 'Q1 · 退款金额上限?', kind: 'subproblem', tone: 'success' },
    ]
    render(
      <ThinkingStream
        chunks={chunks}
        phase={{ kind: 'typing', chunkIndex: 0, typedLen: 3 }}
        paused={false}
        onSkip={vi.fn()}
      />,
    )
    const current = screen.getByTestId('analyzing-chunk-current')
    expect(current.textContent).toContain('14:23:01')
    expect(current.textContent).toContain('DETECT')
    expect(current.textContent).toContain('Q1') // typed 3 chars
  })
})
