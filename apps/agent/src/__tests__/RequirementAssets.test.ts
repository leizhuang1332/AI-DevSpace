/**
 * RequirementService ticket 02 测试 —— `assets/` 落地 + ResourceTree 扫描 + 路由路径安全
 *
 * 覆盖(对照 .scratch/prd-upload-and-edit/issues/02-requirements-assets-landing.md):
 * - landAssets():按 images 顺序写盘、返回 AssetMeta、抛错语义
 * - replaceDataUriWithAssetPath():纯函数、md 替换顺序与 landAssets 命名一致
 * - get(reqId):不存在的 reqId → null;真实 req → 含 assets[]
 * - list(reqId):包含 assets/ 节点 + 子文件,忽略 _archived/ 与 . 前缀
 * - resolveAssetFile():正常文件、path 穿越(null byte / ../ / \\ / 绝对路径 / basename 不匹配)
 * - 端到端 fixture:sample-prd.docx → parseUpload → landAssets → get(reqId).assets 链路
 * - HTTP 路由 GET /api/requirement/:id/assets/:filename + 路径穿越防护
 * - HTTP 路由 GET /api/requirement/:id → 调用 service.get(reqId)
 *
 * 复用 RequirementService.test.ts 的基础设施(realRoot / cleanups / noSleep / fake git)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
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

// ============================================================================
// Fixtures
// ============================================================================

/** 1×1 透明 PNG base64(68 字节,解析后) */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function makePngImage(name: string): ParsedUploadImage {
  return { name, mime: 'image/png', base64: TINY_PNG_B64 }
}

/** 真实 fixture 路径(与 RequirementUpload.test.ts 共用) */
const SAMPLE_DOCX = new URL('../../test/fixtures/sample-prd.docx', import.meta.url)
  .pathname

function gitMainOnly(): RequirementServiceDeps['git'] {
  return vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
}

const noSleep = (_ms: number) => Promise.resolve()

// ============================================================================
// 真实文件系统 setUp
// ============================================================================

let realRoot: string

beforeEach(() => {
  realRoot = mkdtempSync(join(tmpdir(), 'aidevsp-assets-'))
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

// ============================================================================
// landAssets()
// ============================================================================

describe('RequirementService.landAssets', () => {
  it('按 images 顺序写盘;首张 → prd-1.png,base64 字节数=68', () => {
    const svc = makeService()
    const reqId = 'req-001-pic'
    makeReqDir(reqId)

    const landed = svc.landAssets(reqId, [makePngImage('prd-1')])

    expect(landed).toHaveLength(1)
    expect(landed[0]).toMatchObject({
      name: 'prd-1.png',
      size: 68,
      mime: 'image/png',
    })
    expect(landed[0].url).toBe(
      '/api/requirement/req-001-pic/assets/prd-1.png',
    )
    expect(landed[0].path).toBe(`requirements/${reqId}/assets/prd-1.png`)

    const file = svc.assetPath(reqId, 'prd-1.png')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file)).toHaveLength(68)
  })

  it('自动 mkdir requirements/<id>/assets/(recursive)', () => {
    const svc = makeService()
    const reqId = 'req-002-pic'
    makeReqDir(reqId)
    expect(existsSync(svc.assetsDir(reqId))).toBe(false)

    svc.landAssets(reqId, [makePngImage('prd-1')])
    expect(existsSync(svc.assetsDir(reqId))).toBe(true)
  })

  it('多张图片按顺序递增命名:prd-1.png / prd-2.jpg / prd-3.gif', () => {
    const svc = makeService()
    const reqId = 'req-003-multi'
    makeReqDir(reqId)

    const landed = svc.landAssets(reqId, [
      makePngImage('prd-1'),
      { name: 'prd-2', mime: 'image/jpeg', base64: TINY_PNG_B64 },
      { name: 'prd-3', mime: 'image/gif', base64: TINY_PNG_B64 },
    ])

    expect(landed.map((a) => a.name)).toEqual([
      'prd-1.png',
      'prd-2.jpg',
      'prd-3.gif',
    ])
    expect(landed.map((a) => a.mime)).toEqual([
      'image/png',
      'image/jpeg',
      'image/gif',
    ])
    expect(svc.listAssets(reqId).map((a) => a.name)).toEqual([
      'prd-1.png',
      'prd-2.jpg',
      'prd-3.gif',
    ])
  })

  it('未知 mime 默认 ext=bin', () => {
    const svc = makeService()
    const reqId = 'req-004-mime'
    makeReqDir(reqId)

    const landed = svc.landAssets(reqId, [
      { name: 'prd-1', mime: 'image/x-unknown-future', base64: TINY_PNG_B64 },
    ])

    expect(landed[0].name).toBe('prd-1.bin')
  })

  it('空 images 数组 → 空 AssetMeta[],且不创建空 assets/ 目录', () => {
    const svc = makeService()
    const reqId = 'req-005-empty'
    makeReqDir(reqId)

    expect(svc.landAssets(reqId, [])).toEqual([])
    expect(existsSync(svc.assetsDir(reqId))).toBe(false)
  })

  it('写盘失败抛错(把 assets/ 父级变成文件,impersonate dir conflict)', () => {
    const svc = makeService()
    const reqId = 'req-006-writefail'
    // 1) 确保 requirements/ 父目录存在
    // 2) 把 reqId 这个本应是目录的路径变成一个普通文件
    // 3) landAssets() 调 mkdirSync(<…>/<id>/assets) 时应该因为父级是文件而抛错
    const { mkdirSync: mkdir } = require('node:fs')
    mkdir(join(realRoot, 'requirements'), { recursive: true })
    writeFileSync(join(realRoot, 'requirements', reqId), 'blocker')
    expect(() => svc.landAssets(reqId, [makePngImage('prd-1')])).toThrow()
  })
})

