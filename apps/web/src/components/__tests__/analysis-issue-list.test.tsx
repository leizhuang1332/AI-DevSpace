import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AnalysisIssue,
  AuxFile,
  AssetMeta,
  SourceRef,
} from '@ai-devspace/shared'
import {
  AnalysisIssueList,
  isSourceRefMissing,
  sharedSourceRefToWebRef,
} from '../analysis-issue-list'

afterEach(() => cleanup())

// ============================================================================
// Fixtures
// ============================================================================

const auxFiles: AuxFile[] = [
  {
    id: 'aux-api',
    filename: 'api-draft.md',
    body: '# API',
    usage_tag: 'api',
    source_format: 'md',
    converted_to_md: false,
  },
]

const assetList: AssetMeta[] = [
  {
    name: 'prd-diagram.png',
    url: '/api/requirement/req-1/assets/prd-diagram.png',
    path: 'requirements/req-1/assets/prd-diagram.png',
    size: 1024,
    mime: 'image/png',
  },
]

function buildIssue(partial: Partial<AnalysisIssue> & { source_refs: SourceRef[] }): AnalysisIssue {
  return {
    issue_id: 'iss-test-1',
    run_id: 'run-test',
    ordinal: 1,
    title: 'PRD 缺少验收标准',
    description: '当前 PRD 没有给出"通过条件"。',
    metadata: [],
    reported_at: '2026-08-01T00:00:00.000Z',
    ...partial,
  } as AnalysisIssue
}

// ============================================================================
// isSourceRefMissing 单元测试(issue 03 acceptance #12 · 来源缺失降级)
// ============================================================================

describe('isSourceRefMissing · 来源缺失判定', () => {
  it('requirement:prd 存在 → 不缺失', () => {
    const ref: SourceRef = { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(false)
  })

  it('requirement:prd 不存在 → 缺失', () => {
    const ref: SourceRef = { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] }
    expect(
      isSourceRefMissing(ref, { prdExists: false, auxFiles, assetList }),
    ).toBe(true)
  })

  it('aux:auxId 命中 → 不缺失', () => {
    const ref: SourceRef = { kind: 'aux', aux_id: 'aux-api', line_range: [0, 3] }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(false)
  })

  it('aux:auxId 不在 auxFiles → 缺失', () => {
    const ref: SourceRef = { kind: 'aux', aux_id: 'aux-deleted', line_range: [0, 3] }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(true)
  })

  it('asset:name 命中 assetList → 不缺失', () => {
    const ref: SourceRef = { kind: 'asset', asset_id: 'prd-diagram.png' }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(false)
  })

  it('asset:name 不在 assetList → 缺失', () => {
    const ref: SourceRef = { kind: 'asset', asset_id: 'ghost.png' }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(true)
  })

  it('repository:始终视为缺失(本期阅读器不覆盖 Repository 文档)', () => {
    const ref: SourceRef = {
      kind: 'repository',
      repo_name: 'orders',
      relative_path: 'src/index.ts',
      line_range: [0, 10],
    }
    expect(
      isSourceRefMissing(ref, { prdExists: true, auxFiles, assetList }),
    ).toBe(true)
  })
})

// ============================================================================
// sharedSourceRefToWebRef 单元测试(issue 03 acceptance #11 · SourceRef 联动)
// ============================================================================

describe('sharedSourceRefToWebRef · shared → web SourceRef 转换', () => {
  it('requirement → prd,line_range → lineRange', () => {
    const ref: SourceRef = {
      kind: 'requirement',
      relative_path: 'requirement.md',
      line_range: [3, 7],
    }
    expect(sharedSourceRefToWebRef(ref)).toEqual({
      kind: 'prd',
      lineRange: [3, 7],
    })
  })

  it('requirement 无 line_range → null(非法)', () => {
    const ref: SourceRef = { kind: 'requirement', relative_path: 'requirement.md' }
    expect(sharedSourceRefToWebRef(ref)).toBeNull()
  })

  it('aux → aux,aux_id → auxId', () => {
    const ref: SourceRef = { kind: 'aux', aux_id: 'aux-api', line_range: [0, 3] }
    expect(sharedSourceRefToWebRef(ref)).toEqual({
      kind: 'aux',
      auxId: 'aux-api',
      lineRange: [0, 3],
    })
  })

  it('asset → asset,asset_id → assetId', () => {
    const ref: SourceRef = { kind: 'asset', asset_id: 'prd-diagram.png' }
    expect(sharedSourceRefToWebRef(ref)).toEqual({
      kind: 'asset',
      assetId: 'prd-diagram.png',
    })
  })

  it('repository → null(本期不渲染 repository 阅读器)', () => {
    const ref: SourceRef = {
      kind: 'repository',
      repo_name: 'orders',
      relative_path: 'src/index.ts',
      line_range: [0, 10],
    }
    expect(sharedSourceRefToWebRef(ref)).toBeNull()
  })
})

// ============================================================================
// AnalysisIssueList 组件测试
// ============================================================================

