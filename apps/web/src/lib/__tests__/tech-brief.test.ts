import { describe, it, expect } from 'vitest'
import {
  parseModulesYaml,
  serializeModulesYaml,
  buildMockTechBrief,
  type TechBriefModulesFile,
} from '@/lib/tech-brief'

describe('parseModulesYaml', () => {
  it('空字符串 → 空 modules', () => {
    expect(parseModulesYaml('').modules).toEqual([])
  })

  it('解析合法 modules.yaml: id/name/description/deps/complexity/clarifying_questions', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: 幂等网关',
      '    description: 全局幂等键校验',
      '    deps:',
      '      - refund-service',
      '      - idem-store',
      '    complexity: high',
      '    clarifying_questions:',
      '      - id: q-1',
      '        question: 幂等键设计规则?',
      '      - id: q-2',
      '        question: 重试窗口期多长?',
      '        options:',
      '          - 5min',
      '          - 30min',
      '        required: true',
    ].join('\n')
    const file = parseModulesYaml(yaml)
    expect(file.modules).toHaveLength(1)
    const m = file.modules[0]
    expect(m.id).toBe('m-1')
    expect(m.name).toBe('幂等网关')
    expect(m.description).toBe('全局幂等键校验')
    expect(m.deps).toEqual(['refund-service', 'idem-store'])
    expect(m.complexity).toBe('high')
    expect(m.clarifying_questions).toHaveLength(2)
    expect(m.clarifying_questions![0]).toEqual({
      id: 'q-1',
      question: '幂等键设计规则?',
    })
    expect(m.clarifying_questions![1]).toEqual({
      id: 'q-2',
      question: '重试窗口期多长?',
      options: ['5min', '30min'],
      required: true,
    })
  })

  it('id 缺失 → 跳过该模块', () => {
    const yaml = 'modules:\n  - name: 漏 id\n    description: x\n  - id: m-ok\n    name: ok\n'
    const file = parseModulesYaml(yaml)
    expect(file.modules).toHaveLength(1)
    expect(file.modules[0].id).toBe('m-ok')
  })

  it('complexity 未知 → 默认 medium', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n    complexity: insane\n'
    expect(parseModulesYaml(yaml).modules[0].complexity).toBe('medium')
  })

  it('deps 缺失 → 空数组', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n'
    expect(parseModulesYaml(yaml).modules[0].deps).toEqual([])
  })

  it('clarifying_questions 缺失 → undefined', () => {
    const yaml = 'modules:\n  - id: m-1\n    name: x\n'
    expect(parseModulesYaml(yaml).modules[0].clarifying_questions).toBeUndefined()
  })

  it('单个 clarifying_question 缺 id → 跳过该 question', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: x',
      '    clarifying_questions:',
      '      - question: 漏 id',
      '      - id: q-ok',
      '        question: ok',
    ].join('\n')
    expect(parseModulesYaml(yaml).modules[0].clarifying_questions).toEqual([
      { id: 'q-ok', question: 'ok' },
    ])
  })

  it('question 缺 required 字段 → undefined', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: x',
      '    clarifying_questions:',
      '      - id: q-1',
      '        question: foo',
    ].join('\n')
    expect(parseModulesYaml(yaml).modules[0].clarifying_questions![0].required).toBeUndefined()
  })

  it('行尾注释与整行注释被忽略', () => {
    const yaml = [
      '# 头部注释',
      'modules:',
      '  # 列表注释',
      '  - id: m-1 # 行尾注释',
      '    name: x',
      '    description: d # 行尾注释',
      '    deps: []',
      '    complexity: low',
    ].join('\n')
    const file = parseModulesYaml(yaml)
    expect(file.modules).toHaveLength(1)
    expect(file.modules[0].name).toBe('x')
    expect(file.modules[0].description).toBe('d')
  })

  it('字符串值带双引号 → 去除引号', () => {
    const yaml = 'modules:\n  - id: "m-q"\n    name: \'带引号\'\n    deps: []\n    complexity: low\n'
    const m = parseModulesYaml(yaml).modules[0]
    expect(m.id).toBe('m-q')
    expect(m.name).toBe('带引号')
  })

  it('多个 module:按文件顺序解析', () => {
    const yaml = [
      'modules:',
      '  - id: m-1',
      '    name: A',
      '    deps: []',
      '    complexity: low',
      '  - id: m-2',
      '    name: B',
      '    deps: []',
      '    complexity: high',
    ].join('\n')
    const file = parseModulesYaml(yaml)
    expect(file.modules.map((m) => m.id)).toEqual(['m-1', 'm-2'])
  })
})

