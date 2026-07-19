/**
 * RequirementService ticket 03 测试 —— 双入口上传管道 service entry
 *
 * 覆盖(对照 .scratch/prd-upload-and-edit/issues/03-drafting-upload-and-dialog-prefill.md):
 * - `parseForDialog()`:闸门 + 解析 → 返回 markdown,**不写盘**
 * - `uploadAndReplace()`:闸门 + 解析 + 落 assets/ + 替换 data URI + 覆盖 requirement.md
 * - `replaceRequirementMd()`:直接写盘,沿用 ticket 02 同步写盘风格
 * - 闸门/解析失败 → `{ok:false, ...}`,**不写盘**
 * - 端到端 .docx fixture:sample-prd.docx → uploadAndReplace → 磁盘新文件 + assets/
 * - 路由 POST /api/uploads/parse 与 POST /api/requirement/:id/upload-replace 端到端
 */

import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'
import { authPlugin } from '../auth/authPlugin.js'
import { requirementRoutes } from '../routes/requirement.js'
import {
  RequirementService,
  type ParsedUploadImage,
  type RequirementServiceDeps,
} from '../services/RequirementService.js'
import { createSseHub } from '../sse/SseHub.js'

/** 1×1 透明 PNG base64(68 字节) */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const SAMPLE_DOCX = new URL('../../test/fixtures/sample-prd.docx', import.meta.url)
  .pathname

function gitMainOnly(): RequirementServiceDeps['git'] {
  return vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
}

const noSleep = (_ms: number) => Promise.resolve()

let realRoot: string

beforeEach(() => {
  realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-upload-dialog-'))
})

afterEach(() => {
  rmSync(realRoot, { recursive: true, force: true })
})

function makeService(): RequirementService {
  return new RequirementService({
    root: realRoot,
    git: gitMainOnly(),
    sleep: noSleep,
  })
}

function makeReqDir(reqId: string): void {
  mkdirSync(join(realRoot, 'requirements', reqId), { recursive: true })
  writeFileSync(
    join(realRoot, 'requirements', reqId, 'meta.yaml'),
    `id: ${reqId}\ntitle: 测试\ncreatedAt: 2026-07-19T00:00:00Z\n`,
    'utf8',
  )
}

// ============================================================================
// parseForDialog —— Dialog 预填(.md / .txt / .docx 通用,**不写盘**)
// ============================================================================