describe('AnalysisIssueList 组件', () => {
  it('空列表 → 渲染空态文案', () => {
    render(
      <AnalysisIssueList
        issues={[]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const root = screen.getByTestId('analysis-issue-list')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.textContent).toContain('暂无')
  })

  it('多条 Issue → 渲染所有卡 + 标题 + 描述 + ordinal', () => {
    const issues: AnalysisIssue[] = [
      buildIssue({
        issue_id: 'iss-1',
        ordinal: 1,
        title: 'PRD 缺少验收标准',
        description: '当前 PRD 没有给出通过条件',
        source_refs: [
          { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
        ],
      }),
      buildIssue({
        issue_id: 'iss-2',
        ordinal: 2,
        title: 'API 接口契约模糊',
        description: 'POST /orders 的入参响应未明确',
        source_refs: [
          { kind: 'aux', aux_id: 'aux-api', line_range: [0, 3] },
        ],
      }),
    ]
    render(
      <AnalysisIssueList
        issues={issues}
        prdExists
        auxFiles={auxFiles}
        assetList={assetList}
      />,
    )
    const root = screen.getByTestId('analysis-issue-list')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-issue-count')).toBe('2')
    expect(screen.getByText('PRD 缺少验收标准')).toBeTruthy()
    expect(screen.getByText('API 接口契约模糊')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('#2')).toBeTruthy()
  })

  it('可定位的 SourceRef 渲染为 button + click → onSourceRefClick', async () => {
    const ref: SourceRef = {
      kind: 'requirement',
      relative_path: 'requirement.md',
      line_range: [0, 5],
    }
    const issue = buildIssue({ source_refs: [ref] })
    const onClick = vi.fn()
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={auxFiles}
        assetList={assetList}
        onSourceRefClick={onClick}
      />,
    )
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-missing')).toBe('false')
    expect(chips[0].getAttribute('data-source-kind')).toBe('requirement')
    await userEvent.click(chips[0])
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]?.[0]).toEqual(ref)
  })

  it('缺失的 SourceRef 渲染为静态 span + 不触发 onSourceRefClick', async () => {
    const missingRef: SourceRef = { kind: 'aux', aux_id: 'aux-deleted', line_range: [0, 3] }
    const issue = buildIssue({ source_refs: [missingRef] })
    const onClick = vi.fn()
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={auxFiles} // 没有 aux-deleted
        assetList={assetList}
        onSourceRefClick={onClick}
      />,
    )
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-missing')).toBe('true')
    expect(chips[0].tagName.toLowerCase()).toBe('span')
    // 强制 fireEvent 也不触发(因为是 span 不是 button)
    fireEvent.click(chips[0])
    expect(onClick).not.toHaveBeenCalled()
  })

  it('所有 SourceRef 都缺失 → Issue 卡挂"⚠️ 引用缺失"角标', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
        { kind: 'aux', aux_id: 'aux-deleted', line_range: [0, 3] },
      ],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists={false} // requirement 也缺失
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const card = screen.getByTestId('analysis-issue-card')
    expect(card.getAttribute('data-all-sources-missing')).toBe('true')
    expect(screen.getByTestId('analysis-issue-missing-badge')).toBeTruthy()
  })

  it('仅部分 SourceRef 缺失 → 卡不挂角标,但缺失 chip 标 data-missing=true', () => {
    const good: SourceRef = {
      kind: 'requirement',
      relative_path: 'requirement.md',
      line_range: [0, 5],
    }
    const bad: SourceRef = { kind: 'aux', aux_id: 'aux-deleted', line_range: [0, 3] }
    const issue = buildIssue({ source_refs: [good, bad] })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={auxFiles}
        assetList={assetList}
      />,
    )
    const card = screen.getByTestId('analysis-issue-card')
    expect(card.getAttribute('data-all-sources-missing')).toBe('false')
    expect(screen.queryByTestId('analysis-issue-missing-badge')).toBeNull()
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    const missingChip = chips.find((c) => c.getAttribute('data-missing') === 'true')
    const okChip = chips.find((c) => c.getAttribute('data-missing') === 'false')
    expect(missingChip).toBeTruthy()
    expect(okChip).toBeTruthy()
  })

  it('metadata 数组 → 渲染为通用键值展示', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
      metadata: [
        ['severity', 'high'],
        ['category', 'completeness'],
        ['confidence', 0.95],
      ] as AnalysisIssue['metadata'],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const dl = screen.getByTestId('analysis-issue-metadata')
    expect(dl.textContent).toContain('severity')
    expect(dl.textContent).toContain('high')
    expect(dl.textContent).toContain('category')
    expect(dl.textContent).toContain('completeness')
    expect(dl.textContent).toContain('confidence')
    expect(dl.textContent).toContain('0.95')
  })

  it('repository 类型的 SourceRef 始终渲染为缺失(review · 阅读器外)', () => {
    const issue = buildIssue({
      source_refs: [
        {
          kind: 'repository',
          repo_name: 'orders',
          relative_path: 'src/index.ts',
          line_range: [10, 20],
        },
      ],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    expect(chips).toHaveLength(1)
    expect(chips[0].getAttribute('data-missing')).toBe('true')
    expect(chips[0].getAttribute('data-source-kind')).toBe('repository')
  })

  // issue 03 review 反馈 · metadata 重复 key 不应静默覆盖
  it('metadata 同名 key 重复 → 各自独立渲染(不静默覆盖)', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
      metadata: [
        ['severity', 'high'],
        ['severity', 'low'], // 重复 key,以前会被 Record 静默覆盖
      ] as AnalysisIssue['metadata'],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const dl = screen.getByTestId('analysis-issue-metadata')
    // 两个 dt 元素都存在(各自独立渲染)
    expect(dl.querySelectorAll('dt')).toHaveLength(2)
    expect(dl.textContent).toContain('high')
    expect(dl.textContent).toContain('low')
  })

  // issue 03 review 反馈 · 来源漂移(AuxFile 删除后,前端不崩)
  it('来源漂移:Issue 报告时 auxFiles 命中,渲染时 auxFile 已删除 → 标 missing,页面不崩', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'aux', aux_id: 'aux-deleted-later', line_range: [0, 3] },
      ],
    })
    // 渲染时 auxFiles 已无 'aux-deleted-later'
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]} // 漂移:此 aux 已不存在
        assetList={assetList}
      />,
    )
    const card = screen.getByTestId('analysis-issue-card')
    expect(card.getAttribute('data-all-sources-missing')).toBe('true')
    expect(screen.getByTestId('analysis-issue-missing-badge')).toBeTruthy()
    // chip 渲染为静态 span,无 button
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    expect(chips[0].tagName.toLowerCase()).toBe('span')
    expect(chips[0].getAttribute('data-missing')).toBe('true')
  })

  // issue 03 review 反馈 · 来源漂移(asset 删除)
  it('来源漂移:Issue 报告时 asset 命中,渲染时 asset 已不在 assetList → 标 missing', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'asset', asset_id: 'removed.png' },
      ],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]} // 漂移:asset 已不在
      />,
    )
    const chips = screen.getAllByTestId('analysis-issue-source-ref')
    expect(chips[0].getAttribute('data-missing')).toBe('true')
    expect(chips[0].getAttribute('data-source-kind')).toBe('asset')
  })
})

