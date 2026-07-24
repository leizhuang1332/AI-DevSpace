/**
 * ticket 02 (ADR-0020 D7):built-in SKILL.md 内容 + SkillLoader 装配一致性
 *
 * 覆盖:
 *  - 4 个 built-in Skill 目录 + SKILL.md 都存在(`apps/agent/skills/built-in/<name>/SKILL.md`)
 *  - SkillLoader.findByName(builtinDir, name) 能找到每个 Skill,返回非空 Skill
 *  - frontmatter.name === 目录名(契约,允许目录名作 fallback 但本期硬要求一致)
 *  - frontmatter.arming 是三档之一('always' | 'on-arming' | 'dormant')
 *  - admission-check / requirement-brainstorm 的 arming 必须是 'always'(start handler 装入)
 *  - tech-brief-scaffold / requirement-critique 的 arming 必须是 'on-arming'(本 PR 不装入)
 *  - 2 个推荐用户覆盖的 Skill(requirement-brainstorm / requirement-critique)必须有
 *    `recommended_user_override: true`;2 个不推荐的必须有 `recommended_user_override: false`
 *  - admission-check 的 body 含 5 维度 key(loss_prevention / performance / arch_conflict /
 *    business_reasonable / context_query)与 [VERDICT] 模板
 *  - requirement-brainstorm 的 body 含三桶标记([SUBPROBLEM] / [RISK] / [OPTION])与
 *    source_refs 字段说明
 *
 * 同时跑一个 turn-1 provider-stub 单测:admission-check Skill body 装入 system prompt 后,
 * fake provider 推一段"5 维度产物" → handler 把它落到 chunks.jsonl,验证文本能被解析出
 * 5 个 `[DIM xxx]` 块 + 1 个 `[VERDICT]` 块(本测覆盖 ticket 02 第 4 项验收)。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import Fastify, { type FastifyInstance } from 'fastify'
import { createSkillLoader, type Skill } from '../prompt/SkillLoader.js'
import { createSystemPromptAssembler } from '../prompt/SystemPromptAssembler.js'
import { createSseHub, type SseHub } from '../sse/SseHub.js'
import { analysisRoutes } from '../routes/analysis.js'
import { createRecordingProvider } from './__helpers__/fakeAnalysisProvider.js'

// built-in skills 根 —— 与 analysis.ts 的 resolveBuiltinSkillsDir() 候选路径一致
// (process.cwd()/apps/agent/skills/built-in 在 dev 单测里不一定成立)
// 这里用相对 import.meta.url 精确定位 src/ 同级的 skills/built-in
const here = dirname(fileURLToPath(import.meta.url))
const BUILTIN_DIR = resolve(here, '..', '..', 'skills', 'built-in')

const EXPECTED_SKILLS = [
  {
    name: 'admission-check',
    arming: 'always' as const,
    recommended_user_override: false,
  },
  {
    name: 'requirement-brainstorm',
    arming: 'always' as const,
    recommended_user_override: true,
  },
  {
    name: 'tech-brief-scaffold',
    arming: 'on-arming' as const,
    recommended_user_override: false,
  },
  {
    name: 'requirement-critique',
    arming: 'on-arming' as const,
    recommended_user_override: true,
  },
]

// 模块级缓存:在所有 describe 之前一次性 loadAll,避免每个 it 重复 createSkillLoader +
// findByName(整组 describe 都是只读探查,无副作用,共享同一份解析结果)。
let allSkills: Skill[]
let skillsByName: Map<string, Skill>
beforeAll(async () => {
  const loader = createSkillLoader()
  allSkills = await loader.loadAll(BUILTIN_DIR)
  skillsByName = new Map(allSkills.map((s) => [s.name, s]))
})

describe('built-in SKILL.md (ticket 02 · ADR-0020 D7)', () => {
  it('4 个 built-in 目录都在盘上,SKILL.md 都可读', () => {
    expect(allSkills).toHaveLength(EXPECTED_SKILLS.length)
    const names = allSkills.map((s) => s.name).sort()
    expect(names).toEqual(EXPECTED_SKILLS.map((s) => s.name).sort())
  })

  for (const spec of EXPECTED_SKILLS) {
    describe(`Skill ${spec.name}`, () => {
      it('findByName 能找到', () => {
        const skill = skillsByName.get(spec.name)
        expect(skill).toBeDefined()
        expect(skill?.name).toBe(spec.name)
      })

      it('frontmatter.name 与目录名一致(不允许漂移)', () => {
        const skill = skillsByName.get(spec.name)
        expect(skill).toBeDefined()
        // 契约:frontmatter.name 必须与目录名一致(否则下游 SkillLoader 装配会出现
        // builtin 路径下的目录名 vs frontmatter.name 不一致,union by name 时按 frontmatter
        // 走会导致 user-wins 误判)。
        expect(skill?.frontmatter.name).toBe(spec.name)
        expect(skill?.name).toBe(spec.name)
      })

      it(`arming 必须是 '${spec.arming}'`, () => {
        expect(skillsByName.get(spec.name)?.frontmatter.arming).toBe(spec.arming)
      })

      it(`recommended_user_override 必须是 ${spec.recommended_user_override}`, () => {
        // ticket 02 要求:2 个推荐覆盖 / 2 个不推荐覆盖
        expect(skillsByName.get(spec.name)?.frontmatter.recommended_user_override).toBe(
          spec.recommended_user_override,
        )
      })

      it('description 非空(进 On-arming system prompt 的 1 行描述)', () => {
        const skill = skillsByName.get(spec.name)
        expect(typeof skill?.frontmatter.description).toBe('string')
        expect((skill?.frontmatter.description ?? '').length).toBeGreaterThan(0)
      })

      it('body 非空(只有占位文字也算非空,但内容合法)', () => {
        const skill = skillsByName.get(spec.name)
        expect(typeof skill?.body).toBe('string')
        expect((skill?.body ?? '').length).toBeGreaterThan(0)
      })
    })
  }
})

// ---------------------------------------------------------------------------
// admission-check 5 维度契约 —— ADR-0013 D4 + ticket 02
// ---------------------------------------------------------------------------

describe('admission-check Skill body (5 维度契约)', () => {
  // 每个 it 都从缓存 Map 读一次(便宜;避免 describe 顶层 const 在 beforeAll 前求值的问题)
  const bodyOf = () => skillsByName.get('admission-check')?.body ?? ''

  it('body 含 5 个维度 key(loss_prevention / performance / arch_conflict / business_reasonable / context_query)', () => {
    const body = bodyOf()
    expect(body).toContain('loss_prevention')
    expect(body).toContain('performance')
    expect(body).toContain('arch_conflict')
    expect(body).toContain('business_reasonable')
    expect(body).toContain('context_query')
  })

  it('body 含 [VERDICT] 模板(总体结论 + pending_count 字段)', () => {
    const body = bodyOf()
    expect(body).toContain('[VERDICT]')
    expect(body).toContain('pending_count')
  })

  it('body 含 [DIM <key>] 模板(5 张 card 的输出格式)', () => {
    const body = bodyOf()
    expect(body).toMatch(/\[DIM\s+/)
    // 至少 5 个不同维度 key 出现(每个配 [DIM key] 标记)
    for (const k of [
      'loss_prevention',
      'performance',
      'arch_conflict',
      'business_reasonable',
      'context_query',
    ]) {
      expect(body).toContain(`[DIM ${k}]`)
    }
  })
})

// ---------------------------------------------------------------------------
// requirement-brainstorm 三桶契约 —— ADR-0013 D5 + ADR-0017 D3
// ---------------------------------------------------------------------------

describe('requirement-brainstorm Skill body (三桶契约)', () => {
  const bodyOf = () => skillsByName.get('requirement-brainstorm')?.body ?? ''

  it('body 含 [SUBPROBLEM] / [RISK] / [OPTION] 三桶标记', () => {
    const body = bodyOf()
    expect(body).toContain('[SUBPROBLEM]')
    expect(body).toContain('[RISK]')
    expect(body).toContain('[OPTION]')
  })

  it('body 含 source_refs 字段说明(ADR-0017 D3)', () => {
    const body = bodyOf()
    expect(body).toContain('source_refs')
    // prd / aux / asset 三种 ref 类型都得在 body 里说明(契约)
    expect(body).toContain('prd:')
    expect(body).toContain('aux:')
    expect(body).toContain('asset:')
  })
})

// ---------------------------------------------------------------------------
// 占位骨架契约 —— tech-brief-scaffold / requirement-critique
// ---------------------------------------------------------------------------

describe('占位骨架 Skill (tech-brief-scaffold / requirement-critique)', () => {
  it.each(['tech-brief-scaffold', 'requirement-critique'])(
    '%s body 含"占位:prompt 待下个 PR 填充"标记',
    (name) => {
      // ticket 02 字面要求:占位含"⚠️ 占位:prompt 待下个 PR 填充"
      expect(skillsByName.get(name)?.body).toContain('⚠️ 占位:prompt 待下个 PR 填充')
    },
  )
})

// ---------------------------------------------------------------------------
// turn-1 admission-check 装配链(provider-stub 仿真,真正走 SkillLoader +
// SystemPromptAssembler 链)—— 验证 admission-check Skill body 从盘上 → SkillLoader
// → Assembler → 拼入 system prompt。这是 ticket 02 第 4 项验收("turn-1 在该 Skill
// 装入后能引导 SDK 输出 5 维度 admission chunks,provider stub 仿真验证即可,
// 不依赖真 API")的核心。
//
// 第一段:Assembler 把 admission-check body 拼进 base prompt(不走 provider)。
// 第二段:fake provider 推 5 维度 + VERDICT 文本 → 走 Fastify route + analysisRoutes →
// chunks.jsonl 行能被解析出 5 个 [DIM] + 1 个 [VERDICT]。
// ---------------------------------------------------------------------------

describe('turn-1 admission-check 装配链(provider-stub 仿真)', () => {
  // ===========================================================================
  // Part 1: SystemPromptAssembler 真把 admission-check body 拼进 base prompt
  // ===========================================================================
  it('assembleBase 把 admission-check body 拼进 system prompt(走 SkillLoader + Assembler 全链)', async () => {
    const loader = createSkillLoader()
    const admissionSkill = await loader.findByName(BUILTIN_DIR, 'admission-check')
    expect(admissionSkill).toBeDefined()

    // 真创建 SystemPromptAssembler,skillsRoot 指向 built-in 目录
    const assembler = createSystemPromptAssembler({
      skillsRoot: BUILTIN_DIR,
      platformPhilosophy: 'TEST PHILOSOPHY',
    })

    const base = await assembler.assembleBase({
      id: 'turn1-stub-session',
      reqId: 'req-stub-1',
      kind: 'task',
      topic: 'turn-1 stub',
    })

    // 1. base 包含 platform philosophy(Assembler 不会吞掉哲学段)
    expect(base).toContain('TEST PHILOSOPHY')

    // 2. base 含 "## Active Skills (Always-on)" 段标题
    expect(base).toContain('## Active Skills (Always-on)')

    // 3. base 含 admission-check body 关键标识 —— 这是 ticket 02 验收的硬约束:
    //    Skill body 必须真被装入 system prompt,SDK 才能按模板输出 5 维度产物
    expect(base).toContain('### admission-check')
    expect(base).toContain('loss_prevention')
    expect(base).toContain('performance')
    expect(base).toContain('arch_conflict')
    expect(base).toContain('business_reasonable')
    expect(base).toContain('context_query')
    expect(base).toContain('[VERDICT]')
    expect(base).toContain('pending_count')

    // 4. base 包含 on-arming Skill 的元数据(tech-brief-scaffold / requirement-critique
    //    这两个不装入 body,只列 description 一行)
    expect(base).toContain('## On-arming Skills')
    expect(base).toContain('tech-brief-scaffold')
    expect(base).toContain('requirement-critique')

    // 5. base 不应该反向包含 requirement-brainstorm body(那是 turn-2 的事)
    //    —— 当前 assembler 装 always skill 时也把 requirement-brainstorm body 装进去,
    //    这是 ADR-0008 "always" 档位的设计(见 skill loader 单测本档位语义);
    //    turn-1 / turn-2 之间的 body 切换由 handler 的 DualTurnAssembler + setActiveSkill
    //    决定(analysis.ts)。这里只验证"admission-check body 出现在 base 里"。
    expect(base).toContain('requirement-brainstorm')
  })

  // ===========================================================================
  // Part 2: provider-stub 端到端 —— 走 Fastify route,让 fake provider 推一段
  // "5 维度 + VERDICT"产物,验证 chunks.jsonl 行能解出 5 个 [DIM] + 1 个 [VERDICT]
  // ===========================================================================
  let root: string
  let fastify: FastifyInstance
  let hub: SseHub

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aidevsp-builtin-turn1-'))
    hub = createSseHub({ heartbeatMs: 60_000 })
    fastify = Fastify({ logger: false })
  })

  afterEach(async () => {
    await fastify.close()
    await hub.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('fake provider 推 5 维度 + VERDICT → POST start → chunks.jsonl 能解出 5 个 [DIM] + 1 个 [VERDICT]', async () => {
    // 准备 PRD
    const reqId = 'req-turn1-stub'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(
      join(reqDir, 'requirement.md'),
      '# turn-1 stub PRD\n测试 admission-check 装配链。\n',
      'utf8',
    )

    // fake provider:turn-1 推一段 5 维度 + VERDICT 产物;turn-2 推一段占位
    const { provider } = createRecordingProvider({
      eventsByTurn: [
        [
          {
            type: 'text',
            text: [
              '[DIM loss_prevention]',
              'verdict: pass',
              'severity: 🔴',
              'evidence: PRD 未涉及资损路径',
              '',
              '[DIM performance]',
              'verdict: warn',
              'severity: 🟠',
              'evidence: 入口 RT 未明确',
              'pending: 入口 RT 阈值',
              '',
              '[DIM arch_conflict]',
              'verdict: pass',
              'severity: 🟡',
              'evidence: 与现有架构兼容',
              '',
              '[DIM business_reasonable]',
              'verdict: pass',
              'severity: 🟢',
              'evidence: 业务目标清晰',
              '',
              '[DIM context_query]',
              'verdict: warn',
              'severity: 💬',
              'evidence: 退款金额上限?',
              'pending: 退款金额上限是否分级?',
              '',
              '[VERDICT]',
              'result: ⚠️',
              'pending_count: 2',
              'summary: 准入基本通过,2 项待裁决',
            ].join('\n'),
            delta: false,
          },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'stub-sdk-1' },
        ],
        [
          { type: 'text', text: 'turn-2 placeholder', delta: false },
          { type: 'done', reason: 'end_turn' as const, sessionId: 'stub-sdk-2' },
        ],
      ],
    })

    await fastify.register(analysisRoutes, { hub, workspaceRoot: root, provider })

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/requirements/${reqId}/analysis/start`,
      headers: { 'content-type': 'application/json' },
      payload: { angle: 'architecture', session_id: 'sess-turn1-stub' },
    })
    expect(res.statusCode).toBe(201)

    // 等异步双 turn 跑完 —— turn-1 / turn-2 都推 done 后 handler 完成
    await new Promise((r) => setTimeout(r, 500))

    // 读 chunks.jsonl,验证 turn-1 的 5 维度 + VERDICT 真落到 jsonl
    const chunksFile = join(
      root,
      'requirements',
      reqId,
      'analysis',
      'sessions',
      'sess-turn1-stub',
      'chunks.jsonl',
    )
    const text = readFileSync(chunksFile, 'utf8')
    // chunks.jsonl 每条 narration chunk 的 text 段被 handler 单独落 1 行 —— 把所有
    // narration chunk 的 text 拼回去应能拼出原 SDK 流的完整文本
    const lines = text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { text: string; kind: string })
      .filter((c) => c.kind === 'narration')
      .map((c) => c.text)
      .join('\n')

    // 关键断言:ticket 02 验收 — 5 维度 + VERDICT 真出现在 chunks.jsonl 累积文本中
    expect(lines).toContain('[DIM loss_prevention]')
    expect(lines).toContain('[DIM performance]')
    expect(lines).toContain('[DIM arch_conflict]')
    expect(lines).toContain('[DIM business_reasonable]')
    expect(lines).toContain('[DIM context_query]')
    expect(lines).toContain('[VERDICT]')
    expect(lines).toMatch(/pending_count:\s*2/)

    // 5 个 [DIM] 恰好出现 1 次每个(SDK 只推了 1 条 text 事件,内部 5 段拼接)
    const dimMatches = lines.match(/\[DIM \w+\]/g) ?? []
    expect(dimMatches).toHaveLength(5)
    expect(dimMatches).toEqual([
      '[DIM loss_prevention]',
      '[DIM performance]',
      '[DIM arch_conflict]',
      '[DIM business_reasonable]',
      '[DIM context_query]',
    ])

    // [VERDICT] 出现 1 次
    expect(lines.match(/\[VERDICT\]/g)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 文档完整性 —— 4 个 SKILL.md 都能被读出 body,body 不是纯 frontmatter
// ---------------------------------------------------------------------------

describe('SKILL.md 文档完整性', () => {
  it.each(EXPECTED_SKILLS.map((s) => s.name))(
    '%s SKILL.md 是合法 markdown(frontmatter 闭合 + body 非空)',
    (name) => {
      const filePath = join(BUILTIN_DIR, name, 'SKILL.md')
      const text = readFileSync(filePath, 'utf8')
      // frontmatter 必须闭合(第二个 --- 行)
      const opens = (text.match(/^---$/gm) ?? []).length
      expect(opens).toBeGreaterThanOrEqual(2)
      // frontmatter 闭合后必须还有 body(不仅仅是 ---)
      const afterFrontmatter = text.split(/^---$/m)[2]
      expect(afterFrontmatter).toBeDefined()
      expect((afterFrontmatter ?? '').trim().length).toBeGreaterThan(0)
    },
  )
})