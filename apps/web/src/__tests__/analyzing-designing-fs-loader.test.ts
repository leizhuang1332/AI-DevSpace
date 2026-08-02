/**
 * ANALYZING + DESIGNING fs loader 测试
 *
 * 文件名保留 `analyzing-designing` 子串,以便 `pnpm --filter web test analyzing-designing`
 * 仍能匹配到本文件。
 *
 * ANALYZING 端(issue 08 · ADR-0021 契约收缩后):
 * - `getAnalyzingData(reqId)` 不再接受 options(已删 analysisSessionsDir /
 *   skillFrontmatter / lastSessionId / analysisDir 等旧字段)
 * - 不再读 `analysis/sessions/_index.yaml` / `chunks.jsonl` /
 *   `analysis/adjudication.md` / `technical-brief.md` / `modules.yaml`
 * - 只读:`requirement.md`(判定 empty)/ `aux/` / `assets/` /
 *   `analysis-skills/<name>/SKILL.md` / `analysis/selected-skill.yaml` /
 *   `analysis/runs/<run-id>/meta.yaml`
 *
 * DESIGNING 端:沿用既有契约不变,本文件保留其测试。
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAnalyzingData } from '@/lib/analyzing.server'
import { getDesigningDataFromFs } from '@/lib/designing.server'
import { emptyDesigning } from '@/lib/designing'

// ============================================================================
// fixture 隔离
// ============================================================================

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-zone-data-'))
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})

function writeRequirementMd(id: string, body = '# Fixture\n\ntest\n'): void {
  const reqDir = join(tmpRoot, 'requirements', id)
  mkdirSync(reqDir, { recursive: true })
  writeFileSync(join(reqDir, 'requirement.md'), body, 'utf8')
}

function writeAnalysisSkills(): void {
  const dir = join(tmpRoot, 'analysis-skills')
  mkdirSync(join(dir, 'prd-completeness'), { recursive: true })
  mkdirSync(join(dir, 'implementation-readiness'), { recursive: true })
  writeFileSync(
    join(dir, 'prd-completeness', 'SKILL.md'),
    [
      '---',
      'name: prd-completeness',
      'description: 检查 PRD 完整性',
      'version: 1.0.0',
      '---',
      '# PRD 完整性',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dir, 'implementation-readiness', 'SKILL.md'),
    [
      '---',
      'name: implementation-readiness',
      'description: 检查实施准备度',
      'version: 1.0.0',
      '---',
      '# 实施准备度',
    ].join('\n'),
    'utf8',
  )
}

/** 在 tmpRoot 同步建一个空的 analysis-skills 目录 —— 避免分析 Skill loader 回退
 * 到全局默认 `~/.aidevspace/analysis-skills`。 */
function writeEmptyAnalysisSkillsDir(): void {
  mkdirSync(join(tmpRoot, 'analysis-skills'), { recursive: true })
}

function writeAnalysisRuns(id: string, runs: { run_id: string; status: 'running' | 'succeeded' | 'failed'; created_at: string; skill_name: string; issue_count?: number }[]): void {
  const runsDir = join(tmpRoot, 'requirements', id, 'analysis', 'runs')
  for (const r of runs) {
    const dir = join(runsDir, r.run_id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'meta.yaml'),
      [
        `run_id: ${r.run_id}`,
        `requirement_id: ${id}`,
        `skill_name: ${r.skill_name}`,
        `status: ${r.status}`,
        `created_at: '${r.created_at}'`,
        `finished_at: null`,
        `issue_count: ${r.issue_count ?? 0}`,
        `error: null`,
        '',
      ].join('\n'),
      'utf8',
    )
  }
}

// ============================================================================
// ANALYZING · getAnalyzingData · 新契约(issue 08)
// ============================================================================

