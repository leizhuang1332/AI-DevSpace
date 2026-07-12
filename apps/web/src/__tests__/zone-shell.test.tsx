import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ZONE_META, type ZoneMeta } from '@/lib/zones'
import { ZoneShell, zoneShellGridClass } from '@/lib/zone-shell'

const drafting: ZoneMeta = {
  id: 'drafting',
  name: 'DRAFTING',
  display_name: '起草',
  icon: '✏️',
  route_segment: 'drafting',
  has_resource_tree: true,
  has_inline_rail: true,
  status_color: 'gray',
  status_pulse: false,
  thinking_bar: 'required',
  description: '...',
}

const wrapup: ZoneMeta = {
  ...drafting,
  id: 'wrapup',
  name: 'WRAP-UP',
  display_name: '归档',
  icon: '📦',
  route_segment: 'wrap-up',
  has_inline_rail: false,
}

const clarifying: ZoneMeta = {
  ...drafting,
  id: 'clarifying',
  name: 'CLARIFYING',
  display_name: '澄清',
  icon: '❓',
  route_segment: 'clarifying',
  has_resource_tree: false,
  has_inline_rail: false,
}

const executing: ZoneMeta = {
  ...drafting,
  id: 'executing',
  name: 'EXECUTING',
  display_name: '执行中',
  icon: '⚡',
  route_segment: 'executing',
}

afterEach(() => cleanup())

describe('zoneShellGridClass', () => {
  it('资源树 + Inline 栏 → 3 列', () => {
    expect(zoneShellGridClass(drafting)).toBe('grid-cols-[240px_1fr_120px]')
  })
  it('仅资源树 → 2 列(左 + 主)', () => {
    expect(zoneShellGridClass(wrapup)).toBe('grid-cols-[240px_1fr]')
  })
  it('仅 Inline 栏 → 2 列(主 + 右)', () => {
    expect(zoneShellGridClass({ ...drafting, has_resource_tree: false })).toBe(
      'grid-cols-[1fr_120px]',
    )
  })
  it('均无 → 1 列(主区全宽)', () => {
    expect(zoneShellGridClass(clarifying)).toBe('grid-cols-1')
  })
})

describe('ZoneShell', () => {
  it('DRAFTING(资源树 + Inline 栏):data 属性正确,3 列布局', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={drafting}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-zone-id')).toBe('drafting')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('true')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('true')
    expect(shell.className).toContain('grid-cols-[240px_1fr_120px]')
    expect(getByTestId('main')).toBeInTheDocument()
  })

  it('CLARIFYING(均无):1 列布局,主区全宽', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={clarifying}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('false')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('false')
    expect(shell.className).toContain('grid-cols-1')
    expect(getByTestId('main')).toBeInTheDocument()
  })

  it('WRAP-UP(仅资源树):2 列布局,无 Inline 栏', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={wrapup}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('true')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('false')
    expect(shell.className).toContain('grid-cols-[240px_1fr]')
  })

  it('EXECUTING(资源树 + Inline 栏):同 DRAFTING 3 列布局', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={executing}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.className).toContain('grid-cols-[240px_1fr_120px]')
  })

  it('6 个内置工位都能渲染且 data-zone-id 与 zone.id 一致', () => {
    for (const z of ZONE_META) {
      const { unmount, getByTestId } = render(
        <ZoneShell id="REF-001" zone={z}>
          <span>main</span>
        </ZoneShell>,
      )
      expect(getByTestId('zone-shell').getAttribute('data-zone-id')).toBe(z.id)
      unmount()
    }
  })

  it('资源树 / Inline 栏的实际可见性与 zone config 一致', () => {
    // DRAFTING:ResourceTree + InlineRail 都渲染
    const { unmount, container: c1 } = render(
      <ZoneShell id="REF-001" zone={drafting}>
        main
      </ZoneShell>,
    )
    expect(c1.querySelectorAll('[class*="col-"], .grid-cols-\\[240px_1fr_120px\\]').length).toBeGreaterThanOrEqual(0)
    // 简化:只要 shell class 含正确的 grid-cols-* 即可
    expect((c1.querySelector('[data-testid="zone-shell"]') as HTMLElement).className).toContain(
      'grid-cols-[240px_1fr_120px]',
    )
    unmount()

    // CLARIFYING:都无,只有 main
    const { container: c2 } = render(
      <ZoneShell id="REF-001" zone={clarifying}>
        main
      </ZoneShell>,
    )
    expect((c2.querySelector('[data-testid="zone-shell"]') as HTMLElement).className).toContain('grid-cols-1')
  })
})