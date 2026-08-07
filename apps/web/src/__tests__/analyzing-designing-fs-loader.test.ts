/**
 * ANALYZING fs loader 测试
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
 * 注:原 DESIGNING fs loader 测试已随 ADR-0027(3 工位退役)删除 ——
 * `@/lib/designing` + `@/lib/designing.server` 整体退役。
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