// ============================================================================
// replaceDataUriWithAssetPath()
// ============================================================================

describe('RequirementService.replaceDataUriWithAssetPath', () => {
  it('替换 data URI 为按顺序的相对路径', () => {
    const svc = makeService()
    const md = `# 标题

![](${`data:image/png;base64,${TINY_PNG_B64}`})

![](${`data:image/jpeg;base64,${TINY_PNG_B64}`})
`
    const out = svc.replaceDataUriWithAssetPath('req-x', md)
    expect(out).toContain('![](assets/prd-1.png)')
    expect(out).toContain('![](assets/prd-2.jpg)')
    expect(out).not.toContain('data:image')
    expect(out).not.toContain(TINY_PNG_B64)
  })

  it('纯函数:不修改入参字符串(用 JSON.stringify 比较引用不变性)', () => {
    const svc = makeService()
    const original = `intro ![](${`data:image/png;base64,${TINY_PNG_B64}`}) end`
    const snapshot = JSON.stringify(original)
    svc.replaceDataUriWithAssetPath('req-x', original)
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('非 image mime 的 data URI(罕见)保留原样,不替换', () => {
    const svc = makeService()
    const md = `![](${`data:application/pdf;base64,xxx`})`
    const out = svc.replaceDataUriWithAssetPath('req-x', md)
    expect(out).toBe(md)
  })

  it('无 data URI 时返回等价字符串', () => {
    const svc = makeService()
    const md = '# 标题\n\n纯文本,无图。'
    expect(svc.replaceDataUriWithAssetPath('req-x', md)).toBe(md)
  })

  it('命名顺序与 landAssets 一致(markdown 替换后路径 = assets/<landed.name>)', () => {
    const svc = makeService()
    const reqId = 'req-007-contract'
    makeReqDir(reqId)
    const md = `![](${`data:image/png;base64,${TINY_PNG_B64}`})\n\n![](${`data:image/jpeg;base64,${TINY_PNG_B64}`})`
    const rewritten = svc.replaceDataUriWithAssetPath(reqId, md)
    const images: ParsedUploadImage[] = [
      makePngImage('prd-1'),
      { name: 'prd-2', mime: 'image/jpeg', base64: TINY_PNG_B64 },
    ]
    const landed = svc.landAssets(reqId, images)
    // markdown 用相对路径 `assets/prd-N.<ext>`,刚好等于 landed.name 加上 `assets/` 前缀
    expect(rewritten).toContain(`![](assets/${landed[0].name})`)
    expect(rewritten).toContain(`![](assets/${landed[1].name})`)
  })
})

// ============================================================================
// get(reqId) + listAssets(reqId)
// ============================================================================

describe('RequirementService.get / listAssets', () => {
  it('get 不存在的 reqId → null', () => {
    const svc = makeService()
    expect(svc.get('req-not-exists')).toBeNull()
  })

  it('get 已落地的 requirement:含 requirement.md 正文与 assets[]', () => {
    const svc = makeService()
    const reqId = 'req-008-detail'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# 标题\n\n正文段落\n',
      'utf8',
    )
    svc.landAssets(reqId, [makePngImage('prd-1')])

    const detail = svc.get(reqId)
    expect(detail).not.toBeNull()
    expect(detail!.id).toBe(reqId)
    expect(detail!.requirementMarkdown).toContain('# 标题')
    expect(detail!.assets).toHaveLength(1)
    expect(detail!.assets[0]).toMatchObject({
      name: 'prd-1.png',
      mime: 'image/png',
      size: 68,
      url: `/api/requirement/${reqId}/assets/prd-1.png`,
    })
  })

  it('listAssets 按文件名升序', () => {
    const svc = makeService()
    const reqId = 'req-009-sort'
    makeReqDir(reqId)
    svc.landAssets(reqId, [
      makePngImage('prd-1'),
      { name: 'prd-2', mime: 'image/jpeg', base64: TINY_PNG_B64 },
      { name: 'prd-3', mime: 'image/gif', base64: TINY_PNG_B64 },
    ])
    expect(svc.listAssets(reqId).map((a) => a.name)).toEqual([
      'prd-1.png',
      'prd-2.jpg',
      'prd-3.gif',
    ])
  })

  it('assets/ 不存在时 listAssets 返回 []', () => {
    const svc = makeService()
    expect(svc.listAssets('req-empty')).toEqual([])
  })
})

// ============================================================================
// list(reqId) —— ResourceTree(ADR-0015 D5)
// ============================================================================

describe('RequirementService.list(reqId) —— ResourceTree 扫描', () => {
  it('包含顶层文件 + assets/ 目录(子节点仅文件名,无路径前缀)', () => {
    const svc = makeService()
    const reqId = 'req-010-tree'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'meta.yaml'),
      'id: foo\ntitle: foo\ncreatedAt: 2026-07-19T00:00:00Z\n',
      'utf8',
    )
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# T',
      'utf8',
    )
    svc.landAssets(reqId, [
      makePngImage('prd-1'),
      { name: 'prd-2', mime: 'image/jpeg', base64: TINY_PNG_B64 },
    ])

    const tree = svc.list(reqId)

    const assetsNode = tree.find((n) => n.name === 'assets')
    expect(assetsNode).toBeDefined()
    expect(assetsNode!.type).toBe('directory')
    expect(assetsNode!.children!.map((c) => c.name).sort()).toEqual([
      'prd-1.png',
      'prd-2.jpg',
    ])
    expect(assetsNode!.children![0].path).toBe('assets/prd-1.png')
    // 子节点不带 assets/ 之外的多层前缀
    for (const child of assetsNode!.children!) {
      expect(child.path.split('/')).toHaveLength(2)
    }
  })

  it('忽略 `_archived/` 与其他 _ 前缀目录(ADR-0015 D5)', () => {
    const svc = makeService()
    const reqId = 'req-011-underscore'
    makeReqDir(reqId)
    const { mkdirSync: mkdir } = require('node:fs')
    mkdir(join(realRoot, 'requirements', reqId, '_archived'), { recursive: true })
    writeFileSync(
      join(realRoot, 'requirements', reqId, '_archived', 'old.md'),
      'archived',
      'utf8',
    )
    mkdir(join(realRoot, 'requirements', reqId, '_internal'), { recursive: true })
    writeFileSync(
      join(realRoot, 'requirements', reqId, '_internal', 'notes.md'),
      'internal',
      'utf8',
    )

    const tree = svc.list(reqId)
    const allNames = tree.flatMap((n) => [n.name])
    expect(allNames).not.toContain('_archived')
    expect(allNames).not.toContain('_internal')
  })

  it('忽略 `.` 前缀隐藏文件(`.archived`、`.DS_Store`)', () => {
    const svc = makeService()
    const reqId = 'req-012-dot'
    makeReqDir(reqId)
    writeFileSync(join(realRoot, 'requirements', reqId, '.archived'), '')
    writeFileSync(join(realRoot, 'requirements', reqId, '.DS_Store'), '')

    const tree = svc.list(reqId)
    expect(tree.map((n) => n.name)).not.toContain('.archived')
    expect(tree.map((n) => n.name)).not.toContain('.DS_Store')
  })

  it('reqDir 不存在 → 返回 []', () => {
    const svc = makeService()
    expect(svc.list('req-not-found')).toEqual([])
  })
})