describe('serializeModulesYaml', () => {
  it('空 modules → "modules: []"', () => {
    expect(serializeModulesYaml({ modules: [] })).toBe('modules: []\n')
  })

  it('完整 modules → 含 deps / clarifying_questions / required / options', () => {
    const file: TechBriefModulesFile = {
      modules: [
        {
          id: 'm-1',
          name: '网关',
          description: '网关层',
          deps: ['svc-a'],
          complexity: 'high',
          clarifying_questions: [
            { id: 'q-1', question: '网关位置?' },
            { id: 'q-2', question: '网关规则?', options: ['白名单', '黑名单'], required: true },
          ],
        },
      ],
    }
    const out = serializeModulesYaml(file)
    expect(out).toContain('modules:')
    expect(out).toContain('  - id: m-1')
    expect(out).toContain('    name: 网关')
    expect(out).toContain('    description: 网关层')
    expect(out).toContain('    deps:')
    expect(out).toContain('      - svc-a')
    expect(out).toContain('    complexity: high')
    expect(out).toContain('    clarifying_questions:')
    expect(out).toContain('      - id: q-1')
    expect(out).toContain('        question: 网关位置?')
    expect(out).toContain('      - id: q-2')
    expect(out).toContain('        options:')
    expect(out).toContain('          - 白名单')
    expect(out).toContain('        required: true')
  })

  it('deps 为空 → 输出 "deps: []"(避免被解析成下一字段)', () => {
    const file: TechBriefModulesFile = {
      modules: [{ id: 'm-1', name: 'x', description: '', deps: [], complexity: 'low' }],
    }
    expect(serializeModulesYaml(file)).toContain('    deps: []')
  })

  it('parse → serialize → parse 往返一致(数据契约稳定)', () => {
    const original: TechBriefModulesFile = {
      modules: [
        {
          id: 'm-1',
          name: '网关',
          description: 'X',
          deps: ['a', 'b'],
          complexity: 'low',
          clarifying_questions: [{ id: 'q-1', question: 'Q?' }],
        },
      ],
    }
    const text = serializeModulesYaml(original)
    const parsed = parseModulesYaml(text)
    expect(parsed).toEqual(original)
  })

  it('复杂往返:含 options / required / 多 deps / 多 modules', () => {
    const original: TechBriefModulesFile = {
      modules: [
        {
          id: 'm-a',
          name: 'A',
          description: 'desc-a',
          deps: ['x', 'y', 'z'],
          complexity: 'high',
          clarifying_questions: [
            { id: 'q-1', question: 'a-q-1', options: ['1', '2'] },
            { id: 'q-2', question: 'a-q-2', required: true },
          ],
        },
        {
          id: 'm-b',
          name: 'B',
          description: '',
          deps: ['m-a'],
          complexity: 'low',
        },
      ],
    }
    const text = serializeModulesYaml(original)
    const parsed = parseModulesYaml(text)
    expect(parsed).toEqual(original)
  })
})

describe('buildMockTechBrief', () => {
  it('返回 deterministic 的双产物内容', () => {
    const result = buildMockTechBrief('sess-arch')
    expect(result.brief).toContain('# ')
    expect(result.brief).toContain('## 1. 业务背景与目标')
    expect(result.brief).toContain('## 4. 风险与缓解')
    expect(result.modules.modules).toHaveLength(4)
    const m0 = result.modules.modules[0]
    expect(m0).toHaveProperty('id')
    expect(m0).toHaveProperty('name')
    expect(m0).toHaveProperty('description')
    expect(m0).toHaveProperty('deps')
    expect(m0).toHaveProperty('complexity')
    expect(m0).toHaveProperty('clarifying_questions')
  })

  it('复杂度分布:含 low / medium / high 三档', () => {
    const result = buildMockTechBrief('sess-x')
    const cs = new Set(result.modules.modules.map((m) => m.complexity))
    expect(cs.has('low')).toBe(true)
    expect(cs.has('medium')).toBe(true)
    expect(cs.has('high')).toBe(true)
  })

  it('mock 内容能被 parse/serialize 还原(供 Agent 端 mock 共享同一契约)', () => {
    const result = buildMockTechBrief('sess-y')
    const text = serializeModulesYaml(result.modules)
    const parsed = parseModulesYaml(text)
    expect(parsed).toEqual(result.modules)
  })
})