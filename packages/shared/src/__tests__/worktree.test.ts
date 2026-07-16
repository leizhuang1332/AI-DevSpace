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
