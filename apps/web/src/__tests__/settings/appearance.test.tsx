import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppearanceSection } from '@/app/(workspace)/settings/sections/appearance'
import type { Config, ConfigPatch } from '@ai-devspace/shared'

describe('AppearanceSection', () => {
  const baseConfig: Config = { theme: 'system' }

  it('渲染主题 segmented 三档', () => {
    render(<AppearanceSection config={baseConfig} onPatch={() => {}} busy={false} />)
    expect(screen.getByRole('radio', { name: '跟随系统' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '亮色' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '暗色' })).toBeInTheDocument()
  })

  it('当前 theme 高亮为 aria-checked', () => {
    render(<AppearanceSection config={{ theme: 'dark' }} onPatch={() => {}} busy={false} />)
    expect(screen.getByRole('radio', { name: '暗色' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '亮色' })).toHaveAttribute('aria-checked', 'false')
  })

  it('点击其他档触发 onPatch({ theme })', () => {
    const onPatch = vi.fn<(p: ConfigPatch) => void>()
    render(<AppearanceSection config={baseConfig} onPatch={onPatch} busy={false} />)
    fireEvent.click(screen.getByRole('radio', { name: '暗色' }))
    expect(onPatch).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('busy=true 时按钮禁用', () => {
    render(<AppearanceSection config={baseConfig} onPatch={() => {}} busy={true} />)
    expect(screen.getByRole('radio', { name: '暗色' })).toBeDisabled()
  })
})
