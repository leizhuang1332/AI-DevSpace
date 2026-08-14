/**
 * Worktree → Codebase 契约测试 —— ADR-0030 D3/D5 / .scratch/repo-registry-clone/issues/01-shared-schema.md 1.3
 *
 * 测试 seam：AttachReposRequestSchema / AttachRepoResultSchema / AttachReposResponseSchema /
 *            RepoAttachErrorCode / PER_REPO_ERROR_CODES / validateBranchName
 *
 * 关键契约变化（vs 旧 repoIds/worktreePath 形态）：
 * - `repoIds` → `repoNames`（name 即全局唯一标识，决策 105）
 * - `worktreePath` → `codebasePath`（路径 `requirements/<req-id>/codebase/<name>/`，决策 106）
 * - 删除 E_BASE_BRANCH_NOT_FOUND / E_BRANCH_EXISTS；新增 E_REPO_ALREADY_ATTACHED / E_REPO_NAME_EXISTS（决策 111）
 */
import { describe, it, expect } from 'vitest'
import {
  AttachReposRequestSchema,
  AttachRepoResultSchema,
  AttachReposResponseSchema,
  BRANCH_FORBIDDEN_RE,
  BRANCH_MAX_LENGTH,
  RepoAttachErrorCode,
  validateBranchName,
} from '../worktree.js'

// ============================================================================
// validateBranchName —— 前后端共用的分支名校验
// ============================================================================

describe('validateBranchName', () => {
  it('accepts clean branch name', () => {
    const r = validateBranchName('feat/refund-optimization')
    expect(r.ok).toBe(true)
    expect(r.sanitized).toBe('feat/refund-optimization')
  })

  it('strips forbidden chars', () => {
    const r = validateBranchName('feat/bad:branch*name?')
    // `:` `*` `?` 都在禁列
    expect(r.sanitized).toBe('feat/badbranchname')
    expect(r.ok).toBe(true)
  })

  it('strips backslash', () => {
    const r = validateBranchName('feat\\bad')
    expect(r.sanitized).toBe('featbad')
  })

  it('strips whitespace including full-width', () => {
    const r = validateBranchName('  feat　foo  ')
    expect(r.sanitized).toBe('featfoo')
  })

  it('allows slash (git namespace style)', () => {
    const r = validateBranchName('feat/x')
    expect(r.ok).toBe(true)
    expect(r.sanitized).toBe('feat/x')
  })

  it('rejects empty after sanitize', () => {
    const r = validateBranchName('   \\:*?"<>|   ')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/请填写分支名/)
  })

  it('rejects over-long names', () => {
    const r = validateBranchName('a'.repeat(BRANCH_MAX_LENGTH + 1))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不能超过/)
  })

  it('accepts exactly MAX_LENGTH', () => {
    const r = validateBranchName('a'.repeat(BRANCH_MAX_LENGTH))
    expect(r.ok).toBe(true)
    expect(r.sanitized.length).toBe(BRANCH_MAX_LENGTH)
  })

  // ============================================================================
  // strict 模式(后端兜底,ticket 02 验收 #11)
  // ============================================================================

  describe('validateBranchName · strict mode', () => {
    it('rejects when input contains forbidden chars (even if strip result is valid)', () => {
      const r = validateBranchName('feat/bad:branch', { strict: true })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/非法字符/)
    })

    it('accepts clean input under strict mode', () => {
      const r = validateBranchName('feat/refund-optimization', { strict: true })
      expect(r.ok).toBe(true)
      expect(r.sanitized).toBe('feat/refund-optimization')
    })

    it('rejects all-illegal input under strict mode (empty after strip)', () => {
      const r = validateBranchName('\\\\:*?"<>|', { strict: true })
      expect(r.ok).toBe(false)
      expect(r.error).toBeDefined()
    })

    it('default (non-strict) mode still accepts stripped-and-clean input', () => {
      const r = validateBranchName('feat/bad:branch')
      expect(r.ok).toBe(true)
      expect(r.sanitized).toBe('feat/badbranch')
    })
  })
})

// ============================================================================
// AttachReposRequestSchema —— {repoNames, branchName}（取代旧 {repoIds, branchName}）
// ============================================================================