describe('RequirementService.parseForDialog', () => {
  it('.md:返回原 UTF-8 markdown,不写盘', async () => {
    const svc = makeService()
    const before = existsSync(join(realRoot, 'requirements'))
    const result = await svc.parseForDialog(
      Buffer.from('# 标题\n\n正文', 'utf8'),
      'prd.md',
      'text/markdown',
    )
    expect(result).toEqual({
      ok: true,
      markdown: '# 标题\n\n正文',
      images: [],
    })
    // 关键:不写盘 —— requirements 目录不应该出现新的 req 目录
    if (before) {
      const after = readdirSafe(join(realRoot, 'requirements'))
      expect(after).toEqual([])
    } else {
      expect(existsSync(join(realRoot, 'requirements'))).toBe(false)
    }
  })

  it('.docx:解析并抽取图片数据,返回 markdown + images,**不写盘**', async () => {
    const svc = makeService()
    const buffer = readFileSync(SAMPLE_DOCX)
    const result = await svc.parseForDialog(
      buffer,
      'sample-prd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('# 标题')
    // ticket 03 修复:images 也在 parseForDialog 返回(等"创建"时由
    // createRequirement 阶段调 landAssets)
    expect(result.images.length).toBeGreaterThanOrEqual(1)
    expect(result.images[0].name).toBe('prd-1')
    // 关键:不写盘 —— 既无 requirement.md 也无 assets/
    expect(existsSync(join(realRoot, 'requirements'))).toBe(false)
  })

  it('.rar → 闸门 ext 失败,无 result.ok', async () => {
    const svc = makeService()
    const result = await svc.parseForDialog(
      Buffer.from('content'),
      'prd.rar',
      'application/octet-stream',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('ext')
  })

  it('空 ext → 闸门 ext 失败', async () => {
    const svc = makeService()
    const result = await svc.parseForDialog(
      Buffer.from('content'),
      'noext',
      'text/markdown',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('ext')
  })

  it('> 10 MB .md → 闸门 size 失败', async () => {
    const svc = makeService()
    const big = Buffer.alloc(11 * 1024 * 1024, 'a')
    const result = await svc.parseForDialog(big, 'big.md', 'text/markdown')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('size')
  })
})

// ============================================================================
// uploadAndReplace —— DRAFTING 覆盖(.md / .txt / .docx,落盘 + 落 assets/)
// ============================================================================

describe('RequirementService.uploadAndReplace', () => {
  it('req 目录不存在 → requirement-not-found', async () => {
    const svc = makeService()
    const result = await svc.uploadAndReplace(
      'req-ghost',
      Buffer.from('# t', 'utf8'),
      'p.md',
      'text/markdown',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('requirement-not-found')
  })

  it('.md:覆盖 requirement.md,无图时 assets 为空', async () => {
    const svc = makeService()
    const reqId = 'req-001-md'
    makeReqDir(reqId)
    // 先写一份旧内容,验证覆盖语义
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 旧版\n',
      'utf8',
    )

    const result = await svc.uploadAndReplace(
      reqId,
      Buffer.from('# 新版\n\n完整 PRD', 'utf8'),
      'new.md',
      'text/markdown',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toBe('# 新版\n\n完整 PRD')
    expect(result.assets).toEqual([])

    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe('# 新版\n\n完整 PRD')
    // 不写 assets/(无图)
    expect(existsSync(join(realRoot, 'requirements', reqId, 'assets'))).toBe(
      false,
    )
  })

  it('.docx fixture:解析 + 落 assets/ + 替换 data URI + 覆盖 requirement.md', async () => {
    const svc = makeService()
    const reqId = 'req-002-docx'
    makeReqDir(reqId)

    const buffer = readFileSync(SAMPLE_DOCX)
    const result = await svc.uploadAndReplace(
      reqId,
      buffer,
      'sample-prd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 1. markdown 中 data URI 被替换为相对路径
    expect(result.markdown).not.toContain('data:image')
    expect(result.markdown).toContain('![](assets/prd-1.png)')
    // 2. assets[] 含 prd-1.png 元数据
    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]).toMatchObject({
      name: 'prd-1.png',
      mime: 'image/png',
    })
    expect(result.assets[0].url).toBe(
      `/api/requirement/${reqId}/assets/prd-1.png`,
    )
    // 3. requirement.md 实际写入替换后的 markdown
    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe(result.markdown)
    expect(onDisk).toContain('![](assets/prd-1.png)')
    // 4. assets/ 目录下文件已落地
    expect(
      existsSync(join(realRoot, 'requirements', reqId, 'assets', 'prd-1.png')),
    ).toBe(true)
  })

  it('闸门失败(.rar)→ 现有 requirement.md 不被覆盖', async () => {
    const svc = makeService()
    const reqId = 'req-003-rar'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 原版\n',
      'utf8',
    )

    const result = await svc.uploadAndReplace(
      reqId,
      Buffer.from('rar-content'),
      'prd.rar',
      'application/octet-stream',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('ext')
    // 关键:不写盘
    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe('# 原版\n')
    expect(
      existsSync(join(realRoot, 'requirements', reqId, 'assets')),
    ).toBe(false)
  })

  it('覆盖强度 W4:直接覆盖旧内容,不写历史', async () => {
    const svc = makeService()
    const reqId = 'req-004-w4'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 旧版 1\n\n旧内容\n',
      'utf8',
    )

    const result = await svc.uploadAndReplace(
      reqId,
      Buffer.from('# 新版 2', 'utf8'),
      'v2.md',
      'text/markdown',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    // 不存在 _history/ 之类存档目录(ADR-0015 D8 W4 锁)
    expect(onDisk).toBe('# 新版 2')
    expect(
      existsSync(join(realRoot, 'requirements', reqId, '_history')),
    ).toBe(false)
  })
})

// ============================================================================
// replaceRequirementMd —— 直接写盘(ticket 03 service 内部分解方法)
// ============================================================================

describe('RequirementService.replaceRequirementMd', () => {
  it('req 目录不存在 → 不写盘(file-not-found 由调用方处理)', () => {
    const svc = makeService()
    // 故意未创建 req 目录 → writeFileSync 应抛错
    expect(() => svc.replaceRequirementMd('req-nope', '# t')).toThrow()
  })

  it('req 目录存在 → 同步写盘,内容等于入参', () => {
    const svc = makeService()
    const reqId = 'req-005-replace'
    makeReqDir(reqId)

    svc.replaceRequirementMd(reqId, '# 直接写盘\n\nbody')

    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe('# 直接写盘\n\nbody')
  })

  it('覆盖旧内容(无历史保留)', () => {
    const svc = makeService()
    const reqId = 'req-006-overwrite'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 旧\n',
      'utf8',
    )
    svc.replaceRequirementMd(reqId, '# 新\n')
    const onDisk = readFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe('# 新\n')
  })
})

// ============================================================================
// createRequirement —— ticket 03 接受可选 prdMarkdown
// ============================================================================

describe('RequirementService.createRequirement(prdMarkdown)', () => {
  it('不传 prdMarkdown → 走默认 buildRequirementMdTemplate', () => {
    const svc = makeService()
    const result = svc.createRequirement('退款功能优化')
    expect(result.id).toBe('req-001-退款功能优化')
    const onDisk = readFileSync(
      join(result.dirPath, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toContain('# 退款功能优化')
    expect(onDisk).toContain('DRAFTING')
  })

  it('传 prdMarkdown → 用它写入 requirement.md(替代默认模板)', () => {
    const svc = makeService()
    const result = svc.createRequirement(
      '退款功能优化',
      '# 自定义 PRD\n\n## 背景\n由用户上传解析而来',
    )
    expect(result.id).toBe('req-001-退款功能优化')
    const onDisk = readFileSync(
      join(result.dirPath, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toBe('# 自定义 PRD\n\n## 背景\n由用户上传解析而来')
    // 不残留默认模板的 "DRAFTING" 提示
    expect(onDisk).not.toContain('<!-- 在 DRAFTING 工位编写')
  })

  it('空字符串 prdMarkdown → 视同未传,走默认模板', () => {
    const svc = makeService()
    const result = svc.createRequirement('退款功能优化', '   ')
    const onDisk = readFileSync(
      join(result.dirPath, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).toContain('# 退款功能优化')
    expect(onDisk).toContain('DRAFTING')
  })

  /**
   * ticket 03 (ADR-0015 D3 / D5) 端到端 —— Dialog 选 .docx:
   * 1) 走 `parseForDialog()` 拿回 markdown + images(不落盘)
   * 2) 调 `createRequirement(title, markdown, images)` → 落 assets/ + 替换 data URI + 写盘
   * 3) DRAFTING 打开能从 assets/prd-N.png 看到完整图片
   *
   * 这是 code-review 修复 1 后加的端到端断言,UI 单元测试用 mock 掩盖了
   * 此前"parseForDialog 丢 images → 写盘后 data URI 仍在"的断链。
   */
  it('createRequirement 接 images + prdMarkdown → 落 assets/ + 替换 data URI(ticket 03 端到端)', () => {
    const svc = makeService()
    // 1) 模拟 parseForDialog 返回:markdown 仍含 data URI + images 数组
    const docxMarkdown = `# 退款功能优化

![示意图](${`data:image/png;base64,${TINY_PNG_B64}`})

## 背景

图片能进 DRAFTING
`
    const images: ParsedUploadImage[] = [
      { name: 'prd-1', base64: TINY_PNG_B64, mime: 'image/png' },
    ]
    // 2) 调 createRequirement 把 images 一并传入
    const result = svc.createRequirement('退款功能优化', docxMarkdown, images)

    // 3) 验证:
    // - assets/prd-1.png 真的落到磁盘
    const assetPath = join(result.dirPath, 'assets', 'prd-1.png')
    expect(existsSync(assetPath)).toBe(true)
    expect(readFileSync(assetPath)).toHaveLength(68)
    // - requirement.md 中 data URI 已被替换为相对路径
    const onDisk = readFileSync(
      join(result.dirPath, 'requirement.md'),
      'utf8',
    )
    expect(onDisk).not.toContain('data:image')
    expect(onDisk).toContain('assets/prd-1.png')
  })

  it('createRequirement 不传 images → 不创建 assets/ 目录(纯 markdown 路径)', () => {
    const svc = makeService()
    const result = svc.createRequirement('退款功能优化', '# 纯文本\n')
    expect(existsSync(join(result.dirPath, 'assets'))).toBe(false)
  })
})

// ============================================================================
// HTTP 路由 —— POST /api/uploads/parse 与 POST /api/requirement/:id/upload-replace
// ============================================================================

interface BootResult {
  url: string
  root: string
  token: string
  cleanup: () => Promise<void>
}

async function boot(): Promise<BootResult> {
  const app: FastifyInstance = Fastify()
  // 直接构造一个简化的 server,避免重复 buildServer 的复杂性
  const root = realRoot
  const tokenMgr = new TokenManager(root, {
    warn: () => {
      /* silent */
    },
  })
  await tokenMgr.ensure()
  await app.register(authPlugin, {
    tokenManager: tokenMgr,
    allowedOrigins: ['http://localhost:3333'],
  })
  const service = makeService()
  await app.register(requirementRoutes, {
    requirementService: service,
    sseHub: createSseHub(),
  })
  // 真实文件系统(req 目录已在测试里创建)
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  const token = readFileSync(join(root, '.agent-token'), 'utf8')
  return {
    url,
    root,
    token,
    cleanup: async () => {
      try {
        await app.close()
      } catch {
        /* ignore */
      }
    },
  }
}

describe('POST /api/uploads/parse', () => {
  it('200 + markdown(Dialog 预填,不写盘)', async () => {
    const { url, token, cleanup } = await boot()
    try {
      const body = {
        filename: 'prd.md',
        mime: 'text/markdown',
        contentBase64: Buffer.from('# 解析目标\n\nbody', 'utf8').toString(
          'base64',
        ),
      }
      const res = await fetch(`${url}/api/uploads/parse`, {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
          origin: 'http://localhost:3333',
        },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(200)
      const data = (await res.json()) as { markdown: string }
      expect(data.markdown).toBe('# 解析目标\n\nbody')
      // 关键:不写盘
      expect(existsSync(join(realRoot, 'requirements'))).toBe(false)
    } finally {
      await cleanup()
    }
  })

  it('闸门 ext 失败 → 400 + E_UPLOAD_EXT', async () => {
    const { url, token, cleanup } = await boot()
    try {
      const body = {
        filename: 'prd.rar',
        mime: 'application/octet-stream',
        contentBase64: Buffer.from('x').toString('base64'),
      }
      const res = await fetch(`${url}/api/uploads/parse`, {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
          origin: 'http://localhost:3333',
        },
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as {
        error: string
        reason: string
      }
      expect(data.error).toBe('E_UPLOAD_EXT')
      expect(data.reason).toBe('ext')
    } finally {
      await cleanup()
    }
  })

  it('闸门 body 缺字段 → 400 E_INVALID_UPLOAD_PAYLOAD', async () => {
    const { url, token, cleanup } = await boot()
    try {
      const res = await fetch(`${url}/api/uploads/parse`, {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
          origin: 'http://localhost:3333',
        },
        body: JSON.stringify({ filename: 'p.md' }),
      })
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: string }
      expect(data.error).toBe('E_INVALID_UPLOAD_PAYLOAD')
    } finally {
      await cleanup()
    }
  })
})

describe('POST /api/requirement/:id/upload-replace', () => {
  it('req 不存在 → 404 E_REQUIREMENT_NOT_FOUND', async () => {
    const { url, token, cleanup } = await boot()
    try {
      const res = await fetch(
        `${url}/api/requirement/req-ghost/upload-replace`,
        {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
            origin: 'http://localhost:3333',
          },
          body: JSON.stringify({
            filename: 'p.md',
            mime: 'text/markdown',
            contentBase64: Buffer.from('# t', 'utf8').toString('base64'),
          }),
        },
      )
      expect(res.status).toBe(404)
      const data = (await res.json()) as {
        error: string
        reason: string
      }
      expect(data.error).toBe('E_REQUIREMENT_NOT_FOUND')
    } finally {
      await cleanup()
    }
  })

  it('200 + markdown + assets(DRAFTING 覆盖,W4 强度)', async () => {
    const { url, token, cleanup } = await boot()
    const reqId = 'req-007-http-replace'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 旧\n',
      'utf8',
    )
    try {
      const docx = readFileSync(SAMPLE_DOCX)
      const res = await fetch(
        `${url}/api/requirement/${reqId}/upload-replace`,
        {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
            origin: 'http://localhost:3333',
          },
          body: JSON.stringify({
            filename: 'sample-prd.docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            contentBase64: docx.toString('base64'),
          }),
        },
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        markdown: string
        assets: Array<{ name: string; mime: string }>
      }
      expect(data.markdown).not.toContain('data:image')
      expect(data.markdown).toContain('![](assets/prd-1.png)')
      expect(data.assets).toHaveLength(1)
      expect(data.assets[0].name).toBe('prd-1.png')
      // 磁盘上 requirement.md 被覆盖
      const onDisk = readFileSync(
        join(realRoot, 'requirements', reqId, 'requirement.md'),
        'utf8',
      )
      expect(onDisk).toBe(data.markdown)
    } finally {
      await cleanup()
    }
  })

  it('闸门失败 → 400 + reason,**不写盘**', async () => {
    const { url, token, cleanup } = await boot()
    const reqId = 'req-008-http-fail'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 旧版\n',
      'utf8',
    )
    try {
      const res = await fetch(
        `${url}/api/requirement/${reqId}/upload-replace`,
        {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
            origin: 'http://localhost:3333',
          },
          body: JSON.stringify({
            filename: 'p.rar',
            mime: 'application/octet-stream',
            contentBase64: Buffer.from('rar').toString('base64'),
          }),
        },
      )
      expect(res.status).toBe(400)
      // 关键:旧版 requirement.md 保留
      const onDisk = readFileSync(
        join(realRoot, 'requirements', reqId, 'requirement.md'),
        'utf8',
      )
      expect(onDisk).toBe('# 旧版\n')
    } finally {
      await cleanup()
    }
  })
})

// ============================================================================
// helpers
// ============================================================================

function readdirSafe(path: string): string[] {
  return readdirSync(path)
}