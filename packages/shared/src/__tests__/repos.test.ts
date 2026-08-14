/**
 * 仓库注册表契约测试 —— ADR-0030 D1 / .scratch/repo-registry-clone/issues/01-shared-schema.md 1.2
 *
 * 测试 seam：RepoRegistryEntrySchema / RepoRegistrySchema / RepoRegistryResponseSchema
 * —— 这是 web/agent 共用的仓库条目契约；前端按 `{name, gitUrl, description}` 渲染仓库列表 chip，
 * 后端按此 schema 写入 `~/.aidevspace/repos.yaml`。
 */
import { describe, it, expect } from 'vitest'
import {
  RepoRegistryEntrySchema,
  RepoRegistrySchema,
  RepoRegistryResponseSchema,
} from '../repos.js'

// ============================================================================
// RepoRegistryEntrySchema —— 单条仓库条目（{name, gitUrl, description}）
// ============================================================================

describe('RepoRegistryEntrySchema', () => {
  it('accepts a well-formed entry', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund-service.git',
      description: '退款核心服务',
    })
    expect(r.success).toBe(true)
  })

  it('accepts an empty description (注册表允许 description 留空)', () => {
    // FR-6.1 一次性迁移场景：旧 repos/<name>/ 没有描述元数据 → description 必须允许空串
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund-service.git',
      description: '',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing name', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      gitUrl: 'git@github.com:co/x.git',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty name', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: '',
      gitUrl: 'git@github.com:co/x.git',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects name > 100 chars (文件名安全)', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'a'.repeat(101),
      gitUrl: 'git@github.com:co/x.git',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('accepts name at exactly 100 chars', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'a'.repeat(100),
      gitUrl: 'git@github.com:co/x.git',
      description: '',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing gitUrl', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty gitUrl', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: '',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects gitUrl > 500 chars', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:' + 'a'.repeat(500) + '.git',
      description: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects description > 500 chars', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund-service.git',
      description: 'x'.repeat(501),
    })
    expect(r.success).toBe(false)
  })

  it('accepts description at exactly 500 chars', () => {
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund-service.git',
      description: 'x'.repeat(500),
    })
    expect(r.success).toBe(true)
  })

  it('ignores extra fields (e.g. `id` from legacy entries) — `name/gitUrl/description` 三字段齐全即可', () => {
    // FR-1.2:多余字段不报错但忽略
    // 旧 repo-<name> slug 派生链清退时,遗留 yaml 可能含 `id` 字段——必须能平滑吃下
    const r = RepoRegistryEntrySchema.safeParse({
      name: 'refund-service',
      gitUrl: 'git@github.com:co/refund-service.git',
      description: '',
      id: 'repo-refund-service', // legacy
      defaultBranch: 'main', // legacy, D1 显式排除
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).not.toHaveProperty('id')
      expect(r.data).not.toHaveProperty('defaultBranch')
    }
  })
})

// ============================================================================
// RepoRegistrySchema —— 顶层 yaml 文件结构（{version: 1, repos: []}）
// ============================================================================

describe('RepoRegistrySchema', () => {
  it('accepts empty repos array (全新安装)', () => {
    const r = RepoRegistrySchema.safeParse({
      version: 1,
      repos: [],
    })
    expect(r.success).toBe(true)
  })

  it('accepts multiple entries', () => {
    const r = RepoRegistrySchema.safeParse({
      version: 1,
      repos: [
        {
          name: 'refund-service',
          gitUrl: 'git@github.com:co/refund-service.git',
          description: '退款',
        },
        {
          name: 'order-service',
          gitUrl: 'git@github.com:co/order-service.git',
          description: '订单',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects version != 1', () => {
    const r = RepoRegistrySchema.safeParse({
      version: 2,
      repos: [],
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing repos field', () => {
    const r = RepoRegistrySchema.safeParse({
      version: 1,
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// RepoRegistryResponseSchema —— GET /api/repos 响应（仅 repos 字段）
// ============================================================================

describe('RepoRegistryResponseSchema', () => {
  it('accepts empty repos', () => {
    const r = RepoRegistryResponseSchema.safeParse({ repos: [] })
    expect(r.success).toBe(true)
  })

  it('accepts list of repos', () => {
    const r = RepoRegistryResponseSchema.safeParse({
      repos: [
        {
          name: 'refund-service',
          gitUrl: 'git@github.com:co/refund-service.git',
          description: '',
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects entry with missing name', () => {
    const r = RepoRegistryResponseSchema.safeParse({
      repos: [{ gitUrl: 'x', description: '' }],
    })
    expect(r.success).toBe(false)
  })
})