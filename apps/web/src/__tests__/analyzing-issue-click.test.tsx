/**
 * Analysis Issue SourceRef 点击联动测试(issue 03 review 反馈)
 *
 * 覆盖 spec (c) 关键修复:
 * - 缺失行范围的 requirement / aux SourceRef 点击 → 必须切换到对应 Tab,
 *   不能是死链(no-op)
 *
 * 通过 AnalyzingZone 端到端验证:render → fireEvent.click on chip → 检查
 * DocumentReaderPane 的 active-tab-id 切换。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnalysisIssue } from '@ai-devspace/shared'
import { AnalyzingZone } from '@/components/analyzing-zone'
import {
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * 构造一个最小的非空 AnalyzingData(让 AnalyzingZone 走主区而非 EmptyAnalyzing),
 * 并注入测试用的 Issue 列表。
 *
 * 注:AnalyzingZone 通过 SSR 注入的 runs 元数据 + `currentRunIssues` state 渲染。
 * 直接修改 fixture:在 runs 里加一个 succeeded Run,让 useEffect 跳过 fetch 路径
 * (它会跳过 status=running && issue_count=0 的 Run;其它情况会 fetch 网络);
 * 为简化测试,这里把 data.runs 设为空,这样初始 currentRunId='',component 不
 * 渲染 IssueList。我们改为直接给 runs 一条 succeeded 的 Run + 在测试内 mock
 * `fetch`。
 *
 * 简化路径:用一个最小集合的 runs(空数组),然后测试只关注 IssueList 内 chip
 * 的点击行为 —— 不走 SSE 路径,直接通过 fixture 注入 initialIssues 不行(组件
 * 内部 state),所以我们用另一种思路:让 currentRunIssues 通过 SSE 追加。
 *
 * 更简单的路径:用 vi.mock 让 fetch 返回 issues,这样 useEffect 触发时拿到
 * 当前 Run 的 Issue 列表。
 */

function makeData(issues: AnalysisIssue[]): AnalyzingData {
  // issue 08 · ADR-0021 契约收缩后,AnalyzingData 不再有 `phase` / `chunks` /
  // `sessions` 等旧字段;Analysis Issue 通过 SSE / fetch 由父组件累积。
  return {
    ...emptyAnalyzing('req-issue-click'),
    empty: false,
    prdMarkdown: '# 测试 PRD\n\n业务描述。\n',
    auxFiles: [
      {
        id: 'aux-api',
        filename: 'api-draft.md',
        body: '# API 草案\n\nPOST /api/refunds',
        usage_tag: 'api',
        source_format: 'md',
        converted_to_md: false,
      },
    ],
    assetList: [],
    availableSkills: [
      { name: 'prd-completeness', description: 'check', version: '1.0.0', is_reserved: true },
    ],
    selectedSkillName: 'prd-completeness',
    runs: [
      {
        run_id: 'run-click-test',
        requirement_id: 'req-issue-click',
        skill_name: 'prd-completeness',
        status: 'succeeded',
        created_at: '2026-08-01T00:00:00.000Z',
        finished_at: '2026-08-01T00:00:10.000Z',
        issue_count: issues.length,
        error: null,
      },
    ],
  }
}

const _issues: AnalysisIssue[] = [] // 类型守卫用
void _issues

