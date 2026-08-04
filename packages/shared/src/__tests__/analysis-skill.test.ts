import { describe, it, expect } from 'vitest'
import {
  SemVerSchema,
  AnalysisSkillFrontmatterSchema,
  AnalysisSkillMetaSchema,
  AnalysisSkillListResponseSchema,
  AnalysisSkillSelectionResponseSchema,
  AnalysisSkillSelectionPutBodySchema,
  RESERVED_ANALYSIS_SKILL_NAMES,
  isReservedAnalysisSkillName,
} from '../analysis-skill.js'

describe('SemVerSchema', () => {
  it('接受标准 3 段', () => {
    expect(SemVerSchema.parse('1.0.0')).toBe('1.0.0')
    expect(SemVerSchema.parse('0.1.2')).toBe('0.1.2')
    expect(SemVerSchema.parse('10.20.30')).toBe('10.20.30')
  })

  it('接受 prerelease', () => {
    expect(SemVerSchema.parse('1.0.0-rc1')).toBe('1.0.0-rc1')
    expect(SemVerSchema.parse('1.0.0-alpha.1')).toBe('1.0.0-alpha.1')
  })

  it('接受 build metadata', () => {
    expect(SemVerSchema.parse('1.0.0+sha.deadbeef')).toBe('1.0.0+sha.deadbeef')
  })

  it('拒绝非 semver', () => {
    expect(() => SemVerSchema.parse('1.0')).toThrow()
    expect(() => SemVerSchema.parse('v1.0.0')).toThrow()
    expect(() => SemVerSchema.parse('1.0.0 ')).toThrow()
    expect(() => SemVerSchema.parse('')).toThrow()
  })
})

describe('AnalysisSkillFrontmatterSchema', () => {
  it('接受有效 frontmatter 三字段', () => {
    const r = AnalysisSkillFrontmatterSchema.parse({
      name: 'prd-completeness',
      description: '检查 PRD 完整性',
      version: '1.0.0',
    })
    expect(r.name).toBe('prd-completeness')
    expect(r.version).toBe('1.0.0')
  })

  it('空 description → 拒绝', () => {
    expect(() =>
      AnalysisSkillFrontmatterSchema.parse({
        name: 'foo',
        description: '',
        version: '1.0.0',
      }),
    ).toThrow()
  })

  it('空 name → 拒绝', () => {
    expect(() =>
      AnalysisSkillFrontmatterSchema.parse({
        name: '',
        description: 'd',
        version: '1.0.0',
      }),
    ).toThrow()
  })

  it('非 semver version → 拒绝', () => {
    expect(() =>
      AnalysisSkillFrontmatterSchema.parse({
        name: 'foo',
        description: 'd',
        version: 'abc',
      }),
    ).toThrow()
  })

  it('不含 is_reserved 字段(归 Meta 层加)', () => {
    const r = AnalysisSkillFrontmatterSchema.parse({
      name: 'foo',
      description: 'd',
      version: '1.0.0',
    })
    expect((r as { is_reserved?: unknown }).is_reserved).toBeUndefined()
  })
})

describe('AnalysisSkillMetaSchema', () => {
  it('接受完整有效条目', () => {
    const r = AnalysisSkillMetaSchema.parse({
      name: 'prd-completeness',
      description: '检查 PRD 完整性',
      version: '1.0.0',
      is_reserved: true,
    })
    expect(r.name).toBe('prd-completeness')
    expect(r.is_reserved).toBe(true)
  })

  it('空 description → 拒绝', () => {
    expect(() =>
      AnalysisSkillMetaSchema.parse({
        name: 'foo',
        description: '',
        version: '1.0.0',
        is_reserved: false,
      }),
    ).toThrow()
  })

  it('缺 name → 拒绝', () => {
    expect(() =>
      AnalysisSkillMetaSchema.parse({
        description: 'd',
        version: '1.0.0',
        is_reserved: false,
      }),
    ).toThrow()
  })

  it('非 semver version → 拒绝', () => {
    expect(() =>
      AnalysisSkillMetaSchema.parse({
        name: 'foo',
        description: 'd',
        version: 'abc',
        is_reserved: false,
      }),
    ).toThrow()
  })
})

describe('AnalysisSkillListResponseSchema', () => {
  it('接受空数组', () => {
    expect(AnalysisSkillListResponseSchema.parse({ skills: [] })).toEqual({
      skills: [],
    })
  })

  it('接受带条目的响应', () => {
    const r = AnalysisSkillListResponseSchema.parse({
      skills: [
        { name: 'a', description: 'A', version: '1.0.0', is_reserved: false },
        { name: 'b', description: 'B', version: '2.0.0', is_reserved: true },
      ],
    })
    expect(r.skills).toHaveLength(2)
  })

  it('拒绝非法条目', () => {
    expect(() =>
      AnalysisSkillListResponseSchema.parse({
        skills: [{ name: 'a', description: '', version: '1.0.0', is_reserved: false }],
      }),
    ).toThrow()
  })
})

describe('AnalysisSkillSelectionResponseSchema', () => {
  it('selected_skill_name 可为空字符串(无 selection / 已记住名不存在)', () => {
    const r = AnalysisSkillSelectionResponseSchema.parse({
      selected_skill_name: '',
      available_skills: [],
    })
    expect(r.selected_skill_name).toBe('')
  })

  it('selected_skill_name + available_skills 一起校验', () => {
    const r = AnalysisSkillSelectionResponseSchema.parse({
      selected_skill_name: 'prd-completeness',
      available_skills: [
        {
          name: 'prd-completeness',
          description: 'd',
          version: '1.0.0',
          is_reserved: true,
        },
      ],
    })
    expect(r.selected_skill_name).toBe('prd-completeness')
    expect(r.available_skills).toHaveLength(1)
  })
})

describe('AnalysisSkillSelectionPutBodySchema', () => {
  it('接受非空 skill_name', () => {
    expect(
      AnalysisSkillSelectionPutBodySchema.parse({ skill_name: 'foo' }),
    ).toEqual({ skill_name: 'foo' })
  })

  it('拒绝空 skill_name', () => {
    expect(() => AnalysisSkillSelectionPutBodySchema.parse({ skill_name: '' })).toThrow()
  })
})

describe('RESERVED_ANALYSIS_SKILL_NAMES / isReservedAnalysisSkillName', () => {
  it('包含两个默认名称', () => {
    expect(RESERVED_ANALYSIS_SKILL_NAMES).toContain('prd-completeness')
    expect(RESERVED_ANALYSIS_SKILL_NAMES).toContain('implementation-readiness')
  })

  it('isReservedAnalysisSkillName 仅在保留名单中返 true', () => {
    expect(isReservedAnalysisSkillName('prd-completeness')).toBe(true)
    expect(isReservedAnalysisSkillName('implementation-readiness')).toBe(true)
    expect(isReservedAnalysisSkillName('user-skill')).toBe(false)
    expect(isReservedAnalysisSkillName('')).toBe(false)
  })
})