// ============================================================================
// resolveAssetFile() —— 路径安全(API 用)
// ============================================================================

describe('RequirementService.resolveAssetFile —— 路径安全', () => {
  it('合法文件名返回 absPath + mime + size', () => {
    const svc = makeService()
    const reqId = 'req-013-safe'
    makeReqDir(reqId)
    svc.landAssets(reqId, [makePngImage('prd-1')])

    const resolved = svc.resolveAssetFile(reqId, 'prd-1.png')
    expect(resolved).not.toBeNull()
    expect(resolved!.mime).toBe('image/png')
    expect(resolved!.size).toBe(68)
    expect(resolved!.absPath).toBe(svc.assetPath(reqId, 'prd-1.png'))
  })

  it('拒绝 path traversal:`../meta.yaml` 形式 → null', () => {
    const svc = makeService()
    const reqId = 'req-014-traversal'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'meta.yaml'),
      'id: secret',
      'utf8',
    )
    expect(svc.resolveAssetFile(reqId, '../meta.yaml')).toBeNull()
  })

  it('拒绝含正斜杠的分隔符穿越 `sub/prd-1.png` → null', () => {
    const svc = makeService()
    const reqId = 'req-015-slash'
    makeReqDir(reqId)
    expect(svc.resolveAssetFile(reqId, 'sub/prd-1.png')).toBeNull()
  })

  it('拒绝反斜杠穿越 `..\\meta.yaml` → null', () => {
    const svc = makeService()
    const reqId = 'req-016-backslash'
    makeReqDir(reqId)
    expect(svc.resolveAssetFile(reqId, '..\\meta.yaml')).toBeNull()
  })

  it('拒绝 NUL byte → null', () => {
    const svc = makeService()
    const reqId = 'req-017-nul'
    makeReqDir(reqId)
    expect(svc.resolveAssetFile(reqId, 'prd-1.png\0.bak')).toBeNull()
  })

  it('文件不存在(合法名字但未落盘)→ null', () => {
    const svc = makeService()
    const reqId = 'req-018-missing'
    makeReqDir(reqId)
    expect(svc.resolveAssetFile(reqId, 'prd-99.png')).toBeNull()
  })

  it('assets path 命中目录本身(已存在但非文件)→ null', () => {
    const svc = makeService()
    const reqId = 'req-019-dir'
    makeReqDir(reqId)
    // 用 mkdirSync 造同名目录让 isFile()=false
    const { mkdirSync: mkdir } = require('node:fs')
    mkdir(join(realRoot, 'requirements', reqId, 'assets', 'is-a-dir'), {
      recursive: true,
    })
    expect(svc.resolveAssetFile(reqId, 'is-a-dir')).toBeNull()
  })
})

