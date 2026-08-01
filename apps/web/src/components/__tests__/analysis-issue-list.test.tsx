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
    source_refs: partial.source_refs,
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
})