import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDraftingDataFromFs } from '@/lib/drafting.server'
import { generatePrdSkeleton } from '@ai-devspace/shared'

// ============================================================================
// fixture 目录隔离(issue: zone-data-fidelity-fixes · 01 · 验收 #6 #7)
//
// 用 os.tmpdir() 拉一个临时根,在每个 it 里建 `requirements/<id>/requirement.md`;
// afterEach 递归删根 —— 避免污染仓库根 `requirements/`(acceptance criteria 明文要求)。
// ============================================================================

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-drafting-server-'))
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})

/** 在 tmpRoot 下建 requirements/<id>/requirement.md 并写入 content */
function writeRequirement(id: string, content: string): void {
  const dir = join(tmpRoot, 'requirements', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'requirement.md'), content, 'utf8')
}

// ============================================================================
// 文件不存在(新建需求场景)
// ============================================================================

describe('getDraftingDataFromFs · 文件不存在', () => {
  it('目录里没有 requirement.md → emptyDrafting(reqId)(empty=true, prdMarkdown="")', async () => {
    const data = await getDraftingDataFromFs('req-missing', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-missing')
    expect(data.empty).toBe(true)
    expect(data.prdMarkdown).toBe('')
    expect(data.title).toBe('')
    // toolbar crumb 走 emptyDrafting 默认([])+ 不在面包屑渲染中
    expect(data.toolbar.crumb).toEqual([])
    // auxFiles / selectedRepoIds 空(issue 01 ticket 让 repos 走全局池;
    // emptyDrafting 的行为对齐)
    expect(data.auxFiles).toEqual([])
    expect(data.selectedRepoIds).toEqual([])
  })

  it('requirements/ 目录根本不存在 → emptyDrafting(同上)', async () => {
    // tmpRoot 下不建任何东西 → 整个 requirements 目录都不存在
    const data = await getDraftingDataFromFs('req-no-dir', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
  })
})

// ============================================================================
// 文件存在但 ≤ 10 字节(对齐后端 `DRAFTING_CONTENT_MIN_BYTES`)
// ============================================================================

describe('getDraftingDataFromFs · 文件 ≤ 10 字节', () => {
  it('内容 = 5 字节(纯空白 + 几个 ASCII)→ emptyDrafting', async () => {
    writeRequirement('req-short-1', 'hello')
    const data = await getDraftingDataFromFs('req-short-1', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
    expect(data.prdMarkdown).toBe('')
  })

  it('内容 = 恰好 10 字节(边界值)→ emptyDrafting(阈值 ≤ 10 都算空)', async () => {
    writeRequirement('req-boundary-10', 'abcdefghij') // 10 字节
    const data = await getDraftingDataFromFs('req-boundary-10', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(true)
    expect(data.prdMarkdown).toBe('')
  })

  it('内容 = 10 字节含多字节字符(UTF-8 字节计数)→ emptyDrafting', async () => {
    // "退款功能" 中文 = 12 字节(每个汉字 3 字节);11 字节 → emptyDrafting
    writeRequirement('req-cn-11', '退款功能') // 12 字节 → > 10,应该非空
    const data = await getDraftingDataFromFs('req-cn-11', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown).toBe('退款功能')
  })
})

// ============================================================================
// 文件存在且 > 10 字节(真实场景)
// ============================================================================

describe('getDraftingDataFromFs · 文件 > 10 字节', () => {
  it('取文件内容作 prdMarkdown,empty=false', async () => {
    const original = '# 退款功能优化\n\n## 背景\n\n- 现状\n- 痛点\n'
    writeRequirement('req-real', original)

    const data = await getDraftingDataFromFs('req-real', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-real')
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown).toBe(original)
    // toolbar.crumb 反映 reqId + 草稿
    expect(data.toolbar.crumb).toEqual([
      { label: 'req-real' },
      { label: '/' },
      { label: '草稿', current: true },
    ])
  })

  it('> 10 字节的最小场景(11 字节英文)→ 非空,内容完整保留', async () => {
    writeRequirement('req-min', 'hello world') // 11 字节
    const data = await getDraftingDataFromFs('req-min', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown).toBe('hello world')
  })

  it('非空数据 → auxFiles / selectedRepoIds 沿用 emptyDrafting 行为(空 / 空)', async () => {
    writeRequirement('req-aux', generatePrdSkeleton('退款功能'))
    const data = await getDraftingDataFromFs('req-aux', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    // 真实需求没扫描仓库 / 没关联 auxFiles → 保持空集
    expect(data.auxFiles).toEqual([])
    expect(data.selectedRepoIds).toEqual([])
  })

  it('非空数据 → repos 沿用 emptyDrafting 的 GLOBAL_REPO_POOL', async () => {
    writeRequirement('req-repos', '足够多的内容触发非空判定')
    const data = await getDraftingDataFromFs('req-repos', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    // emptyDrafting 注入全局仓库池 → repos 非空
    expect(data.repos.length).toBeGreaterThan(0)
  })

  it('非空数据 → title 沿用 emptyDrafting 默认("") —— fs loader 不读 meta.yaml', async () => {
    writeRequirement('req-title', '足以触发非空判定的内容')
    const data = await getDraftingDataFromFs('req-title', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    // 标题读取属于另一路径(本 ticket 不读 meta.yaml),所以默认 ''
    expect(data.title).toBe('')
  })

  it('多字节 UTF-8 内容完整保留(不破坏 emoji / 中文 / 换行)', async () => {
    const original =
      '# 退款功能优化 🚀\n\n## 背景\n\n退款流程当前太慢 ⏱\n\n## 验收\n- 30s 内到账\n'
    writeRequirement('req-utf8', original)
    const data = await getDraftingDataFromFs('req-utf8', {
      requirementsRoot: tmpRoot,
    })
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown).toBe(original)
    expect(data.prdMarkdown).toContain('🚀')
    expect(data.prdMarkdown).toContain('⏱')
  })
})

// ============================================================================
// req-001 硬编码 mock(向后兼容)
// ============================================================================

describe('getDraftingDataFromFs · req-001 硬编码 mock', () => {
  it('即使 requirementsRoot 下没有 req-001 目录,仍拿到完整 REFUND_DRAFTING', async () => {
    // tmpRoot 里完全没建 req-001 → req-001 仍返回 REFUND_DRAFTING
    const data = await getDraftingDataFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    expect(data.prdMarkdown.length).toBeGreaterThan(10)
    // REFUND_DRAFTING 自带 4 个 auxFiles + 2 个已选中 repo + 3 个 skills
    expect(data.auxFiles.length).toBeGreaterThanOrEqual(4)
    expect(data.selectedRepoIds.length).toBeGreaterThanOrEqual(2)
    expect(data.skills.length).toBeGreaterThanOrEqual(3)
  })

  it('req-001 即便 fs 里有 requirement.md 也用硬编码(不被覆盖)', async () => {
    // 放一个完全不同的内容 → req-001 应忽略它,继续返回 REFUND_DRAFTING
    writeRequirement('req-001', '完全不同且足够长的内容')
    const data = await getDraftingDataFromFs('req-001', {
      requirementsRoot: tmpRoot,
    })

    expect(data.requirementId).toBe('req-001')
    expect(data.empty).toBe(false)
    // prdMarkdown = REFUND_DRAFTING 的骨架内容,不是文件里的 '完全不同且足够长的内容'
    expect(data.prdMarkdown).not.toBe('完全不同且足够长的内容')
    expect(data.prdMarkdown).toContain('退款功能优化')
  })
})

// ============================================================================
// 错误 / 边界
// ============================================================================

describe('getDraftingDataFromFs · 错误 / 边界', () => {
  it('file 是目录而非文件 → emptyDrafting(容错,不抛)', async () => {
    // mkdirSync requirements/req-dir/requirement.md → 末端是目录
    const dir = join(tmpRoot, 'requirements', 'req-dir-as-file')
    mkdirSync(join(dir, 'requirement.md'), { recursive: true })

    const data = await getDraftingDataFromFs('req-dir-as-file', {
      requirementsRoot: tmpRoot,
    })
    // existsSync 对目录返回 true,但 readFileSync 目录会失败 → catch 内 content=null → emptyDrafting
    expect(data.empty).toBe(true)
  })

  it('requirementsRoot 选项缺省 → 走 process.cwd() 默认(<repo-root>/requirements/)', async () => {
    // 不传 requirementsRoot:函数会拼 process.cwd()/../../requirements/<id>/requirement.md
    // 真实仓库根没有这个 reqId → emptyDrafting(说明默认路径生效,没抛错)
    const data = await getDraftingDataFromFs('req-default-path-test-id')
    expect(data.requirementId).toBe('req-default-path-test-id')
    expect(data.empty).toBe(true)
  })

  // 回归 ticket 01 review 抓到的路径解析 bug:之前 `defaultRequirementsRoot()`
  // 直接返回 `process.cwd()`,再拼 `requirements/{id}/requirement.md`,dev 时 cwd
  // = `<repo-root>/apps/web/` → 解析到 `<repo-root>/apps/web/requirements/...` ❌
  // 修复后 `defaultRequirementsRoot()` 返回 `resolve(process.cwd(), '../..')`,
  // 拼好后恰好是 spec 字面要求的 `<repo-root>/requirements/{id}/requirement.md`。
  // 本测试 mock process.cwd() 模拟 `apps/web/` 形态,放 fixture 在期望的最终路径上,
  // 验证默认路径解析真的能找到文件(不只 "不抛错 + empty=true")。
  it('回归:默认路径解析为 `<cwd>/../../requirements/{id}/requirement.md`', async () => {
    // 构造 `<mockRoot>/apps/web/` 作为 mock cwd(模拟 dev 形态)
    const mockCwd = join(tmpRoot, 'apps', 'web')
    mkdirSync(mockCwd, { recursive: true })
    // spec 期望 `<cwd>/../../requirements/...` = `<mockRoot>/requirements/...`
    const realReqFile = join(tmpRoot, 'requirements', 'req-default-fs', 'requirement.md')
    mkdirSync(join(tmpRoot, 'requirements', 'req-default-fs'), { recursive: true })
    writeFileSync(realReqFile, '从默认路径解析到的 fixture 内容', 'utf8')

    const spy = vi.spyOn(process, 'cwd').mockReturnValue(mockCwd)
    try {
      const data = await getDraftingDataFromFs('req-default-fs')
      expect(data.empty).toBe(false)
      expect(data.prdMarkdown).toBe('从默认路径解析到的 fixture 内容')
    } finally {
      spy.mockRestore()
    }
  })
})