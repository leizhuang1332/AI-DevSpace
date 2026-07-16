import { describe, it, expect } from 'vitest'
import {
  AttachReposRequestSchema,
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
      // 'feat/bad:branch' 含 ':',strip 后变 'feat/badbranch' 本身合法
      // strict 模式下应 reject(后端兜底语义)
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
      // 两种 error message 都可以(strict 优先命中,否则 trim 空)
      expect(r.error).toBeDefined()
    })

    it('default (non-strict) mode still accepts stripped-and-clean input', () => {
      // 前端 dialog 的 silent strip 语义保留
      const r = validateBranchName('feat/bad:branch')
      expect(r.ok).toBe(true)
      expect(r.sanitized).toBe('feat/badbranch')
    })
  })
})

// ============================================================================
// Zod schema
// ============================================================================

describe('AttachReposRequestSchema', () => {
  it('accepts valid request', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoIds: ['refund-service', 'order-service'],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty repoIds', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoIds: [],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty repoId string', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoIds: [''],
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing branchName', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoIds: ['x'],
    })
    expect(r.success).toBe(false)
  })

  it('rejects > 50 repos', () => {
    const r = AttachReposRequestSchema.safeParse({
      repoIds: Array.from({ length: 51 }, (_, i) => `r${i}`),
      branchName: 'feat/test',
    })
    expect(r.success).toBe(false)
  })
})

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
          repoId: 'r1',
          branch: 'feat/test',
          worktreePath: '/a/b/r1',
          base: 'master',
        },
        {
          ok: true,
          repoId: 'r2',
          branch: 'feat/test',
          worktreePath: '/a/b/r2',
          base: 'main',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts partial success', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 1,
      failed: 1,
      results: [
        {
          ok: true,
          repoId: 'r1',
          branch: 'feat/test',
          worktreePath: '/a/b/r1',
          base: 'master',
        },
        {
          ok: false,
          repoId: 'r2',
          code: RepoAttachErrorCode.E_DISK_FULL,
          message: 'No space left',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown error code', () => {
    const r = AttachReposResponseSchema.safeParse({
      requirementId: 'req-001',
      branchName: 'feat/test',
      succeeded: 0,
      failed: 1,
      results: [
        { ok: false, repoId: 'r1', code: 'E_BOGUS', message: 'x' },
      ],
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// 常量 sanity check
// ============================================================================

describe('BRANCH_FORBIDDEN_RE', () => {
  it('matches forbidden path chars + whitespace', () => {
    // /g flag + RegExp.test 有 lastIndex 状态;每次新建 regex 避免相互影响
    for (const c of '\\:*?"<>|') {
      expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test(c)).toBe(true)
    }
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test(' ')).toBe(true)
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('\t')).toBe(true)
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('　')).toBe(true) // 全角空格
  })

  it('does NOT match slash (git namespace allowed)', () => {
    expect(new RegExp(BRANCH_FORBIDDEN_RE.source, 'g').test('/')).toBe(false)
  })
})