describe('AttachReposRequestSchema', () => {
  it('accepts valid request (repoNames 字段名)', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: ['refund-service', 'order-service'],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty repoNames', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: [],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty repoName string', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: [''],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  it('rejects repoName > 100 chars', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: ['a'.repeat(101)],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  it('accepts repoName at exactly 100 chars', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: ['a'.repeat(100)],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing branchName', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: ['x'],
    })
    expect(r.success).toBe(false)
  })

  it('rejects > 50 repos', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoNames: Array.from({ length: 51 }, (_, i) => `r${i}`),
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  // ============================================================================
  // 旧字段名必须被 Zod 拒绝（迁移期防御性校验）
  // ============================================================================

  it('rejects legacy `repoIds` field name (必须用 repoNames)', () => {
    // 旧 ADR-0016 时代的字段名；若下游忘改,前端 sendJSON 会带错字段过来 → 后端必须 400
    const r = AttachReposRequestSchema.safeParse({
      repoIds: ['refund-service'],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// AttachRepoResultSchema —— discriminatedUnion('ok', [成功 / 失败])
// ============================================================================

describe('AttachRepoResultSchema', () => {
  it('accepts ok=true success result with codebasePath (取代旧 worktreePath)', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: true,
      repoName: 'refund-service',
      branch: 'feat/test',
      codebasePath: '/root/.aidevspace/requirements/req-001/codebase/refund-service',
      base: 'master',
    })
    expect(r.success).toBe(true)
    if (r.success && r.data.ok) {
      expect(r.data.codebasePath).toBe(
        '/root/.aidevspace/requirements/req-001/codebase/refund-service',
      )
    }
  })

  it('accepts ok=true with base=main', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: true,
      repoName: 'order-service',
      branch: 'feat/test',
      codebasePath: '/path/codebase/order-service',
      base: 'main',
    })
    expect(r.success).toBe(true)
  })

  it('rejects ok=true success result with legacy worktreePath (必须用 codebasePath)', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: true,
      repoName: 'refund-service',
      branch: 'feat/test',
      worktreePath: '/a/b/r1', // legacy
      base: 'master',
    })
    expect(r.success).toBe(false)
  })

  it('accepts ok=false result with E_REPO_ALREADY_ATTACHED', () => {
    // 决策 109:目录已存在 → E_REPO_ALREADY_ATTACHED
    const r = AttachRepoResultSchema.safeParse({
      ok: false,
      repoName: 'refund-service',
      code: RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED,
      message: 'codebase/refund-service 已存在',
    })
    expect(r.success).toBe(true)
  })

  it('accepts ok=false with E_DISK_FULL', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: false,
      repoName: 'r1',
      code: 'E_DISK_FULL',
      message: 'No space left',
    })
    expect(r.success).toBe(true)
  })

  it('rejects ok=false result with legacy repoId (必须用 repoName)', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: false,
      repoId: 'r1', // legacy
      code: 'E_DISK_FULL',
      message: 'No space left',
    })
    expect(r.success).toBe(false)
  })

  it('rejects ok=false with unknown error code', () => {
    const r = AttachRepoResultSchema.safeParse({
      ok: false,
      repoName: 'r1',
      code: 'E_BOGUS',
      message: 'x',
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// AttachReposResponseSchema —— {requirementId, branchName, succeeded, failed, results}
// ============================================================================

describe('AttachReposResponseSchema', () => {
  it('accepts all-success response', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 2,
      failed: 0,
      results: [
        {
          ok: true,
          repoName: 'refund-service',
          branch: 'feat/test',
          codebasePath: '/a/b/codebase/refund-service',
          base: 'master',
        },
        {
          ok: true,
          repoName: 'order-service',
          branch: 'feat/test',
          codebasePath: '/a/b/codebase/order-service',
          base: 'main',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts partial success (ok=true + ok=false 混合)', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 1,
      failed: 1,
      results: [
        {
          ok: true,
          repoName: 'refund-service',
          branch: 'feat/test',
          codebasePath: '/a/b/codebase/refund-service',
          base: 'master',
        },
        {
          ok: false,
          repoName: 'order-service',
          code: RepoAttachErrorCode.E_DISK_FULL,
          message: 'No space left',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects negative succeeded count', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: -1,
      failed: 0,
      results: [],
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-integer failed count', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 0,
      failed: 1.5,
      results: [],
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// RepoAttachErrorCode 枚举完整性 —— ADR-0030 D5
// ============================================================================

describe('RepoAttachErrorCode enum', () => {
  it('包含 E_AUTH / E_DISK_FULL / E_INVALID_BRANCH_NAME / E_REPO_NOT_FOUND / E_REPO_NAME_EXISTS / E_REPO_ALREADY_ATTACHED / E_REQUIREMENT_NOT_FOUND / E_NETWORK / E_INTERNAL', () => {
    expect(RepoAttachErrorCode.E_AUTH).toBe('E_AUTH')
    expect(RepoAttachErrorCode.E_DISK_FULL).toBe('E_DISK_FULL')
    expect(RepoAttachErrorCode.E_INVALID_BRANCH_NAME).toBe('E_INVALID_BRANCH_NAME')
    expect(RepoAttachErrorCode.E_REPO_NOT_FOUND).toBe('E_REPO_NOT_FOUND')
    expect(RepoAttachErrorCode.E_REPO_NAME_EXISTS).toBe('E_REPO_NAME_EXISTS')
    expect(RepoAttachErrorCode.E_REPO_ALREADY_ATTACHED).toBe('E_REPO_ALREADY_ATTACHED')
    expect(RepoAttachErrorCode.E_REQUIREMENT_NOT_FOUND).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(RepoAttachErrorCode.E_NETWORK).toBe('E_NETWORK')
    expect(RepoAttachErrorCode.E_INTERNAL).toBe('E_INTERNAL')
  })

  it('不含被淘汰的 E_BASE_BRANCH_NOT_FOUND / E_BRANCH_EXISTS（决策 111）', () => {
    // D5 明确删除:clone 必然有 HEAD / 全新 clone 不可能撞本地分支
    const keys = Object.keys(RepoAttachErrorCode)
    expect(keys).not.toContain('E_BASE_BRANCH_NOT_FOUND')
    expect(keys).not.toContain('E_BRANCH_EXISTS')
  })
})

// ============================================================================
// 常量 sanity check
// ============================================================================

describe('BRANCH_FORBIDDEN_RE', () => {
  it('matches forbidden path chars + whitespace', () => {
    for (const c of '\\:*?"<>|') {
      expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test(c)).toBe(true)
    }
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test(' ')).toBe(true)
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('\t')).toBe(true)
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('　')).toBe(true)
  })

  it('does NOT match slash (git namespace allowed)', () => {
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('/')).toBe(false)
  })
})