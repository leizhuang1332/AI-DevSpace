import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiExperienceSection } from '@/app/(workspace)/settings/sections/ai-experience'
import type { Config } from '@ai-devspace/shared'

describe('AiExperienceSection', () => {
  const baseConfig: Config = { typewriterSpeed: 'medium', silentWindowSeconds: 30 }

  it('渲染 4 档打字机速度', () => {
    render(<AiExperienceSection config={baseConfig} onPatch={() => {}} busy={false} />)
    expect(screen.getByRole('radio', { name: '关（即时）' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '快 10ms' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '中 20ms' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '慢 30ms' })).toBeInTheDocument()
  })

  it('点击快档触发 onPatch({ typewriterSpeed: "fast" })', () => {
    const onPatch = vi.fn()
    render(<AiExperienceSection config={baseConfig} onPatch={onPatch} busy={false} />)
    fireEvent.click(screen.getByRole('radio', { name: '快 10ms' }))
    expect(onPatch).toHaveBeenCalledWith({ typewriterSpeed: 'fast' })
  })

  it('静默窗口 input 渲染当前值', () => {
    render(<AiExperienceSection config={{ ...baseConfig, silentWindowSeconds: 45 }} onPatch={() => {}} busy={false} />)
    const input = screen.getByTestId('silent-window-input') as HTMLInputElement
    expect(input.value).toBe('45')
  })

  it('静默窗口失焦触发 onPatch（值变化时）', () => {
    const onPatch = vi.fn()
    render(<AiExperienceSection config={baseConfig} onPatch={onPatch} busy={false} />)
    const input = screen.getByTestId('silent-window-input')
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)
    expect(onPatch).toHaveBeenCalledWith({ silentWindowSeconds: 60 })
  })

  it('静默窗口输入越界时回退到原值', () => {
    const onPatch = vi.fn()
    render(<AiExperienceSection config={baseConfig} onPatch={onPatch} busy={false} />)
    const input = screen.getByTestId('silent-window-input')
    fireEvent.change(input, { target: { value: '2' } }) // < 5
    fireEvent.blur(input)
    expect(onPatch).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('30')
  })
})