// ============================================================================
// 滚动条修复 · 高度契约(2026-08 grill-with-docs)
// 根因:外层 div 缺 `h-full`,导致 inner `flex-1 overflow-auto` 拿不到约束高度,
// scrollbar 不触发;改为 `h-full` 后 outer 拿父 wrapper 的 flex 分配高度,inner
// 进入"约束 < 内容"状态,scrollbar 触发。契约:组件要求父级提供 definite height。
// ============================================================================

describe('AnalysisIssueList · 高度契约 / 滚动条', () => {
  it('非空态:外层根 div 包含 h-full 类(让 inner 能拿到约束高度 → scroll 触发)', () => {
    const issue = buildIssue({
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
    })
    render(
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const root = screen.getByTestId('analysis-issue-list')
    expect(root.className).toContain('h-full')
  })

  it('空态:外层根 div 也包含 h-full 类(空态卡片同样占满 wrapper,视觉一致)', () => {
    render(
      <AnalysisIssueList
        issues={[]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const root = screen.getByTestId('analysis-issue-list')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.className).toContain('h-full')
  })

  it('内层列表 div 保留 flex-1 overflow-auto(滚动容器仍由组件自身负责)', () => {
    // 33 条 Issue 模拟溢出场景
    const issues: AnalysisIssue[] = Array.from({ length: 33 }, (_, i) =>
      buildIssue({
        issue_id: `iss-${i + 1}`,
        ordinal: i + 1,
        source_refs: [
          { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
        ],
      }),
    )
    render(
      <AnalysisIssueList
        issues={issues}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    // 卡片 root 之下、内层列表 div 是 root 的直接子元素
    const root = screen.getByTestId('analysis-issue-list')
    const listDiv = root.querySelector(':scope > div:nth-of-type(2)') as HTMLElement
    expect(listDiv).not.toBeNull()
    expect(listDiv.className).toContain('flex-1')
    expect(listDiv.className).toContain('overflow-auto')
    // 33 张卡全部进入 DOM(滚动由 inner 接管,不靠 outer 撑高)
    const cards = screen.getAllByTestId('analysis-issue-card')
    expect(cards).toHaveLength(33)
  })

  it('父级包裹 div 缺约束高度时组件不报错(契约边界 · 调用方负责保证 wrapper 高度)', () => {
    // 故意不套 flex-[2] min-h-0 wrapper 渲染 → jsdom 不算 layout,组件只断言
    // "根 div 已声明 h-full";若 caller 没提供高度,实际滚动不生效(浏览器层)——
    // 此用例只锁组件契约,锁不住调用方失误(由 e2e 覆盖)。
    const issue = buildIssue({
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
    })
    render(
      // 注意:此处故意不放 wrapper —— 测的是组件自身
      <AnalysisIssueList
        issues={[issue]}
        prdExists
        auxFiles={[]}
        assetList={[]}
      />,
    )
    const root = screen.getByTestId('analysis-issue-list')
    expect(root.className).toContain('h-full')
  })
})