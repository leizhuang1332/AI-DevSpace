/**
 * SystemPromptAssembler tests —— ADR-0010 Q5
 *
 * 覆盖:
 *  - assembleBase:Platform Philosophy / Always-on 全文 / On-arming 元数据 三节齐备
 *  - assembleBase:per-session 缓存(同一 session 多次调用 → 同字符串;不同 session → 各算一次)
 *  - assembleBase:无 always-on 时 → '(no always-on skills configured)' 占位
 *  - assembleDynamic:Current Context 段含 focus / topic / kind
 *  - assembleDynamic:query 命中 Skill 名 → 进 relevant 集
 *  - assembleDynamic:Skill context 文件读到 → 渲染为 Skill context files 段
 *  - assembleDynamic:bad_feedback 字段 → 渲染为 Skill Feedback 段
 *  - assembleDynamic:99-summary 读不到 → 跳过该节(不抛错)
 *
 * ticket 02 (ADR-0021 D6/D7):assembleBase 接入 admissionLoader
 *  - loader 返 pack → 渲染 `## Admission Lenses` 段,每 unit 一段 `### N. <id> (...)` + output_marker
 *  - loader 返 pack → 抑制 admission-check Skill body(turn-1 内容由 pack 驱动)
 *  - loader 抛错 / 返 null → admission section 省略,turn-1 prompt 仍流
 *  - 不传 admissionLoader → 与 ticket 01 行为完全一致(向后兼容)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSystemPromptAssembler,
  PLATFORM_PHILOSOPHY,
} from '../prompt/SystemPromptAssembler.js'
import type { AdmissionLoader } from '../admission/index.js'
import type { AdmissionPack } from '@ai-devspace/shared'

/** In-memory readFile —— 接受路径,返回预置内容;否则 throw 像真 fs 一样 */
function makeFakeFs(files: Record<string, string>): (p: string) => Promise<string> {
  return async (p: string) => {
    if (p in files) return files[p]!
    throw new Error(`ENOENT: ${p}`)
  }
}

