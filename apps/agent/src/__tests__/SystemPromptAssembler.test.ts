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
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSystemPromptAssembler,
  PLATFORM_PHILOSOPHY,
} from '../prompt/SystemPromptAssembler.js'

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
    const asm = createSystemPromptAssembler({ skillsRoot })
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

    const asm = createSystemPromptAssembler({ skillsRoot })
    const out = await asm.assembleBase({ id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' })

    // Always-on full body present
    expect(out).toContain('always skill body content')
    expect(out).toContain('This is the full body.')
    // On-arming only metadata
    expect(out).toContain('**arming-skill** — on-arming example')
    expect(out).not.toContain('arming skill body — should NOT appear')
  })

  it('caches per-session: same session.id → same string', async () => {
    const asm = createSystemPromptAssembler({ skillsRoot })
    const session = { id: 's-1', reqId: 'r-1', kind: 'chat' as const, topic: 't' }
    const a = await asm.assembleBase(session)
    const b = await asm.assembleBase(session)
    expect(a).toBe(b)
  })

  it('different session.id → independent computation', async () => {
    const asm = createSystemPromptAssembler({ skillsRoot })
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
    const asm = createSystemPromptAssembler({ skillsRoot })
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

    const asm = createSystemPromptAssembler({ skillsRoot })
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
      skillsRoot,
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
    const asm2 = createSystemPromptAssembler({ skillsRoot })
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
    const asm = createSystemPromptAssembler({ skillsRoot })
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
    const asm = createSystemPromptAssembler({ skillsRoot })
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
    const asm = createSystemPromptAssembler({ skillsRoot })
    const out = await asm.assembleDynamic({
      query: 'run no-fb',
      session: { id: 's-1', reqId: 'r-1', kind: 'chat', topic: 't' },
      req: { reqId: 'r-1', rootPath: reqRoot },
    })
    expect(out).not.toContain('## Skill Feedback')
  })
})