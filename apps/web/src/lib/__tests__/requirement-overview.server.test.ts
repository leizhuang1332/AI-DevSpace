import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRequirementOverviewFromFs } from '@/lib/requirement-overview.server'

// ============================================================================
// fixture 目录隔离(对齐 `drafting.server.test.ts` 范式)
//
// 用 os.tmpdir() 拉一个临时根,在每个 it 里建 `requirements/<id>/...`;
// afterEach 递归删根 —— 避免污染仓库根 `requirements/`。
// ============================================================================

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-overview-server-'))
  // 显式清空 AIDEVSPACE_HOME 避免被环境变量旁路
  delete process.env.AIDEVSPACE_HOME
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

/** 在 tmpRoot 下建 requirements/<id>/requirement.md 并写入 content */
function writeRequirement(id: string, content: string): void {
  const dir = join(tmpRoot, 'requirements', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), content, 'utf8')
}

/** 在 tmpRoot 下建 requirements/<id>/meta.yaml 并写入 raw yaml 内容 */
function writeMeta(id: string, raw: string): void {
  const dir = join(tmpRoot, 'requirements', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.yaml'), raw, 'utf8')
}

/** 触碰子目录(分析 / 看板 / 归档),让 deriveStatus 命中对应分支 */
function touchAnalysis(id: string): void {
  mkdirSync(join(tmpRoot, 'requirements', id, 'analysis'), { recursive: true })
}

function touchBoardTasks(id: string, n: number): void {
  const dir = join(tmpRoot, 'requirements', id, 'board', 'tasks')
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `task-${i}.json`), '{}', 'utf8')
  }
}

function touchWrapup(id: string): void {
  mkdirSync(join(tmpRoot, 'requirements', id, 'wrapup'), { recursive: true })
}

function touchRepos(id: string, names: string[]): void {
  const dir = join(tmpRoot, 'requirements', id, 'repos')
  mkdirSync(dir, { recursive: true })
  for (const n of names) {
    mkdirSync(join(dir, n), { recursive: true })
  }
}

/** 强制设置子目录的 mtime,保证 timeline 拿得到稳定日期 */
function setDirMtime(path: string, iso: string): void {
  const t = new Date(iso)
  utimesSync(path, t, t)
}

// ============================================================================
// 文件不存在(新建需求场景)
// ============================================================================