describe('ANALYZING · getAnalyzingData · issue 08 新契约', () => {
  it('没有 requirement.md → empty=true,其他字段容错为空', async () => {
    writeEmptyAnalysisSkillsDir()
    const data = await getAnalyzingData('req-fs-empty', { requirementsRoot: tmpRoot })
    expect(data.empty).toBe(true)
    expect(data.prdMarkdown).toBe('')
    expect(data.runs).toEqual([])
    expect(data.availableSkills).toEqual([])
  })

  it('requirement.md 存在但无 Skill 与 Run → empty=false,runs/skill 列表为空', async () => {
    writeRequirementMd('req-fs-only-prd')
    writeEmptyAnalysisSkillsDir()
    const data = await getAnalyzingData('req-fs-only-prd', { requirementsRoot: tmpRoot })
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown).toContain('# Fixture')
    expect(data.runs).toEqual([])
    expect(data.availableSkills).toEqual([])
    expect(data.selectedSkillName).toBe('')
  })

  it('读到 Analysis Skill 集合 + 字典序排序 + 已选择 Skill 解析', async () => {
    writeRequirementMd('req-fs-skills')
    writeAnalysisSkills()
    const data = await getAnalyzingData('req-fs-skills', { requirementsRoot: tmpRoot })
    expect(data.availableSkills.length).toBe(2)
    // 字典序:implementation-readiness < prd-completeness
    expect(data.availableSkills[0].name).toBe('implementation-readiness')
    expect(data.availableSkills[1].name).toBe('prd-completeness')
    // 无 selected-skill.yaml → 回退首项
    expect(data.selectedSkillName).toBe('implementation-readiness')
  })

  it('读到 Analysis Run 列表(按 created_at 倒序)', async () => {
    writeRequirementMd('req-fs-runs')
    writeAnalysisRuns('req-fs-runs', [
      { run_id: 'run-1', status: 'succeeded', created_at: '2026-08-01T08:00:00.000Z', skill_name: 'prd-completeness', issue_count: 2 },
      { run_id: 'run-2', status: 'running', created_at: '2026-08-01T10:00:00.000Z', skill_name: 'implementation-readiness' },
    ])
    const data = await getAnalyzingData('req-fs-runs', { requirementsRoot: tmpRoot })
    expect(data.runs.length).toBe(2)
    expect(data.runs[0].run_id).toBe('run-2')
    expect(data.runs[1].run_id).toBe('run-1')
  })

  it('旧 sessions 目录 / adjudication.md / technical-brief.md 全部被忽略', async () => {
    const id = 'req-fs-legacy'
    writeRequirementMd(id)
    // 即使磁盘上仍有旧会话索引 / adjudication / tech-brief / modules.yaml,
    // 新 loader 也不读取。
    const sessionsDir = join(tmpRoot, 'requirements', id, 'analysis', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(
      join(sessionsDir, '_index.yaml'),
      'sessions:\n  - id: sess-legacy\n    label: 旧会话\n    angle: custom\n    detected_count: 0\n    is_streaming: false\n',
      'utf8',
    )
    const analysisDir = join(tmpRoot, 'requirements', id, 'analysis')
    writeFileSync(join(analysisDir, 'adjudication.md'), '- item_id: a\n  applied: false\n', 'utf8')
    writeFileSync(join(analysisDir, 'technical-brief.md'), '# 旧技术概要\n', 'utf8')
    writeFileSync(join(analysisDir, 'modules.yaml'), 'modules: []\n', 'utf8')

    const data = await getAnalyzingData(id, { requirementsRoot: tmpRoot })
    expect(data.empty).toBe(false)
    // 旧文件不影响新契约:AnalyzingData 没有 sessions / techBriefPreview 等字段
    expect(data.runs).toEqual([])
    expect(data.availableSkills).toEqual([])
  })
})

// ============================================================================
// DESIGNING · 与 analyzing 并存的 fs loader 测试(沿用既有契约)
// ============================================================================

