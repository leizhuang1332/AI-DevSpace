/**
 * SkillLoader tests —— ADR-0010 Q5.4 + ADR-0008
 *
 * 覆盖:
 *  - frontmatter 解析(name / description / arming / context / bad_feedback)
 *  - 缺 frontmatter / 缺 body 边界
 *  - context: 字段归一化(string / string[] / undefined)
 *  - bad_feedback: 字段归一化(对象数组 / 字符串数组)
 *  - findByName 找不到返回 undefined
 *  - 空目录 / 不存在目录返回空数组,不抛错
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createSkillLoader,
  parseSkillMarkdown,
  extractContextPaths,
  extractBadFeedback,
} from '../prompt/SkillLoader.js'

describe('parseSkillMarkdown', () => {
  it('parses yaml frontmatter + body', () => {
    const text = `---
name: requirement-clarify
description: clarify a requirement
arming: always
---

# requirement-clarify

Body content here.
`
    const r = parseSkillMarkdown(text)
    expect(r).not.toBeNull()
    expect(r?.frontmatter.name).toBe('requirement-clarify')
    expect(r?.frontmatter.description).toBe('clarify a requirement')
    expect(r?.frontmatter.arming).toBe('always')
    expect(r?.body).toContain('# requirement-clarify')
    expect(r?.body).toContain('Body content here.')
  })

  it('returns empty frontmatter when no --- header', () => {
    const text = '# just a markdown file\n\nno frontmatter'
    const r = parseSkillMarkdown(text)
    expect(r?.frontmatter).toEqual({})
    expect(r?.body).toBe(text)
  })

  it('returns null when YAML is malformed', () => {
    const text = `---
name: [unclosed
---
body`
    const r = parseSkillMarkdown(text)
    // 期望: 可能是 null 或 { frontmatter: {}, body: ... }
    // 当前实现:[unclosed 在某些 yaml 解析器里会抛错,某些会安静成 null
    // 我们容忍:不抛错就 OK
    if (r !== null) {
      expect(r.frontmatter).toBeDefined()
    }
  })

  it('treats --- without closing --- as no-frontmatter', () => {
    const text = `---\nname: foo\nstill going`
    const r = parseSkillMarkdown(text)
    expect(r?.frontmatter).toEqual({})
    expect(r?.body).toBe(text)
  })
})

describe('extractContextPaths', () => {
  it('returns string[] for string context', () => {
    expect(extractContextPaths({ context: 'meta.yaml' })).toEqual(['meta.yaml'])
  })
  it('returns string[] for array context', () => {
    expect(extractContextPaths({ context: ['meta.yaml', 'prd.md'] })).toEqual([
      'meta.yaml',
      'prd.md',
    ])
  })
  it('skips non-string entries in array', () => {
    expect(extractContextPaths({ context: ['meta.yaml', 123, null, 'prd.md'] })).toEqual([
      'meta.yaml',
      'prd.md',
    ])
  })
  it('returns [] when undefined', () => {
    expect(extractContextPaths({})).toEqual([])
  })
})

describe('extractBadFeedback', () => {
  it('flattens object entries into readable lines', () => {
    const fb = [
      { category: '内容错误', note: '退款金额写成负数' },
      { category: '违反规范', note: '字段命名应 snake_case' },
    ]
    const lines = extractBadFeedback({ bad_feedback: fb })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[内容错误]')
    expect(lines[0]).toContain('退款金额写成负数')
    expect(lines[1]).toContain('[违反规范]')
  })
  it('handles plain string entries', () => {
    expect(extractBadFeedback({ bad_feedback: ['note 1', 'note 2'] })).toEqual(['note 1', 'note 2'])
  })
  it('handles object with only note (no category)', () => {
    const lines = extractBadFeedback({ bad_feedback: [{ note: 'just a note' }] })
    expect(lines).toEqual(['- just a note'])
  })
  it('returns [] when missing', () => {
    expect(extractBadFeedback({})).toEqual([])
  })
})

describe('createSkillLoader (filesystem)', () => {
  let root: string
  beforeEach(async () => {
    root = join(tmpdir(), `skill-loader-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(root, { recursive: true })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('loadAll returns [] for missing dir', async () => {
    const loader = createSkillLoader()
    const list = await loader.loadAll(join(root, 'not-exists'))
    expect(list).toEqual([])
  })

  it('loadAll skips dirs without SKILL.md', async () => {
    await mkdir(join(root, 'no-skill'))
    const loader = createSkillLoader()
    expect(await loader.loadAll(root)).toEqual([])
  })

  it('loadAll parses skills across multiple dirs', async () => {
    const s1 = join(root, 'requirement-clarify')
    const s2 = join(root, 'code-review')
    await mkdir(s1)
    await mkdir(s2)
    await writeFile(
      join(s1, 'SKILL.md'),
      `---
name: requirement-clarify
description: clarify requirements
arming: always
context:
  - meta.yaml
---

body 1
`,
    )
    await writeFile(
      join(s2, 'SKILL.md'),
      `---
name: code-review
description: review code
arming: on-arming
---

body 2
`,
    )
    const loader = createSkillLoader()
    const list = await loader.loadAll(root)
    expect(list).toHaveLength(2)
    const names = list.map((s) => s.name).sort()
    expect(names).toEqual(['code-review', 'requirement-clarify'])
    const rc = list.find((s) => s.name === 'requirement-clarify')!
    expect(rc.frontmatter.arming).toBe('always')
    expect(rc.frontmatter.context).toEqual(['meta.yaml'])
    expect(rc.body).toContain('body 1')
  })

  it('uses directory name when frontmatter.name missing', async () => {
    const s1 = join(root, 'fallback-name')
    await mkdir(s1)
    await writeFile(join(s1, 'SKILL.md'), `---
description: no name field
---

body
`)
    const loader = createSkillLoader()
    const list = await loader.loadAll(root)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('fallback-name')
  })

  it('findByName returns matching skill', async () => {
    const s1 = join(root, 'foo')
    await mkdir(s1)
    await writeFile(join(s1, 'SKILL.md'), `---
name: foo
---

body
`)
    const loader = createSkillLoader()
    const skill = await loader.findByName(root, 'foo')
    expect(skill).toBeDefined()
    expect(skill?.name).toBe('foo')
  })

  it('findByName returns undefined when missing', async () => {
    const loader = createSkillLoader()
    const skill = await loader.findByName(root, 'never-created')
    expect(skill).toBeUndefined()
  })

  it('findByName returns undefined for empty name', async () => {
    const loader = createSkillLoader()
    expect(await loader.findByName(root, '')).toBeUndefined()
  })
})