// ============================================================================
// 端到端 fixture:parseUpload → landAssets → get(reqId).assets
// ============================================================================

describe('RequirementService 端到端:ticket 01 docx → ticket 02 assets 落地', () => {
  it('sample-prd.docx 含 1 PNG → landAssets → get(reqId).assets 有 1 条', async () => {
    const svc = makeService()
    const reqId = 'req-020-e2e'
    makeReqDir(reqId)

    const docx = readFileSync(SAMPLE_DOCX)
    const parsed = await svc.parseUpload(docx, 'sample-prd.docx')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // 1. markdown 含 data URI
    expect(parsed.markdown).toContain('data:image/png;base64,')
    expect(parsed.images).toHaveLength(1)
    expect(parsed.images[0].mime).toBe('image/png')

    // 2. landAssets 落盘
    const landed = svc.landAssets(reqId, parsed.images)
    expect(landed).toHaveLength(1)
    expect(landed[0].name).toBe('prd-1.png')

    // 3. replaceDataUriWithAssetPath 重写 markdown
    const rewritten = svc.replaceDataUriWithAssetPath(reqId, parsed.markdown)
    expect(rewritten).toContain('![](assets/prd-1.png)')
    expect(rewritten).not.toContain('data:image/')

    // 4. get(reqId).assets 含 1 条
    const detail = svc.get(reqId)
    expect(detail).not.toBeNull()
    expect(detail!.assets).toHaveLength(1)
    expect(detail!.assets[0].name).toBe('prd-1.png')
  })
})