describe('getRequirementOverviewFromFs · 文件不存在', () => {
  it('目录里没有 requirement.md → emptyOverview(reqId)(empty=true)', async () => {
    const data = await getRequirementOverviewFromFs('req-missing', {
      requirementsRoot: tmpRoot,
    })
    expect(data.requirementId).toBe('req-missing')
    expect(data.empty).toBe(true)
    expect(data.zoneCards).toEqual([])
    expect(data.milestones).toEqual([])
    expect(data.aiActivity.zones).toEqual([])
  })

  it('requirements/ 目录根本不存在 → emptyOverview(同上)', async () => {
    // tmpRoot 下不建任何东西 → 整个 requirements 目录都不存在
    const data = await getRequirementOverviewFromFs('req-no-dir', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

// ============================================================================
// 文件 ≤ 10 字节(对齐后端 `DRAFTING_CONTENT_MIN_BYTES`)
// ============================================================================

describe('getRequirementOverviewFromFs · 文件 ≤ 10 字节', () => {
  it('内容 = 5 字节 → emptyOverview', async () => {
    writeRequirement('req-short-1', 'hello')
    const data = await getRequirementOverviewFromFs('req-short-1', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('内容 = 恰好 10 字节(边界值)→ emptyOverview', async () => {
    writeRequirement('req-boundary-10', 'abcdefghij') // 10 字节
    const data = await getRequirementOverviewFromFs('req-boundary-10', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('11 字节英文 → 非空', async () => {
    writeRequirement('req-min-11', 'hello world') // 11 字节
    const data = await getRequirementOverviewFromFs('req-min-11', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
  })
})

// ============================================================================
// 文件 > 10 字节(用户 bug 修复核心场景)
// ============================================================================

describe('getRequirementOverviewFromFs · 文件 > 10 字节(用户 bug 修复核心)', () => {
  it('"这下可以了吧" 场景:requirement.md 25k + meta.yaml + analysis/ + board/ + repos/ → 满数据', async () => {
    // 模拟用户实际 req-003 场景:
    //   - requirement.md 25776 字节
    //   - meta.yaml: id / title / createdAt / branchName
    //   - analysis/ 存在
    //   - board/tasks/ 22 个 .json
    //   - repos/ 2 个仓库
    const id = 'req-003-这下可以了吧'
    writeRequirement(id, 'A'.repeat(25776))
    writeMeta(
      id,
      [
        `id: ${id}`,
        `title: 这下可以了吧`,
        `createdAt: '2026-07-20T00:37:19.878Z'`,
        `branchName: ffefe`,
      ].join('\n'),
    )
    touchAnalysis(id)
    touchBoardTasks(id, 22)
    touchRepos(id, ['yl-jms-spmibill-capacity-share', 'yl-web-ft-export'])

    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })

    // 修复的核心断言:empty=false(原 bug 这里 empty=true → "暂无数据")
    expect(data.requirementId).toBe(id)
    expect(data.empty).toBe(false)

    // banner 元数据
    expect(data.meta.title).toBe('这下可以了吧')
    // status:有 analysis/ → 'analyzing'(对齐后端 deriveStatus 简化版)
    expect(data.meta.status).toBe('analyzing')
    // repos:repos/ 子目录
    expect(data.meta.repos).toEqual([
      'yl-jms-spmibill-capacity-share',
      'yl-web-ft-export',
    ])
    // createdAt:meta.yaml 的 ISO
    expect(data.meta.createdAt).toBe('2026-07-20T00:37:19.878Z')
    expect(data.meta.updatedAt).not.toBe('') // reqDir mtime 兜底

    // 4 zone 卡片:全是 done / cur(没有 wrapup)
    expect(data.zoneCards.length).toBe(4)
    const draftingCard = data.zoneCards.find((c) => c.zoneId === 'drafting')
    const analyzingCard = data.zoneCards.find((c) => c.zoneId === 'analyzing')
    const boardCard = data.zoneCards.find((c) => c.zoneId === 'board')
    const wrapupCard = data.zoneCards.find((c) => c.zoneId === 'wrapup')
    expect(draftingCard?.state).toBe('done')
    expect(analyzingCard?.state).toBe('done')
    expect(boardCard?.state).toBe('cur')
    expect(boardCard?.meta).toBe('22 卡')
    expect(wrapupCard?.state).toBe('todo')

    // 4 节点里程碑
    expect(data.milestones.length).toBe(4)
    expect(data.milestones.find((m) => m.id === 'drafting')?.state).toBe('done')
    expect(
      data.milestones.find((m) => m.id === 'analyzing')?.state,
    ).toBe('done')
    expect(data.milestones.find((m) => m.id === 'board')?.state).toBe('cur')
    expect(data.milestones.find((m) => m.id === 'wrapup')?.state).toBe('todo')

    // 进度:2 done(drafting + analyzing) + 1 cur(board) + 1 todo(wrapup)
    // → 2/4 = 50%
    expect(data.progress.total).toBe(4)
    expect(data.progress.done).toBe(2)
    expect(data.progress.inProgress).toBe(1)
    expect(data.progress.todo).toBe(1)
    expect(data.progress.percent).toBe(50)
    // artifactCount:22 board tasks + 1 analyzing = 23
    expect(data.progress.artifactCount).toBe(23)

    // AI 活动:zones 至少有 drafting(100%) / analyzing(42%) / board(78%)
    const zonePercents = data.aiActivity.zones.map((z) => z.zoneId).sort()
    expect(zonePercents).toContain('drafting')
    expect(zonePercents).toContain('analyzing')
    expect(zonePercents).toContain('board')
  })

  it('只有 requirement.md(无 analysis / board / wrapup / repos)→ 最小非空概览', async () => {
    const id = 'req-min-non-empty'
    writeRequirement(id, '足够多的内容触发非空判定')

    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    expect(data.meta.title).toBe('') // 没 meta.yaml
    expect(data.meta.status).toBe('drafting')
    expect(data.meta.repos).toEqual([])

    // 4 zone 卡片:只有 drafting done,其他 todo
    expect(data.zoneCards.find((c) => c.zoneId === 'drafting')?.state).toBe(
      'done',
    )
    expect(data.zoneCards.find((c) => c.zoneId === 'analyzing')?.state).toBe(
      'todo',
    )
    expect(data.zoneCards.find((c) => c.zoneId === 'board')?.state).toBe(
      'todo',
    )
    expect(data.zoneCards.find((c) => c.zoneId === 'wrapup')?.state).toBe(
      'todo',
    )
    // 进度:1/4 = 25%
    expect(data.progress.percent).toBe(25)
  })

  it('有 analysis + wrapup → status 优先 wrapup(done)', async () => {
    // 与后端 `deriveStatus` 同序:.archived > wrapup > analysis > drafting
    const id = 'req-with-wrapup'
    writeRequirement(id, '足够多的内容触发非空判定')
    touchAnalysis(id)
    touchWrapup(id)

    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(data.meta.status).toBe('done')
    // 4 zone 卡片:wrapup done,board todo(没 board tasks)
    expect(data.zoneCards.find((c) => c.zoneId === 'wrapup')?.state).toBe(
      'done',
    )
    expect(data.zoneCards.find((c) => c.zoneId === 'board')?.state).toBe(
      'todo',
    )
  })

  it('repos/ 下 . 开头的目录被过滤', async () => {
    const id = 'req-repos-filter'
    writeRequirement(id, '足够多的内容触发非空判定')
    touchRepos(id, ['valid-repo', '.hidden', 'another'])
    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(data.meta.repos).toEqual(['another', 'valid-repo'])
  })

  it('meta.yaml 解析失败 → title=""(静默降级,不抛错)', async () => {
    const id = 'req-meta-broken'
    writeRequirement(id, '足够多的内容触发非空判定')
    writeMeta(id, '\x00\x01\x02not yaml at all\xff')

    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    expect(data.meta.title).toBe('')
  })

  it('meta.yaml title 字段含中文 → 原样保留(parseFlatMap 不破坏 UTF-8)', async () => {
    const id = 'req-cn-title'
    writeRequirement(id, '足够多的内容触发非空判定')
    writeMeta(id, ['id: req-cn-title', 'title: test托尔斯泰', ''].join('\n'))
    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(data.meta.title).toBe('test托尔斯泰')
  })

  it('timeline:子目录 mtime 渲染为 YYYY-MM-DD', async () => {
    const id = 'req-timeline'
    writeRequirement(id, '足够多的内容触发非空判定')
    touchAnalysis(id)
    setDirMtime(join(tmpRoot, 'requirements', id, 'analysis'), '2026-07-09T12:00:00Z')

    const data = await getRequirementOverviewFromFs(id, {
      requirementsRoot: tmpRoot,
    })
    expect(
      data.milestones.find((m) => m.id === 'analyzing')?.ts,
    ).toMatch(/^2026-07-09$/)
  })
})

// ============================================================================
// req-001 硬编码 mock(向后兼容,见 `requirement-overview.ts`)
// ============================================================================

describe('getRequirementOverviewFromFs · req-001 硬编码 mock', () => {
  it('即便 requirementsRoot 下没有 req-001,仍拿到完整 REFUND_OVERVIEW', async () => {
    const data = await getRequirementOverviewFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })
    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    expect(data.meta.title).toBe('退款功能优化')
    expect(data.zoneCards.length).toBe(4)
    expect(data.milestones.length).toBe(4)
  })

  it('req-001 即便 fs 里有 requirement.md 也用硬编码(不被覆盖)', async () => {
    writeRequirement('req-001', '完全不同且足够长的内容覆盖标题用的')
    const data = await getRequirementOverviewFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })
    expect(data.meta.title).toBe('退款功能优化') // REFUND_OVERVIEW,不是空
  })
})

// ============================================================================
// 错误 / 边界
// ============================================================================

describe('getRequirementOverviewFromFs · 错误 / 边界', () => {
  it('file 是目录而非文件 → emptyOverview(容错,不抛)', async () => {
    const dir = join(tmpRoot, 'requirements', 'req-dir-as-file')
    mkdirSync(join(dir, 'requirement.md'), { recursive: true })

    const data = await getRequirementOverviewFromFs('req-dir-as-file', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })

  it('configPath 注入 + workspaceRoot:验证 resolveRequirementsRoot(configPath) 真实被读取', async () => {
    // 模拟 ticket 05 / D-6.1 真实场景:configPath → workspaceRoot → 读 fs
    const id = 'req-config-injection'
    const realReqDir = join(tmpRoot, 'requirements', id)
    mkdirSync(realReqDir, { recursive: true })
    writeFileSync(join(realReqDir, 'requirement.md'), '足够多的内容触发非空判定', 'utf8')
    writeMeta(id, ['id: req-config-injection', 'title: 来自config路径解析的需求', ''].join('\n'))

    // configPath 指向的 config.yaml 含 workspaceRoot: tmpRoot
    const configPath = join(tmpRoot, 'config.yaml')
    writeFileSync(configPath, `workspaceRoot: ${tmpRoot}\n`, 'utf8')

    // 不传 requirementsRoot,让函数走 resolveRequirementsRoot({ configPath })
    const data = await getRequirementOverviewFromFs(id, { configPath })
    expect(data.empty).toBe(false)
    expect(data.meta.title).toBe('来自config路径解析的需求')
  })

  it('回归:未传 options + 走 AIDEVSPACE_HOME env + 完全无 fixture → emptyOverview', async () => {
    // 验证默认路径解析不抛错(走 AIDEVSPACE_HOME fallback 也找不到东西)
    process.env.AIDEVSPACE_HOME = join(tmpRoot, 'nonexistent-home')
    // 走默认 process.cwd() fallback(测试环境里 cwd 大概率在仓库根,
    // 但就算有 requirements/ 目录,test-id 不存在 → 走 empty)
    const data = await getRequirementOverviewFromFs('req-default-empty')
    expect(data.empty).toBe(true)
  })

  it('存在性检查:空态时 zoneCards / milestones / aiActivity.zones 全空数组', async () => {
    const data = await getRequirementOverviewFromFs('req-still-empty', {
      requirementsRoot: tmpRoot,
    })
    expect(data.zoneCards).toEqual([])
    expect(data.milestones).toEqual([])
    expect(data.aiActivity.zones).toEqual([])
    // banner 也全是空字符串(空态语义,符合 emptyOverview 默认)
    expect(data.meta.title).toBe('')
    expect(data.meta.repos).toEqual([])
  })
})

// ============================================================================
// 对比:`emptyOverview` 形态相同(与 client-safe helper 的契约对齐)
// ============================================================================

describe('getRequirementOverviewFromFs · emptyOverview 一致性', () => {
  it('文件不存在时,fs 版与 client-safe `emptyOverview` 形状一致(忽略 requirementId)', async () => {
    const data = await getRequirementOverviewFromFs('req-shape-test', {
      requirementsRoot: tmpRoot,
    })
    // 等价于 `emptyOverview('req-shape-test')`
    expect(data.empty).toBe(true)
    expect(data.zoneCards).toEqual([])
    expect(data.milestones).toEqual([])
    expect(data.aiActivity.zones).toEqual([])
    expect(data.progress.percent).toBe(0)
    expect(data.progress.done).toBe(0)
    expect(data.progress.prStatus).toBeNull()
  })
})

// touch 一下 existsSync 防止 tree-shaking 警告
void existsSync