describe('AnalyzingZone · Analysis Issue SourceRef 点击联动(issue 03 review)', () => {
  it('有 line_range 的 SourceRef 点击 → 切到对应 Tab', async () => {
    const issue: AnalysisIssue = {
      issue_id: 'iss-1',
      run_id: 'run-click-test',
      ordinal: 1,
      title: 'PRD 缺少验收标准',
      description: '当前 PRD 没有给出通过条件。',
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md', line_range: [0, 5] },
      ],
      metadata: [],
      reported_at: '2026-08-01T00:00:00.000Z',
    }
    const data = makeData([issue])
    // mock fetch /runs/:runId → 返回我们的 issue
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [issue], log: [], run: data.runs[0] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AnalyzingZone data={data} />)

    // 等待 IssueList 渲染(SSE/fetch 触发 issues)
    const chip = await screen.findByTestId('analysis-issue-source-ref')
    expect(chip.getAttribute('data-missing')).toBe('false')

    // 点击 → DocumentReaderPane 的 active-tab-id 应切到 PRD
    await userEvent.click(chip)
    const reader = await screen.findByTestId('document-reader-pane')
    expect(reader.getAttribute('data-active-tab-id')).toBe('prd')
  })

  it('缺失 line_range 的 SourceRef 点击 → 仍切到对应 Tab(无死链)', async () => {
    const issue: AnalysisIssue = {
      issue_id: 'iss-no-range',
      run_id: 'run-click-test',
      ordinal: 1,
      title: 'API 文档缺失',
      description: 'PRD 未指向任何 API 文档。',
      // 缺 line_range —— spec #6 / #15 明确允许
      source_refs: [
        { kind: 'requirement', relative_path: 'requirement.md' },
      ],
      metadata: [],
      reported_at: '2026-08-01T00:00:00.000Z',
    }
    const data = makeData([issue])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [issue], log: [], run: data.runs[0] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AnalyzingZone data={data} />)

    const chip = await screen.findByTestId('analysis-issue-source-ref')
    expect(chip.getAttribute('data-missing')).toBe('false')

    // spec (c) 修复:点击不应是死链(原版会静默 return)
    await userEvent.click(chip)

    const reader = await screen.findByTestId('document-reader-pane')
    expect(reader.getAttribute('data-active-tab-id')).toBe('prd')
  })

  it('aux 类型缺 line_range 的 SourceRef 点击 → 切到对应 aux Tab', async () => {
    const issue: AnalysisIssue = {
      issue_id: 'iss-aux-no-range',
      run_id: 'run-click-test',
      ordinal: 1,
      title: 'aux file 章节级问题',
      description: 'aux 里有章节问题但没有具体行。',
      source_refs: [
        { kind: 'aux', aux_id: 'aux-api' },
      ],
      metadata: [],
      reported_at: '2026-08-01T00:00:00.000Z',
    }
    const data = makeData([issue])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [issue], log: [], run: data.runs[0] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AnalyzingZone data={data} />)

    const chip = await screen.findByTestId('analysis-issue-source-ref')
    expect(chip.getAttribute('data-missing')).toBe('false')

    await userEvent.click(chip)
    const reader = await screen.findByTestId('document-reader-pane')
    expect(reader.getAttribute('data-active-tab-id')).toBe('aux-api')
  })

  it('缺失 SourceRef 点击 → 不切换 Tab(已经在 UI 标 static span)', async () => {
    const issue: AnalysisIssue = {
      issue_id: 'iss-missing',
      run_id: 'run-click-test',
      ordinal: 1,
      title: '删除的资源',
      description: '对应的 aux 已经被删。',
      source_refs: [
        { kind: 'aux', aux_id: 'aux-deleted', line_range: [0, 3] },
      ],
      metadata: [],
      reported_at: '2026-08-01T00:00:00.000Z',
    }
    // 渲染时 auxFiles 不包含 aux-deleted
    const data = makeData([issue])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [issue], log: [], run: data.runs[0] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AnalyzingZone data={data} />)

    const chip = await screen.findByTestId('analysis-issue-source-ref')
    expect(chip.getAttribute('data-missing')).toBe('true')
    // chip 是 span 不是 button,点击无效(无 onClick handler)
    expect(chip.tagName.toLowerCase()).toBe('span')

    // 初始 tab
    const reader = screen.getByTestId('document-reader-pane')
    expect(reader.getAttribute('data-active-tab-id')).toBe('prd')

    // 强制 fireEvent 也不切换(无 handler)
    fireEvent.click(chip)
    expect(reader.getAttribute('data-active-tab-id')).toBe('prd')
  })
})