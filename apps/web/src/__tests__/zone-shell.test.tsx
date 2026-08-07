import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SECTION_META, type SectionMeta } from '@/lib/sections'
import { ZoneShell, zoneShellGridClass } from '@/lib/zone-shell'

// ============================================================================
// section fixtures(ADR-0026:camelCase 字段;board 新增,clarifying/executing 退役)
// ============================================================================

const drafting: SectionMeta = {
  ...SECTION_META.drafting,
  // 显式声明:DRAFTING(issue 01 后)仅 Inline 栏,无资源树
  hasResourceTree: false,
  hasInlineRail: true,
}

const board: SectionMeta = {
  ...SECTION_META.board,
  // BOARD(ADR-0027 D2):全宽无树无栏
  hasResourceTree: false,
  hasInlineRail: false,
}

const analyzing: SectionMeta = {
  ...SECTION_META.analyzing,
  // ANALYZING:全宽无树无栏
  hasResourceTree: false,
  hasInlineRail: false,
}

const wrapup: SectionMeta = {
  ...SECTION_META.wrapup,
  // WRAP-UP:仅资源树
  hasResourceTree: true,
  hasInlineRail: false,
}

// 资源树 + Inline 栏组合(本期无 section 使用,但保留 grid 3 列测试以覆盖 zoneShellGridClass)
// id 必须是合法 RequirementSection;复用 drafting id(仅用于 grid 测试)
const treeAndRail: SectionMeta = {
  ...drafting,
  hasResourceTree: true,
  hasInlineRail: true,
}

afterEach(() => cleanup())

describe('zoneShellGridClass', () => {
  it('资源树 + Inline 栏 → 3 列', () => {
    expect(zoneShellGridClass(treeAndRail)).toBe('grid-cols-[240px_1fr_120px]')
  })
  it('仅资源树 → 2 列(左 + 主)', () => {
    expect(zoneShellGridClass(wrapup)).toBe('grid-cols-[240px_1fr]')
  })
  it('仅 Inline 栏 → 2 列(主 + 右)', () => {
    // DRAFTING(issue 01 后):仅 Inline 栏,主区全宽 + 右 120px
    expect(zoneShellGridClass(drafting)).toBe('grid-cols-[1fr_120px]')
  })
  it('均无 → 1 列(主区全宽)', () => {
    expect(zoneShellGridClass(board)).toBe('grid-cols-1')
    expect(zoneShellGridClass(analyzing)).toBe('grid-cols-1')
  })
})

describe('ZoneShell', () => {
  it('DRAFTING(issue 01 后:仅 Inline 栏):data 属性正确,2 列布局', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={drafting}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-zone-id')).toBe('drafting')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('false')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('true')
    expect(shell.className).toContain('grid-cols-[1fr_120px]')
    expect(getByTestId('main')).toBeInTheDocument()
  })

  it('BOARD(均无):1 列布局,主区全宽', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={board}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-zone-id')).toBe('board')
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
    expect(shell.getAttribute('data-zone-id')).toBe('wrapup')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('true')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('false')
    expect(shell.className).toContain('grid-cols-[240px_1fr]')
  })

  it('ANALYZING(均无):1 列布局,主区全宽', () => {
    const { getByTestId } = render(
      <ZoneShell id="REF-001" zone={analyzing}>
        <span data-testid="main">main</span>
      </ZoneShell>,
    )
    const shell = getByTestId('zone-shell')
    expect(shell.getAttribute('data-zone-id')).toBe('analyzing')
    expect(shell.getAttribute('data-has-resource-tree')).toBe('false')
    expect(shell.getAttribute('data-has-inline-rail')).toBe('false')
    expect(shell.className).toContain('grid-cols-1')
  })

  it('4 个内置 section 都能渲染且 data-zone-id 与 zone.id 一致', () => {
    for (const id of ['drafting', 'board', 'analyzing', 'wrapup'] as const) {
      const z = SECTION_META[id]
      const { unmount, getByTestId } = render(
        <ZoneShell id="REF-001" zone={z}>
          <span>main</span>
        </ZoneShell>,
      )
      expect(getByTestId('zone-shell').getAttribute('data-zone-id')).toBe(z.id)
      unmount()
    }
  })

  it('资源树 / Inline 栏的实际可见性与 section config 一致', () => {
    // DRAFTING(issue 01 后):仅 Inline 栏渲染,grid-cols-[1fr_120px]
    const { unmount, container: c1 } = render(
      <ZoneShell id="REF-001" zone={drafting}>
        main
      </ZoneShell>,
    )
    expect(
      (c1.querySelector('[data-testid="zone-shell"]') as HTMLElement).className,
    ).toContain('grid-cols-[1fr_120px]')
    unmount()

    // BOARD:都无,只有 main
    const { container: c2 } = render(
      <ZoneShell id="REF-001" zone={board}>
        main
      </ZoneShell>,
    )
    expect(
      (c2.querySelector('[data-testid="zone-shell"]') as HTMLElement).className,
    ).toContain('grid-cols-1')
  })
})