function writeDesignDir(id: string): string {
  const dir = join(tmpRoot, 'requirements', id, 'design')
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeFullDesignBundle(id: string): void {
  const dir = writeDesignDir(id)

  writeFileSync(
    join(dir, 'stage.yaml'),
    [
      'stage:',
      '  badge: ④ 设计',
      '  title: 退款功能优化 · DESIGNING',
      '  meta: 等选 3 / 3',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'candidates.yaml'),
    [
      'candidates:',
      '  - id: A',
      '    title: 同步单阶段',
      '    tag_label: 最简',
      '    tag_variant: simple',
      '    pros:',
      '      - 实现简单',
      '    cons:',
      '      - 高并发下性能差',
      '    metrics:',
      '      - label: 微服务调用',
      '        value: 3 个',
      '  - id: B',
      '    title: 异步多阶段',
      '    tag_label: AI 推荐',
      '    tag_variant: recommended',
      '    pros:',
      '      - 容错好',
      '    cons:',
      '      - 复杂度高',
      '    metrics:',
      '      - label: 预估延迟',
      '        value: 80ms',
      '        tone: good',
      '    recommended: true',
      '  - id: C',
      '    title: 同步+回滚',
      '    tag_label: 强一致',
      '    tag_variant: strict',
      '    pros:',
      '      - 一致性最强',
      '    cons:',
      '      - 复杂度高',
      '    metrics:',
      '      - label: 失败率',
      '        value: 0.001%',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'design_doc.yaml'),
    [
      'design_doc:',
      '  title: 退款功能 · 设计文档',
      '  markdown: |',
      '    ## 问题背景',
      '    退款链路当前调用 5 个微服务',
      '  toc:',
      '    - id: 问题背景',
      '      label: 问题背景',
      '      level: 0',
      '',
    ].join('\n'),
    'utf8',
  )

  writeFileSync(
    join(dir, 'tradeoff.yaml'),
    [
      'tradeoff:',
      '  rows:',
      '    - candidate_id: A',
      '      summary: 简单但性能差',
      '    - candidate_id: B',
      '      summary: 复杂度中等',
      '    - candidate_id: C',
      '      summary: 强一致但维护成本高',
      '  recommendation_candidate_id: B',
      '  recommendation_reason: 推荐 B',
      '',
    ].join('\n'),
    'utf8',
  )
}

describe('DESIGNING · getDesigningDataFromFs · design/ 目录不存在', () => {
  it('目录里没有 design/ → emptyDesigning(reqId)', async () => {
    const data = await getDesigningDataFromFs('req-no-design', {
      requirementsRoot: tmpRoot,
    })
    expect(data.requirementId).toBe('req-no-design')
    expect(data.empty).toBe(true)
    expect(data.candidates).toEqual([])
    expect(data.designDoc.markdown).toBe('')
    expect(data.tradeoff.rows).toEqual([])
  })

  it('requirements/ 目录根本不存在 → emptyDesigning', async () => {
    const data = await getDesigningDataFromFs('req-no-requirements', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

describe('DESIGNING · getDesigningDataFromFs · design/ 存在但 candidates.yaml 缺失', () => {
  it('只建 design/ 空目录 → emptyDesigning', async () => {
    writeDesignDir('req-empty-design')
    const data = await getDesigningDataFromFs('req-empty-design', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('candidates.yaml 存在但为空 → emptyDesigning', async () => {
    const dir = writeDesignDir('req-empty-yaml')
    writeFileSync(join(dir, 'candidates.yaml'), '', 'utf8')
    const data = await getDesigningDataFromFs('req-empty-yaml', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

describe('DESIGNING · getDesigningDataFromFs · 四 yaml 齐备且非空', () => {
  it('stage + candidates + design_doc + tradeoff 齐备 → empty=false,字段正确解析', async () => {
    writeFullDesignBundle('req-full')

    const data = await getDesigningDataFromFs('req-full', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-full')
    expect(data.empty).toBe(false)

    expect(data.stage.badge).toBe('④ 设计')
    expect(data.candidates.length).toBe(3)
    expect(data.candidates[0].id).toBe('A')
    expect(data.candidates[1].recommended).toBe(true)
    const goodMetric = data.candidates[1].metrics.find((m) => m.tone === 'good')
    expect(goodMetric).toBeDefined()
    expect(data.designDoc.title).toBe('退款功能 · 设计文档')
    expect(data.tradeoff.rows.length).toBe(3)
    expect(data.tradeoff.recommendation.candidateId).toBe('B')
  })

  it('selectedCandidateId 默认 null(组件 useState 接管)', async () => {
    writeFullDesignBundle('req-selected')
    const data = await getDesigningDataFromFs('req-selected', {
      requirementsRoot: tmpRoot,
    })
    expect(data.selectedCandidateId).toBeNull()
  })
})

describe('DESIGNING · 非 req-001 且 fs 没有 → emptyDesigning(reqId)', () => {
  it('语义与 emptyDesigning("NEW-REQ")一致', async () => {
    const fromFs = await getDesigningDataFromFs('NEW-REQ', { requirementsRoot: tmpRoot })
    const baseline = emptyDesigning('NEW-REQ')
    expect(fromFs.empty).toBe(baseline.empty)
    expect(fromFs.candidates).toEqual(baseline.candidates)
    expect(fromFs.designDoc.markdown).toBe(baseline.designDoc.markdown)
  })
})