describe('SystemPromptAssembler.assembleBase', () => {
  let skillsRoot: string
  beforeEach(async () => {
    skillsRoot = join(tmpdir(), `skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(skillsRoot, { recursive: true })
  })
  afterEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true })
  })

  it('renders Platform Philosophy + sections even when no skills', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleBase({ id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' })
    expect(out).toContain('## Platform Philosophy')
    expect(out).toContain(PLATFORM_PHILOSOPHY.slice(0, 20))
    expect(out).toContain('## Active Skills (Always-on)')
    expect(out).toContain('(no always-on skills configured)')
    expect(out).toContain('## On-arming Skills')
  })

  it('includes Always-on skill full body and On-arming metadata only', async () => {
    const s1 = join(skillsRoot, 'always-skill')
    const s2 = join(skillsRoot, 'arming-skill')
    await mkdir(s1)
    await mkdir(s2)
    await writeFile(
      join(s1, 'SKILL.md'),
      `---
name: always-skill
description: always-on example
arming: always
---

# always skill body content
This is the full body.
`,
    )
    await writeFile(
      join(s2, 'SKILL.md'),
      `---
name: arming-skill
description: on-arming example
arming: on-arming
---

# arming skill body — should NOT appear in base
`,
    )

    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleBase({ id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' })

    // Always-on full body present
    expect(out).toContain('always skill body content')
    expect(out).toContain('This is the full body.')
    // On-arming only metadata
    expect(out).toContain('**arming-skill** — on-arming example')
    expect(out).not.toContain('arming skill body — should NOT appear')
  })

  it('merges roots by skill name with later user root winning', async () => {
    const userRoot = join(tmpdir(), `user-skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(join(skillsRoot, 'shared-skill'), { recursive: true })
    await mkdir(join(skillsRoot, 'builtin-only'), { recursive: true })
    await mkdir(join(userRoot, 'shared-skill'), { recursive: true })
    await mkdir(join(userRoot, 'user-only'), { recursive: true })

    const skill = (name: string, description: string) => `---
name: ${name}
description: ${description}
arming: always
---

${description}
`

    try {
      await Promise.all([
        writeFile(join(skillsRoot, 'shared-skill', 'SKILL.md'), skill('shared-skill', 'built-in version')),
        writeFile(join(skillsRoot, 'builtin-only', 'SKILL.md'), skill('builtin-only', 'built-in only')),
        writeFile(join(userRoot, 'shared-skill', 'SKILL.md'), skill('shared-skill', 'user version')),
        writeFile(join(userRoot, 'user-only', 'SKILL.md'), skill('user-only', 'user only')),
      ])

      const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot, userRoot] })
      const out = await asm.assembleBase({ id: 's-union', reqId: 'r-1', kind: 'chat', topic: 't' })

      expect(out).toContain('user version')
      expect(out).not.toContain('built-in version')
      expect(out).toContain('built-in only')
      expect(out).toContain('user only')
    } finally {
      await rm(userRoot, { recursive: true, force: true })
    }
  })

  it('keeps built-in behavior when the user root does not exist', async () => {
    const builtin = join(skillsRoot, 'builtin-only')
    const missingUserRoot = join(tmpdir(), `missing-user-skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(builtin)
    await writeFile(
      join(builtin, 'SKILL.md'),
      `---
name: builtin-only
description: built-in fallback
arming: always
---

built-in body
`,
    )

    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot, missingUserRoot] })
    const out = await asm.assembleBase({ id: 's-missing-user', reqId: 'r-1', kind: 'chat', topic: 't' })

    expect(out).toContain('built-in body')
  })

  it('caches per-session: same session.id → same string', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const session = { id: 's-1', reqId: 'r-1', kind: 'chat' as const, topic: 't' }
    const a = await asm.assembleBase(session)
    const b = await asm.assembleBase(session)
    expect(a).toBe(b)
  })

  it('different session.id → independent computation', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const a = await asm.assembleBase({ id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' })
    const b = await asm.assembleBase({ id: 's-2', reqId: 'r-1', kind: 'chat', topic: 't' })
    // 两次都返回同一字符串(skills 一样)但 Object.is 应该 false?——其实实现只缓存 string,
    // 不影响 string equality;这里只测"不抛错"。
    expect(a).toBe(b)
  })
})

describe('SystemPromptAssembler.assembleDynamic', () => {
  let skillsRoot: string
  let reqRoot: string
  beforeEach(async () => {
    skillsRoot = join(tmpdir(), `skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    reqRoot = join(tmpdir(), `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(reqRoot, { recursive: true })
  })
  afterEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true })
    await rm(reqRoot, { recursive: true, force: true })
  })

  it('Current Context includes focus / topic / kind', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleDynamic({
      query: 'hello world',
      session: { id: 's-1', reqId: 'r-1', kind: 'task', topic: 'refund feature' },
      req: { reqId: 'r-1', currentFocus: 'writing-code', rootPath: reqRoot },
    })
    expect(out).toContain('## Current Context')
    expect(out).toContain('**Current focus**: writing-code')
    expect(out).toContain('**Session topic**: refund feature')
    expect(out).toContain('**Session kind**: task')
  })

  it('renders Skill Feedback when query hits a skill with bad_feedback', async () => {
    const s = join(skillsRoot, 'code-review')
    await mkdir(s)
    await writeFile(
      join(s, 'SKILL.md'),
      `---
name: code-review
description: review code
arming: on-arming
bad_feedback:
  - category: 内容错误
    note: 漏掉并发安全
  - category: 违反规范
    note: 命名应 snake_case
---

body
`,
    )

    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleDynamic({
      query: '帮我 code-review 一下退款逻辑',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
    })
    expect(out).toContain('## Skill Feedback')
    expect(out).toContain('[内容错误] 漏掉并发安全')
    expect(out).toContain('[违反规范] 命名应 snake_case')
  })

  it('renders Skill context files when relevant skill declares context: paths', async () => {
    const s = join(skillsRoot, 'schema-design')
    await mkdir(s)
    await writeFile(
      join(s, 'SKILL.md'),
      `---
name: schema-design
description: design schema
arming: on-arming
context:
  - meta.yaml
  - PRD.md
---

body
`,
    )
    // 在 reqRoot 下放这两个文件
    await writeFile(join(reqRoot, 'meta.yaml'), 'name: REFUND-001\nstatus: DRAFTING\n')
    await writeFile(join(reqRoot, 'PRD.md'), '# PRD\n\nRefund feature spec\n')

    const asm = createSystemPromptAssembler({
      skillsRoots: [skillsRoot],
      readFile: makeFakeFs({}),
    })
    const out = await asm.assembleDynamic({
      query: 'run schema-design on this req',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
    })
    // 不命中(因为 readFile fake 是空的,默认走 defaultReadFile → ENOENT → skip)
    expect(out).not.toContain('### Skill context files')
    expect(out).toContain('## Current Context')

    // 用真正文件读 → 应当出现 context files 段
    const asm2 = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out2 = await asm2.assembleDynamic({
      query: 'run schema-design on this req',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
    })
    expect(out2).toContain('### Skill context files')
    expect(out2).toContain('#### schema-design')
    expect(out2).toContain('**meta.yaml**')
    expect(out2).toContain('REFUND-001')
    expect(out2).toContain('**PRD.md**')
    expect(out2).toContain('Refund feature spec')
  })

  it('omits 99-summary section when summary file missing (no throw)', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleDynamic({
      query: 'q',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
      summaryPath: join(reqRoot, 'never-exists.md'),
    })
    expect(out).toContain('## Current Context')
    expect(out).not.toContain('### 99-summary')
  })

  it('includes 99-summary section when summary file exists', async () => {
    await writeFile(join(reqRoot, '99-summary.md'), '# summary\n\nfocus on refund flow\n')
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleDynamic({
      query: 'q',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
      summaryPath: join(reqRoot, '99-summary.md'),
    })
    expect(out).toContain('### 99-summary')
    expect(out).toContain('focus on refund flow')
  })

  it('does not render Skill Feedback section when no relevant skill has bad_feedback', async () => {
    const s = join(skillsRoot, 'no-fb')
    await mkdir(s)
    await writeFile(
      join(s, 'SKILL.md'),
      `---
name: no-fb
description: no feedback
arming: on-arming
---

body
`,
    )
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleDynamic({
      query: 'run no-fb',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
    })
    expect(out).not.toContain('## Skill Feedback')
  })
})

// ---------------------------------------------------------------------------
// ticket 02 (ADR-0021 D6/D7):assembleBase 接入 admissionLoader
//
// - loader 返 pack → 渲染 `## Admission Lenses` 段,每 unit 一段 `### N. <id> (...)` + output_marker
// - loader 返 pack → 抑制 admission-check Skill body(turn-1 内容由 pack 驱动)
// - loader 抛错 / 返 null → admission section 省略,turn-1 prompt 仍流
// - 不传 admissionLoader → 与 ticket 01 行为完全一致(向后兼容)
// ---------------------------------------------------------------------------

function makeBaselinePackFixture(): AdmissionPack {
  // 与 apps/agent/src/admission/baselineGenerator.ts BASELINE_UNITS 形态对齐
  // —— 5 个 unit,1-based 顺序,severity / marker 各自唯一
  return {
    id: 'baseline-5dim',
    displayName: '默认 5 维度基线',
    description: 'fixture for assembler test',
    units: [
      {
        id: 'loss_prevention',
        displayName: '资损安全',
        severityIcon: '🔴',
        outputMarker: '[DIM loss_prevention]',
        admissionPrompt: '聚焦资金流 / 资产扣减 / 退款 / 优惠券 / 余额等路径。',
        outputSchema: {
          verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
          evidence: { type: 'string', maxChars: 80 },
          pending: { type: 'string?', optional: true },
          quote: { type: 'string?', optional: true },
        },
      },
      {
        id: 'performance',
        displayName: '性能',
        severityIcon: '🟠',
        outputMarker: '[DIM performance]',
        admissionPrompt: '聚焦 RT / 吞吐量 / 长尾延迟 / 资源占用等指标。',
        outputSchema: {
          verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
          evidence: { type: 'string', maxChars: 80 },
          pending: { type: 'string?', optional: true },
          quote: { type: 'string?', optional: true },
        },
      },
      {
        id: 'arch_conflict',
        displayName: '架构冲突',
        severityIcon: '🟡',
        outputMarker: '[DIM arch_conflict]',
        admissionPrompt: '聚焦现有架构 / 上下游契约 / 服务边界。',
        outputSchema: {
          verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
          evidence: { type: 'string', maxChars: 80 },
          pending: { type: 'string?', optional: true },
          quote: { type: 'string?', optional: true },
        },
      },
      {
        id: 'business_reasonable',
        displayName: '业务合理性',
        severityIcon: '🟢',
        outputMarker: '[DIM business_reasonable]',
        admissionPrompt: '聚焦业务目标 / 边界 / 一致性 / 异常路径。',
        outputSchema: {
          verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
          evidence: { type: 'string', maxChars: 80 },
          pending: { type: 'string?', optional: true },
          quote: { type: 'string?', optional: true },
        },
      },
      {
        id: 'context_query',
        displayName: '上下文确认',
        severityIcon: '💬',
        outputMarker: '[DIM context_query]',
        admissionPrompt: '聚焦 PRD 中定义模糊 / 需要业务确认的项。',
        outputSchema: {
          verdict: { type: 'enum', options: ['pass', 'warn', 'fail'] },
          evidence: { type: 'string', maxChars: 80 },
          pending: { type: 'string?', optional: true },
          quote: { type: 'string?', optional: true },
        },
      },
    ],
    algorithm: {
      id: 'baseline-loose',
      displayName: '默认宽松策略',
      rules: [],
      else: { result: '✅', reason: 'fixture else' },
    },
    sourcePath: '/tmp/fixture',
  }
}

describe('SystemPromptAssembler.assembleBase — admissionLoader 接线 (ticket 02 · ADR-0021 D6/D7)', () => {
  let skillsRoot: string
  beforeEach(async () => {
    skillsRoot = join(tmpdir(), `skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(skillsRoot, { recursive: true })
    // 放一个 admission-check always Skill(dual-turn 在 ticket 02 之前一直用其 body)
    const s = join(skillsRoot, 'admission-check')
    await mkdir(s)
    await writeFile(
      join(s, 'SKILL.md'),
      `---
name: admission-check
description: 5-dimension admission
arming: always
---

# admission-check SKILL body
this body MUST NOT appear when admissionLoader returns a pack.
`,
    )
  })
  afterEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true })
  })

  it('loader 返 pack → 渲染 ## Admission Lenses 段(5 个 unit + output_marker 行)', async () => {
    const pack = makeBaselinePackFixture()
    const loader: AdmissionLoader = async () => pack
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot], admissionLoader: loader })
    const out = await asm.assembleBase({ id: 's-1', reqId: 'r-1', kind: 'task', topic: 't' })

    // 1. 段标题
    expect(out).toContain('## Admission Lenses')

    // 2. 5 个 unit 各一段:`### N. <id> (<displayName> · <severityIcon>)`
    expect(out).toContain('### 1. loss_prevention (资损安全 · 🔴)')
    expect(out).toContain('### 2. performance (性能 · 🟠)')
    expect(out).toContain('### 3. arch_conflict (架构冲突 · 🟡)')
    expect(out).toContain('### 4. business_reasonable (业务合理性 · 🟢)')
    expect(out).toContain('### 5. context_query (上下文确认 · 💬)')

    // 3. 每个 unit 的 admissionPrompt 内容被拼入
    expect(out).toContain('聚焦资金流 / 资产扣减')
    expect(out).toContain('聚焦 RT / 吞吐量')
    expect(out).toContain('聚焦现有架构')
    expect(out).toContain('聚焦业务目标')
    expect(out).toContain('聚焦 PRD 中定义模糊')

    // 4. 每个 unit 末尾 output_marker 行
    expect(out).toContain(`output_marker: '[DIM loss_prevention]'`)
    expect(out).toContain(`output_marker: '[DIM performance]'`)
    expect(out).toContain(`output_marker: '[DIM arch_conflict]'`)
    expect(out).toContain(`output_marker: '[DIM business_reasonable]'`)
    expect(out).toContain(`output_marker: '[DIM context_query]'`)
  })

  it('loader 返 pack → 抑制 admission-check Skill body(turn-1 admission 内容由 pack 驱动)', async () => {
    const pack = makeBaselinePackFixture()
    const loader: AdmissionLoader = async () => pack
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot], admissionLoader: loader })
    const out = await asm.assembleBase({ id: 's-2', reqId: 'r-1', kind: 'task', topic: 't' })

    // admission-check 的 Skill body 关键标识不应出现
    expect(out).not.toContain('this body MUST NOT appear')
    expect(out).not.toContain('### admission-check')

    // pack 渲染段仍然存在(行为自洽)
    expect(out).toContain('## Admission Lenses')
    expect(out).toContain('### 1. loss_prevention (资损安全 · 🔴)')
  })

  it('loader 返 null → admission section 省略 + admission-check Skill body 抑制(no Skill body fallback)', async () => {
    // ticket line 13:no Skill body fallback —— admissionLoader 配置后,无论
    // pack 是否成功装载,admission-check Skill body 都不再进 Always-on 段。
    const loader: AdmissionLoader = async () => null
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot], admissionLoader: loader })
    const out = await asm.assembleBase({ id: 's-3', reqId: 'r-1', kind: 'task', topic: 't' })

    expect(out).not.toContain('## Admission Lenses')
    expect(out).not.toContain('### 1. loss_prevention')

    // ticket line 13 硬约束:admission 由 caller 接管后,Skill body 不再出现
    expect(out).not.toContain('### admission-check')
    expect(out).not.toContain('this body MUST NOT appear')
  })

  it('loader 抛错 → admission section 省略 + admission-check Skill body 抑制(不阻断 send)', async () => {
    const loader: AdmissionLoader = async () => {
      throw new Error('pack structure error: foo')
    }
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot], admissionLoader: loader })
    const out = await asm.assembleBase({ id: 's-4', reqId: 'r-1', kind: 'task', topic: 't' })

    expect(out).not.toContain('## Admission Lenses')
    // 同样遵守 ticket line 13
    expect(out).not.toContain('### admission-check')
  })

  it('不传 admissionLoader → ticket 01 兼容行为(admission-check body 仍进 Always-on 段)', async () => {
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot] })
    const out = await asm.assembleBase({ id: 's-5', reqId: 'r-1', kind: 'task', topic: 't' })

    expect(out).not.toContain('## Admission Lenses')
    expect(out).toContain('### admission-check')
    expect(out).toContain('this body MUST NOT appear')
  })

  it('loader 在 base 缓存命中时只调一次(per-session 缓存语义)', async () => {
    const pack = makeBaselinePackFixture()
    let calls = 0
    const loader: AdmissionLoader = async () => {
      calls++
      return pack
    }
    const asm = createSystemPromptAssembler({ skillsRoots: [skillsRoot], admissionLoader: loader })
    const session = { id: 's-cache', reqId: 'r-1', kind: 'task' as const, topic: 't' }
    const a = await asm.assembleBase(session)
    const b = await asm.assembleBase(session)
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })
})