// ============================================================================
// HTTP 路由测试
// ============================================================================

interface TestHarness {
  app: FastifyInstance
  token: string
  service: RequirementService
}

async function buildHarness(): Promise<TestHarness> {
  const tm = new TokenManager(realRoot)
  const token = await tm.ensure()
  const service = new RequirementService({
    root: realRoot,
    git: gitMainOnly(),
    sleep: noSleep,
  })
  const hub = createSseHub()
  const app = Fastify({ logger: false })
  await app.register(authPlugin, {
    tokenManager: tm,
    allowedOrigins: [],
  })
  await app.register(requirementRoutes, { requirementService: service, sseHub: hub })
  return { app, token, service }
}

describe('路由 GET /api/requirement/:id/assets/:filename', () => {
  it('合法文件 → 200 + 正确 Content-Type + 字节数一致', async () => {
    const reqId = 'req-021-http'
    makeReqDir(reqId)
    const { app, token, service } = await buildHarness()
    try {
      service.landAssets(reqId, [makePngImage('prd-1')])
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/${reqId}/assets/prd-1.png`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('image/png')
      expect(res.headers['content-length']).toBe('68')
      const buf = res.rawPayload ? Buffer.from(res.rawPayload) : res.body
      const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as string)
      expect(payload.length).toBe(68)
    } finally {
      await app.close()
    }
  })

  it('路径穿越 `../meta.yaml` → 404(不泄漏文件)', async () => {
    const { app, token } = await buildHarness()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/req-022-traversal/assets/${encodeURIComponent('../meta.yaml')}`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBe('E_ASSET_NOT_FOUND')
      expect(JSON.stringify(body)).not.toContain('id: ')
    } finally {
      await app.close()
    }
  })

  it('反斜杠穿越 → 404', async () => {
    const { app, token } = await buildHarness()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/req-023/assets/${encodeURIComponent('..\\meta.yaml')}`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('不存在的合法文件名 → 404', async () => {
    const { app, token } = await buildHarness()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/req-024/assets/prd-99.png`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('NUL byte 形式合法但 raw URL 含 %00 → 404', async () => {
    const { app, token } = await buildHarness()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/req-025/assets/${encodeURIComponent('prd-1.png\0.bak')}`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('路由 GET /api/requirement/:id —— service.get(reqId) 透传', () => {
  it('不存在的 id → 404 + E_REQUIREMENT_NOT_FOUND', async () => {
    const { app, token } = await buildHarness()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/req-026-missing`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({
        error: 'E_REQUIREMENT_NOT_FOUND',
        requirementId: 'req-026-missing',
      })
    } finally {
      await app.close()
    }
  })

  it('已落地 + 落 assets → 200 + 含 requirementMarkdown + assets[].url', async () => {
    const reqId = 'req-027-detail'
    makeReqDir(reqId)
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'requirement.md'),
      '# Hi\n',
      'utf8',
    )
    writeFileSync(
      join(realRoot, 'requirements', reqId, 'meta.yaml'),
      'id: req-027-detail\ntitle: 详情\ncreatedAt: 2026-07-19T00:00:00Z\n',
      'utf8',
    )
    const { app, token, service } = await buildHarness()
    try {
      service.landAssets(reqId, [makePngImage('prd-1')])
      const res = await app.inject({
        method: 'GET',
        url: `/api/requirement/${reqId}`,
        headers: { 'x-aidevspace-token': token },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.id).toBe(reqId)
      expect(body.title).toBe('详情')
      expect(body.requirementMarkdown).toContain('# Hi')
      expect(body.assets).toHaveLength(1)
      expect(body.assets[0]).toMatchObject({
        name: 'prd-1.png',
        url: `/api/requirement/${reqId}/assets/prd-1.png`,
        mime: 'image/png',
        size: 68,
      })
    } finally {
      await app.close()
    }
  })
})

// ============================================================================
// helpers
// ============================================================================

function makeReqDir(reqId: string): void {
  require('node:fs').mkdirSync(
    join(realRoot, 'requirements', reqId),
    { recursive: true },
  )
  // 写入最小 meta.yaml 让 service.get(reqId) 走通
  writeFileSync(
    join(realRoot, 'requirements', reqId, 'meta.yaml'),
    `id: ${reqId}\ntitle: ${reqId}\ncreatedAt: 2026-07-19T00:00:00Z\n`,
    'utf8',
  )
}
