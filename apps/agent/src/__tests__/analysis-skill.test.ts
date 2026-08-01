/**
 * Analysis Skill 服务 + 路由端到端测试(issue 01 · ADR-0021)
 *
 * 覆盖验收清单(issue 01 ticket):
 * - 首次初始化后可选择 prd-completeness 与 implementation-readiness 两个默认 Analysis Skill(acceptance 1)
 * - 应用升级会用系统版本强制覆盖同名默认 Analysis Skill,其他名称保持不变(acceptance 2)
 * - 只扫描 Workspace 的独立 Analysis Skill 集合,不纳入全局/个人/项目 Skill(acceptance 3)
 * - 每个有效 Skill 都具有唯一名称、非空功能简介、语义版本和规则正文(acceptance 4)
 * - 非法 Skill(frontmatter 缺字段 / 非法 version)→ 跳过,不进入列表(acceptance 8)
 * - 选择持久化(acceptance 7):无 selection → 首项;有 selection → 沿用;已记住名不存在 → 回退首项
 *
 * 端到端接缝:tmpdir workspace + buildServer(同 routes-analysis-start.test.ts 同款),
 * 不依赖真实 SDK 子进程,API 契约由 Zod 二次校验。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import {
  AnalysisSkillService,
  analysisSkillsDirFor,
  purgeAnalysisSkillDir,
} from '../analysis-skill/AnalysisSkillService.js'
import { analysisSkillRoutes } from '../routes/analysis-skill.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeSkillMd(
  root: string,
  name: string,
  body: string,
  frontmatter: Record<string, string>,
): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  const text = `---\n${fm}\n---\n\n${body}\n`
  writeFileSync(join(dir, 'SKILL.md'), text, 'utf8')
}

function writePlainSkillMd(root: string, name: string, raw: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), raw, 'utf8')
}

let tmpRoot: string
let service: AnalysisSkillService
let app: FastifyInstance
let token: string

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-analysis-skill-'))
  process.env.AIDEVSPACE_HOME = tmpRoot
  service = new AnalysisSkillService(tmpRoot)
  const tm = new TokenManager(tmpRoot)
  token = await tm.ensure()
  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(analysisSkillRoutes, { workspaceRoot: tmpRoot })
  await app.ready()
})

afterEach(async () => {
  delete process.env.AIDEVSPACE_HOME
  if (app) await app.close()
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token, 'content-type': 'application/json' }
}

// ===========================================================================
// Service:init() —— 默认 Skill 初始化 + 升级覆盖
// ===========================================================================

describe('AnalysisSkillService.init()', () => {
  it('首次安装 → seededReserved 包含两个 reserved 名称;目录与 SKILL.md 落盘', () => {
    const r = service.init()
    expect(r.seededReserved).toEqual(
      expect.arrayContaining(['prd-completeness', 'implementation-readiness']),
    )
    expect(r.upgradedReserved).toEqual([])

    // 物理文件确实落盘
    const dir = analysisSkillsDirFor(tmpRoot)
    for (const n of ['prd-completeness', 'implementation-readiness']) {
      expect(existsSync(join(dir, n, 'SKILL.md'))).toBe(true)
    }
  })

  it('二次 init() → 全部 existed,无 seeded / 无 upgraded', () => {
    service.init()
    const r = service.init()
    expect(r.seededReserved).toEqual([])
    expect(r.upgradedReserved).toEqual([])
  })

  it('升级覆盖:用户手工改坏了 reserved Skill 的 body → init() 用系统版本强制覆盖', () => {
    service.init()
    // 模拟"用户改坏"——把 prd-completeness 的 body 改写成一个完全不同内容
    const dir = analysisSkillsDirFor(tmpRoot)
    const target = join(dir, 'prd-completeness', 'SKILL.md')
    const original = readFileSync(target, 'utf8')
    const corrupted = original.replace(/检查 PRD/g, '完全无关的内容')
    writeFileSync(target, corrupted, 'utf8')

    const r = service.init()
    expect(r.upgradedReserved).toContain('prd-completeness')
    expect(r.seededReserved).not.toContain('prd-completeness')

    // 落盘内容已恢复为系统版本
    const restored = readFileSync(target, 'utf8')
    expect(restored).toBe(original)
    expect(restored).toContain('检查 PRD')
  })

  it('升级覆盖:用户新增的非 reserved Skill 不被覆盖(acceptance 2)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    // 用户新增一个自定义 Skill
    writeSkillMd(
      dir,
      'my-custom',
      '我是用户自己上传的',
      {
        name: 'my-custom',
        description: 'custom',
        version: '0.0.1',
      },
    )

    const r = service.init()
    // 不应覆盖用户 Skill
    expect(r.upgradedReserved).not.toContain('my-custom')
    // 用户 Skill 仍然存在 + body 未被改
    const userFile = join(dir, 'my-custom', 'SKILL.md')
    expect(readFileSync(userFile, 'utf8')).toContain('我是用户自己上传的')
  })

  it('升级覆盖:用户新增了与 reserved 同名的 Skill → 系统版本覆盖(acceptance 2)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    // 把 prd-completeness 替换为用户自写(但同名是 reserved)
    rmSync(join(dir, 'prd-completeness'), { recursive: true, force: true })
    writeSkillMd(
      dir,
      'prd-completeness',
      '我自己写的 prd 检查',
      {
        name: 'prd-completeness',
        description: '我自己的版本',
        version: '99.0.0',
      },
    )

    const r = service.init()
    expect(r.upgradedReserved).toContain('prd-completeness')

    // 已被系统版本覆盖 —— 内容应包含系统 body 关键字
    const restored = readFileSync(
      join(dir, 'prd-completeness', 'SKILL.md'),
      'utf8',
    )
    expect(restored).toContain('prd-completeness')
    expect(restored).not.toContain('我自己写的 prd 检查')
  })
})

// ===========================================================================
// Service:listAllSkills() —— 集合隔离 + 非法 Skill 跳过(acceptance 3 / 4 / 8)
// ===========================================================================

describe('AnalysisSkillService.listAllSkills()', () => {
  it('目录不存在 → 返空(不抛错)', () => {
    purgeAnalysisSkillDir(tmpRoot)
    expect(service.listAllSkills()).toEqual([])
  })

  it('接受合法 frontmatter + 非空 body 的 Skill(acceptance 4)', () => {
    service.init()
    const skills = service.listAllSkills()
    expect(skills).toHaveLength(2)
    const names = skills.map((s) => s.meta.name).sort()
    expect(names).toEqual(['implementation-readiness', 'prd-completeness'])

    for (const s of skills) {
      expect(s.meta.name.length).toBeGreaterThan(0)
      expect(s.meta.description.length).toBeGreaterThan(0)
      expect(s.meta.version).toMatch(/^\d+\.\d+\.\d+/)
      expect(s.body.trim().length).toBeGreaterThan(0)
    }
  })

  it('is_reserved 字段正确标注(影响 UI "系统" 徽章)', () => {
    service.init()
    const skills = service.listAllSkills()
    for (const s of skills) {
      expect(s.meta.is_reserved).toBe(true)
    }
    // 用户自写 → is_reserved = false
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(
      dir,
      'user-skill',
      'user body',
      { name: 'user-skill', description: 'user desc', version: '1.0.0' },
    )
    const all = service.listAllSkills()
    const userSkill = all.find((s) => s.meta.name === 'user-skill')
    expect(userSkill?.meta.is_reserved).toBe(false)
  })

  it('非法 Skill:frontmatter 缺 description → 跳过(acceptance 4 / 8)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(
      dir,
      'broken-no-desc',
      'body',
      { name: 'broken-no-desc', version: '1.0.0' }, // 缺 description
    )
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'broken-no-desc')).toBeUndefined()
  })

  it('非法 Skill:description 为空字符串 → 跳过(acceptance 4)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(
      dir,
      'empty-desc',
      'body',
      { name: 'empty-desc', description: '', version: '1.0.0' },
    )
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'empty-desc')).toBeUndefined()
  })

  it('非法 Skill:body 为空 → 跳过(acceptance 4)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(
      dir,
      'empty-body',
      '',
      { name: 'empty-body', description: 'desc', version: '1.0.0' },
    )
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'empty-body')).toBeUndefined()
  })

  it('非法 Skill:version 不是 semver → 跳过(acceptance 4)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(
      dir,
      'bad-version',
      'body',
      { name: 'bad-version', description: 'desc', version: 'abc' },
    )
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'bad-version')).toBeUndefined()
  })

  it('非法 Skill:无 frontmatter → 跳过', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writePlainSkillMd(dir, 'no-frontmatter', '# just markdown\nbody')
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'no-frontmatter')).toBeUndefined()
  })

  it('非法 Skill:frontmatter 解析失败 → 跳过', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    // frontmatter 不是合法键值对(yaml 不闭合的语法)
    writePlainSkillMd(
      dir,
      'broken-yaml',
      '---\nname: [unclosed\n---\nbody',
    )
    const skills = service.listAllSkills()
    expect(skills.find((s) => s.meta.name === 'broken-yaml')).toBeUndefined()
  })

  it('集合隔离:不动 user Skill 目录 ~/.aidevspace/skills(acceptance 3)', async () => {
    // 在同级 user skills 目录放一个同名 Skill —— 不应出现在 list
    // 注意:本测试只验证 listAllSkills() 只看 <root>/analysis-skills/
    service.init()
    const userSkills = join(tmpRoot, 'skills')
    mkdirSync(userSkills, { recursive: true })
    writeSkillMd(
      userSkills,
      'prd-completeness',
      'this is in user skills, not analysis-skills',
      { name: 'prd-completeness', description: 'user version', version: '1.0.0' },
    )
    const skills = service.listAllSkills()
    // 只看到 analysis-skills/ 下的版本,body 来自默认
    const hit = skills.find((s) => s.meta.name === 'prd-completeness')
    expect(hit).toBeDefined()
    expect(hit?.body).not.toContain('this is in user skills')
  })

  it('按 name 字典序排序(展示稳定,acceptance 7 前提)', () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(dir, 'z-skill', 'body', {
      name: 'z-skill',
      description: 'z',
      version: '1.0.0',
    })
    writeSkillMd(dir, 'a-skill', 'body', {
      name: 'a-skill',
      description: 'a',
      version: '1.0.0',
    })
    const skills = service.listAllSkills()
    expect(skills.map((s) => s.meta.name)).toEqual([
      'a-skill',
      'implementation-readiness',
      'prd-completeness',
      'z-skill',
    ])
  })
})

// ===========================================================================
// Service:Per-Requirement selection 持久化
// ===========================================================================

describe('AnalysisSkillService selection persistence', () => {
  beforeEach(() => {
    service.init()
  })

  it('无 selection → selectedSkillName = "" available = false', () => {
    const r = service.readSelection('req-001')
    expect(r.selectedSkillName).toBe('')
    expect(r.available).toBe(false)
  })

  it('writeSelection → 后续 readSelection 读到一致结果', () => {
    service.writeSelection('req-001', 'prd-completeness')
    const r = service.readSelection('req-001')
    expect(r.selectedSkillName).toBe('prd-completeness')
    expect(r.available).toBe(true)
  })

  it('解析失败的 selection 文件 → 当作无 selection', () => {
    const dir = join(tmpRoot, 'requirements', 'req-001', 'analysis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'selected-skill.yaml'), 'not yaml: : ::', 'utf8')
    const r = service.readSelection('req-001')
    expect(r.selectedSkillName).toBe('')
    expect(r.available).toBe(false)
  })

  it('selection 缺少 skill_name 字段 → 当作无 selection', () => {
    const dir = join(tmpRoot, 'requirements', 'req-001', 'analysis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'selected-skill.yaml'),
      'something_else: foo\n',
      'utf8',
    )
    const r = service.readSelection('req-001')
    expect(r.selectedSkillName).toBe('')
    expect(r.available).toBe(false)
  })

  it('resolveSelection:无 selection + available 非空 → 回退到首项(acceptance 7)', () => {
    const skills = service.toMetaList(service.listAllSkills())
    // prd-completeness < implementation-readiness 字典序,所以首项 = implementation-readiness
    const resolved = service.resolveSelection('req-new', skills)
    expect(resolved.selectedSkillName).toBe('implementation-readiness')
    expect(resolved.available).toBe(false)
  })

  it('resolveSelection:有 selection + 仍在 available → 沿用(acceptance 7)', () => {
    const skills = service.toMetaList(service.listAllSkills())
    service.writeSelection('req-001', 'prd-completeness')
    const resolved = service.resolveSelection('req-001', skills)
    expect(resolved.selectedSkillName).toBe('prd-completeness')
    expect(resolved.available).toBe(true)
  })

  it('resolveSelection:已记住名不存在 → 回退首项(acceptance 7 安全回退)', () => {
    const skills = service.toMetaList(service.listAllSkills())
    service.writeSelection('req-001', 'ghost-skill')
    const resolved = service.resolveSelection('req-001', skills)
    expect(resolved.selectedSkillName).toBe('implementation-readiness')
    expect(resolved.available).toBe(false)
  })

  it('resolveSelection:available 为空 → selectedSkillName = ""(acceptance 8 非法 Skill 不可启动)', () => {
    purgeAnalysisSkillDir(tmpRoot)
    const skills = service.toMetaList(service.listAllSkills())
    expect(skills).toEqual([])
    const resolved = service.resolveSelection('req-001', skills)
    expect(resolved.selectedSkillName).toBe('')
    expect(resolved.available).toBe(false)
  })
})

// ===========================================================================
// 路由端到端 —— buildServer 同款接缝
// ===========================================================================

describe('GET /api/analysis-skills', () => {
  it('全新安装但 init 跑过 → 200 返 2 个 reserved Skill', async () => {
    service.init()
    const res = await app.inject({
      method: 'GET',
      url: '/api/analysis-skills',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      skills: Array<{ name: string; description: string; version: string; is_reserved: boolean }>
    }
    expect(body.skills).toHaveLength(2)
    const names = body.skills.map((s) => s.name).sort()
    expect(names).toEqual(['implementation-readiness', 'prd-completeness'])
    for (const s of body.skills) {
      expect(s.is_reserved).toBe(true)
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.version).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  it('目录为空 → 200 返空数组(不报错)', async () => {
    purgeAnalysisSkillDir(tmpRoot)
    const res = await app.inject({
      method: 'GET',
      url: '/api/analysis-skills',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ skills: [] })
  })

  it('非法 Skill 不出现在响应里', async () => {
    service.init()
    const dir = analysisSkillsDirFor(tmpRoot)
    writeSkillMd(dir, 'bad-version', 'body', {
      name: 'bad-version',
      description: 'd',
      version: 'not-semver',
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/analysis-skills',
      headers: authHeaders(),
    })
    const body = res.json() as { skills: Array<{ name: string }> }
    expect(body.skills.find((s) => s.name === 'bad-version')).toBeUndefined()
  })

  it('无 token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analysis-skills',
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/requirements/:id/analysis/skill-selection', () => {
  it('首次进入该 Requirement → selected_skill_name = 首项(按字典序)', async () => {
    service.init()
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      selected_skill_name: string
      available_skills: Array<{ name: string }>
    }
    expect(body.selected_skill_name).toBe('implementation-readiness')
    expect(body.available_skills).toHaveLength(2)
  })

  it('已有 selection + 仍可用 → 沿用(acceptance 7)', async () => {
    service.init()
    service.writeSelection('req-001', 'prd-completeness')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
    })
    const body = res.json() as { selected_skill_name: string }
    expect(body.selected_skill_name).toBe('prd-completeness')
  })

  it('已记住名不存在 → 回退首项(acceptance 7 安全回退)', async () => {
    service.init()
    service.writeSelection('req-001', 'ghost-skill')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
    })
    const body = res.json() as { selected_skill_name: string }
    expect(body.selected_skill_name).toBe('implementation-readiness')
  })

  it('available 为空 → selected_skill_name = ""(acceptance 8)', async () => {
    purgeAnalysisSkillDir(tmpRoot)
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
    })
    const body = res.json() as {
      selected_skill_name: string
      available_skills: unknown[]
    }
    expect(body.selected_skill_name).toBe('')
    expect(body.available_skills).toEqual([])
  })
})

describe('PUT /api/requirements/:id/analysis/skill-selection', () => {
  it('合法 skill_name → 200 + 落盘', async () => {
    service.init()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
      payload: { skill_name: 'prd-completeness' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { selected_skill_name: string }
    expect(body.selected_skill_name).toBe('prd-completeness')

    // 落盘确认
    const file = join(
      tmpRoot,
      'requirements',
      'req-001',
      'analysis',
      'selected-skill.yaml',
    )
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('prd-completeness')
  })

  it('非法 skill_name(不在 available 中)→ 400', async () => {
    service.init()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
      payload: { skill_name: 'ghost-skill' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'bad_request' })
  })

  it('缺 skill_name → 400', async () => {
    service.init()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('空字符串 skill_name → 400', async () => {
    service.init()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
      payload: { skill_name: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('无 token → 401', async () => {
    service.init()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: { 'content-type': 'application/json' },
      payload: { skill_name: 'prd-completeness' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ===========================================================================
// 出参 schema 二次校验(防后端契约漂移)
// ===========================================================================

describe('响应 schema 二次校验(防契约漂移)', () => {
  it('GET /api/analysis-skills 响应满足 AnalysisSkillListResponseSchema', async () => {
    service.init()
    const res = await app.inject({
      method: 'GET',
      url: '/api/analysis-skills',
      headers: authHeaders(),
    })
    const body = res.json()
    // 直接 import 然后 parse —— 任何字段漂移都会让 parse 失败
    const { AnalysisSkillListResponseSchema } = await import(
      '@ai-devspace/shared'
    )
    expect(() => AnalysisSkillListResponseSchema.parse(body)).not.toThrow()
  })

  it('GET /api/requirements/:id/analysis/skill-selection 响应满足 AnalysisSkillSelectionResponseSchema', async () => {
    service.init()
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirements/req-001/analysis/skill-selection',
      headers: authHeaders(),
    })
    const body = res.json()
    const { AnalysisSkillSelectionResponseSchema } = await import(
      '@ai-devspace/shared'
    )
    expect(() => AnalysisSkillSelectionResponseSchema.parse(body)).not.toThrow()
  })
})
