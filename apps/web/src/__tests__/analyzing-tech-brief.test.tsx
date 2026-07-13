import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TechBriefPanel } from '@/components/tech-brief-panel'
import type { GenerateBriefResult } from '@/lib/tech-brief-actions'

// mock server action
vi.mock('@/lib/tech-brief-actions', () => ({
  generateTechBrief: vi.fn(),
}))

import { generateTechBrief } from '@/lib/tech-brief-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TechBriefPanel · 默认渲染', () => {
  it('always 显示 [📊 生成技术概要] 按钮(无论是否有 preview)', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="sess-arch"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    expect(screen.getByTestId('tech-brief-generate-btn')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-generate-btn').textContent).toContain('生成技术概要')
  })

  it('按钮 brand 色样式', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    const btn = screen.getByTestId('tech-brief-generate-btn')
    expect(btn.className).toContain('bg-brand')
  })

  it('preview=null → 不渲染 Tab 区', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    expect(screen.queryByTestId('tech-brief-preview')).toBeNull()
  })

  it('preview 存在 → 渲染双 Tab + 时间戳', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="sess-arch"
        preview="# Tech Brief\n\n## 1. 业务背景"
        modulesPreview={{
          modules: [
            {
              id: 'm-1',
              name: '网关',
              description: '',
              deps: [],
              complexity: 'low',
            },
          ],
        }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    expect(screen.getByTestId('tech-brief-preview')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-tab-brief')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-tab-modules')).toBeInTheDocument()
    expect(screen.getByTestId('tech-brief-timestamp').textContent).toContain('2026-07-13')
  })

  it('默认 Tab 是 brief;点 modules 切到 YAML view', async () => {
    const user = userEvent.setup()
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview="# Brief\n\n## 1. 业务背景"
        modulesPreview={{
          modules: [
            {
              id: 'm-1',
              name: '网关',
              description: '',
              deps: [],
              complexity: 'low',
            },
          ],
        }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    // 默认显示 brief
    expect(screen.getByTestId('tech-brief-view-brief').textContent).toContain('业务背景')
    await user.click(screen.getByTestId('tech-brief-tab-modules'))
    expect(screen.getByTestId('tech-brief-view-modules')).toBeInTheDocument()
    expect(within(screen.getByTestId('tech-brief-view-modules')).getByText('m-1')).toBeInTheDocument()
  })

  it('[🔄 重扫] 按钮 disabled + tooltip(VS6 占位)', () => {
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview="# Brief"
        modulesPreview={{ modules: [] }}
        generatedAt="2026-07-13T10:00:00.000Z"
      />,
    )
    const rescan = screen.getByTestId('tech-brief-rescan-btn')
    expect(rescan).toBeDisabled()
    expect(rescan.getAttribute('title')).toContain('VS6')
  })
})

describe('TechBriefPanel · 点击生成', () => {
  it('点按钮 → 调 generateTechBrief', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: true,
      brief: '# New Brief',
      modules: { modules: [] },
      generatedAt: '2026-07-13T10:05:00.000Z',
    })
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="sess-arch"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(generateTechBrief).toHaveBeenCalledWith('req-001', 'sess-arch')
    })
  })

  it('点击期间按钮变 spinner + disabled + 显示"正在生成…"toast', async () => {
    const user = userEvent.setup()
    let resolveFn!: (v: GenerateBriefResult) => void
    vi.mocked(generateTechBrief).mockReturnValueOnce(
      new Promise<GenerateBriefResult>((r) => {
        resolveFn = r
      }),
    )
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    const btn = screen.getByTestId('tech-brief-generate-btn')
    await user.click(btn)
    expect(btn.getAttribute('data-loading')).toBe('true')
    expect(btn).toBeDisabled()
    // loading toast 出现(决策 30 三态 — 顶部 statusbar 风格的小提示)
    const loading = screen.getByTestId('tech-brief-loading')
    expect(loading).toBeInTheDocument()
    expect(loading.textContent).toContain('正在生成')
    resolveFn({ ok: true, brief: '', modules: { modules: [] }, generatedAt: '' })
  })

  it('成功 → 渲染 preview + timestamp', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: true,
      brief: '# Generated',
      modules: {
        modules: [
          { id: 'm-1', name: 'X', description: '', deps: [], complexity: 'low' },
        ],
      },
      generatedAt: '2026-07-13T11:00:00.000Z',
    })
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('tech-brief-preview')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tech-brief-timestamp').textContent).toContain('2026-07-13')
  })

  it('失败 → 显示错误 toast(已自动回滚提示)', async () => {
    const user = userEvent.setup()
    vi.mocked(generateTechBrief).mockResolvedValueOnce({
      ok: false,
      error: 'AI 中途出错,已自动回滚',
    })
    render(
      <TechBriefPanel
        requirementId="req-001"
        sessionId="s"
        preview={null}
        modulesPreview={null}
        generatedAt={null}
      />,
    )
    await user.click(screen.getByTestId('tech-brief-generate-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('tech-brief-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tech-brief-error').textContent).toContain('已自动回滚')
  })
})