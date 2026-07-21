/**
 * analyzing-data-fields.test.ts —— ticket 01 验收(SSR D5)
 *
 * ADR-0017 D5 · `getAnalyzingData()` 注入 prdMarkdown / auxFiles / assetList
 *
 * 覆盖:
 * 1. 注入三个字段(从 fs 读取)
 * 2. aux 目录不存在 → auxFiles = []
 * 3. requirement.md 不存在 → prdMarkdown = ''
 * 4. assetList 解析:孤儿 asset 忽略 / 引用了不存在的 asset 静默忽略
 * 5. asset 字段对齐 AssetMeta(name/url/path/size/mime)
 * 6. auxFiles 按 usage_tag 排序
 * 7. REFUND_ANALYZING mock 包含三个字段(向后兼容)
 * 8. emptyAnalyzing 包含三个字段
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'
import { getAnalyzingData } from '@/lib/analyzing.server'

// ============================================================================
// loadAnalyzingDocs — SSR 装载(走 getAnalyzingData → 内部 loadAnalyzingDocs)
// ============================================================================

describe('getAnalyzingData · SSR 注入 prdMarkdown / auxFiles / assetList(ADR-0017 D5)', () => {
  let requirementsRoot: string

  beforeEach(() => {
    requirementsRoot = mkdtempSync(join(tmpdir(), 'analyzing-ssr-'))
    // 模拟 requirementsRoot + requirements/<id>/
    mkdirSync(join(requirementsRoot, 'requirements'), { recursive: true })
  })

  afterEach(() => {
    rmSync(requirementsRoot, { recursive: true, force: true })
  })

  /** 写入 reqDir 必备三件套:requirement.md + assets/ + 可选 aux/ */
  function makeReqDir(reqId: string): string {
    const reqDir = join(requirementsRoot, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    return reqDir
  }

  it('PRD + aux + assets 齐备 → 三字段全部正确', async () => {
    const reqDir = makeReqDir('req-with-docs')
    writeFileSync(
      join(reqDir, 'requirement.md'),
      [
        '# 退款功能优化',
        '',
        '退款单笔金额 ≤ 1000 元。',
        '',
        '![退款流程](assets/refund-flow.png)',
        '',
        '退款审核流:自动。',
      ].join('\n'),
    )
    // aux/<id>/<file>.md layout
    const auxApi = join(reqDir, 'aux', 'aux-api-refund')
    mkdirSync(auxApi, { recursive: true })
    writeFileSync(join(auxApi, 'meta.yaml'), 'usage_tag: api\n')
    writeFileSync(join(auxApi, 'api-refund.md'), '# API doc')
    // assets/
    mkdirSync(join(reqDir, 'assets'), { recursive: true })
    writeFileSync(join(reqDir, 'assets', 'refund-flow.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const data = await getAnalyzingData('req-with-docs', { requirementsRoot })
    expect(data.prdMarkdown).toContain('# 退款功能优化')
    expect(data.prdMarkdown).toContain('![退款流程](assets/refund-flow.png)')
    expect(data.auxFiles).toHaveLength(1)
    expect(data.auxFiles[0]).toMatchObject({
      id: 'aux-api-refund',
      filename: 'api-refund.md',
      usage_tag: 'api',
    })
    expect(data.assetList).toHaveLength(1)
    expect(data.assetList[0]).toMatchObject({
      name: 'refund-flow.png',
      mime: 'image/png',
    })
    expect(data.assetList[0].url).toContain('/api/requirement/req-with-docs/assets/refund-flow.png')
  })

  it('aux 目录不存在 → auxFiles = [],不报错', async () => {
    const reqDir = makeReqDir('req-no-aux')
    writeFileSync(join(reqDir, 'requirement.md'), '# Hello')
    const data = await getAnalyzingData('req-no-aux', { requirementsRoot })
    expect(data.prdMarkdown).toBe('# Hello')
    expect(data.auxFiles).toEqual([])
    expect(data.assetList).toEqual([])
  })

  it('requirement.md 不存在 → prdMarkdown 是空字符串,容错', async () => {
    const reqDir = makeReqDir('req-no-md')
    // 不写 requirement.md,只建空目录
    const data = await getAnalyzingData('req-no-md', { requirementsRoot })
    expect(data.prdMarkdown).toBe('')
    expect(data.auxFiles).toEqual([])
    expect(data.assetList).toEqual([])
  })

  it('assets/ 不存在 → assetList = []', async () => {
    const reqDir = makeReqDir('req-no-assets')
    writeFileSync(
      join(reqDir, 'requirement.md'),
      '# PRD\n\n![x](assets/x.png)\n',
    )
    const data = await getAnalyzingData('req-no-assets', { requirementsRoot })
    expect(data.assetList).toEqual([])
    expect(data.prdMarkdown).toContain('![x](assets/x.png)')
  })

  it('assetList 解析:孤儿 asset(磁盘有但 PRD 未引用)→ 不出现', async () => {
    const reqDir = makeReqDir('req-orphan')
    writeFileSync(join(reqDir, 'requirement.md'), '# PRD\n\n没有图片\n')
    mkdirSync(join(reqDir, 'assets'), { recursive: true })
    writeFileSync(join(reqDir, 'assets', 'orphan.png'), Buffer.from([0x89, 0x50]))
    writeFileSync(join(reqDir, 'assets', 'referenced.png'), Buffer.from([0x89, 0x50]))

    const data = await getAnalyzingData('req-orphan', { requirementsRoot })
    expect(data.assetList.map((a) => a.name)).toEqual([])
  })

  it('assetList 解析:PRD 引用了不存在的 asset → 静默忽略,不报错', async () => {
    const reqDir = makeReqDir('req-missing-asset')
    writeFileSync(
      join(reqDir, 'requirement.md'),
      '# PRD\n\n![x](assets/does-not-exist.png)\n![y](assets/real.png)\n',
    )
    mkdirSync(join(reqDir, 'assets'), { recursive: true })
    writeFileSync(join(reqDir, 'assets', 'real.png'), Buffer.from([0x89, 0x50]))

    const data = await getAnalyzingData('req-missing-asset', { requirementsRoot })
    expect(data.assetList).toHaveLength(1)
    expect(data.assetList[0].name).toBe('real.png')
  })

  it('AssetMeta 字段齐备:name / url / path / size / mime', async () => {
    const reqDir = makeReqDir('req-asset-fields')
    const pngBody = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    writeFileSync(join(reqDir, 'requirement.md'), '![x](assets/test.png)')
    mkdirSync(join(reqDir, 'assets'), { recursive: true })
    writeFileSync(join(reqDir, 'assets', 'test.png'), pngBody)

    const data = await getAnalyzingData('req-asset-fields', { requirementsRoot })
    expect(data.assetList).toHaveLength(1)
    const a = data.assetList[0]
    expect(a.name).toBe('test.png')
    expect(a.url).toBe('/api/requirement/req-asset-fields/assets/test.png')
    expect(a.path).toBe('requirements/req-asset-fields/assets/test.png')
    expect(a.size).toBe(pngBody.length)
    expect(a.mime).toBe('image/png')
  })

  it('AssetMeta:url/path 对 requirementId 做 URI 编码(中文 id 鲁棒)', async () => {
    const reqDir = makeReqDir('req-002-运力结算')
    writeFileSync(join(reqDir, 'requirement.md'), '![x](assets/refund-flow.png)')
    mkdirSync(join(reqDir, 'assets'), { recursive: true })
    writeFileSync(join(reqDir, 'assets', 'refund-flow.png'), Buffer.from([0x89, 0x50]))

    const data = await getAnalyzingData('req-002-运力结算', { requirementsRoot })
    expect(data.assetList).toHaveLength(1)
    expect(data.assetList[0].name).toBe('refund-flow.png')
    expect(data.assetList[0].url).toContain('req-002-%E8%BF%90%E5%8A%9B%E7%BB%93%E7%AE%97')
    expect(data.assetList[0].url).toContain('refund-flow.png')
  })

  it('auxFiles 按 usage_tag 排序(api → data → ... → other)', async () => {
    const reqDir = makeReqDir('req-aux-sort')
    const make = (id: string, file: string, tag: string) => {
      const dir = join(reqDir, 'aux', id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'meta.yaml'), `usage_tag: ${tag}\n`)
      writeFileSync(join(dir, file), 'body')
    }
    // 按字母顺序插入,期望按 tag 顺序输出
    make('z-other', 'z.md', 'other')
    make('a-data', 'a.md', 'data')
    make('m-api', 'm.md', 'api')
    make('b-api', 'b.md', 'api') // 同 tag 内按 filename 字典序

    writeFileSync(join(reqDir, 'requirement.md'), '# PRD')

    const data = await getAnalyzingData('req-aux-sort', { requirementsRoot })
    expect(data.auxFiles.map((f) => f.id)).toEqual([
      'b-api',
      'm-api',
      'a-data',
      'z-other',
    ])
  })

  it('auxFiles:子目录缺 meta.yaml → usage_tag 落到 "other",不报错', async () => {
    const reqDir = makeReqDir('req-aux-no-meta')
    const dir = join(reqDir, 'aux', 'no-meta-aux')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'doc.md'), 'body')
    writeFileSync(join(reqDir, 'requirement.md'), '# PRD')

    const data = await getAnalyzingData('req-aux-no-meta', { requirementsRoot })
    expect(data.auxFiles).toHaveLength(1)
    expect(data.auxFiles[0]).toMatchObject({ id: 'no-meta-aux', usage_tag: 'other' })
  })

  it('auxFiles:子目录无 .md 文件 → 跳过该子目录', async () => {
    const reqDir = makeReqDir('req-aux-no-md')
    const dir = join(reqDir, 'aux', 'no-md-aux')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.yaml'), 'usage_tag: api\n')
    // 没有 .md 文件
    writeFileSync(join(reqDir, 'requirement.md'), '# PRD')

    const data = await getAnalyzingData('req-aux-no-md', { requirementsRoot })
    expect(data.auxFiles).toEqual([])
  })

  it('requirementsRoot 不存在 → prdMarkdown 是 "" / auxFiles = [] / assetList = []', async () => {
    const data = await getAnalyzingData('req-nonexistent', {
      requirementsRoot: '/nonexistent/path/that/should/not/exist',
    })
    expect(data.prdMarkdown).toBe('')
    expect(data.auxFiles).toEqual([])
    expect(data.assetList).toEqual([])
  })
})

// ============================================================================
// REFUND_ANALYZING mock —— 向后兼容(issue 19a/19b 既有测试对 RAF 不破坏)
// ============================================================================

describe('REFUND_ANALYZING mock · 含 D5 三字段', () => {
  it('req-001 mock 返回值含 prdMarkdown / auxFiles / assetList', async () => {
    const data = await getAnalyzingData('req-001')
    expect(typeof data.prdMarkdown).toBe('string')
    expect(data.prdMarkdown.length).toBeGreaterThan(0)
    expect(Array.isArray(data.auxFiles)).toBe(true)
    expect(data.auxFiles.length).toBeGreaterThan(0)
    expect(Array.isArray(data.assetList)).toBe(true)
    expect(data.assetList.length).toBeGreaterThan(0)
  })

  it('mock auxFiles 包含代表性 api 类 + 字段对齐 AuxFile', async () => {
    const data = await getAnalyzingData('req-001')
    const api = data.auxFiles.find((f) => f.usage_tag === 'api')
    expect(api).toBeDefined()
    expect(api).toHaveProperty('id')
    expect(api).toHaveProperty('filename')
    expect(api).toHaveProperty('body')
    expect(api).toHaveProperty('source_format', 'md')
    expect(api).toHaveProperty('converted_to_md', false)
  })

  it('mock assetList 字段对齐 AssetMeta', async () => {
    const data = await getAnalyzingData('req-001')
    const a = data.assetList[0]
    expect(a).toHaveProperty('name')
    expect(a).toHaveProperty('url')
    expect(a).toHaveProperty('path')
    expect(a).toHaveProperty('size')
    expect(a).toHaveProperty('mime')
    expect(a.url).toMatch(/^\/api\/requirement\/[^/]+\/assets\/[^/]+$/)
  })
})

// ============================================================================
// emptyAnalyzing —— 含 D5 三字段默认值
// ============================================================================

describe('emptyAnalyzing · D5 三字段默认值', () => {
  it('returns prdMarkdown = "" / auxFiles = [] / assetList = []', () => {
    const data = emptyAnalyzing('NEW-REQ')
    expect(data.prdMarkdown).toBe('')
    expect(data.auxFiles).toEqual([])
    expect(data.assetList).toEqual([])
  })

  it('未知 id → getAnalyzingData 返回含默认值的三字段', async () => {
    const data = await getAnalyzingData('UNKNOWN-NO-FS-CONTACT')
    expect(data.prdMarkdown).toBeDefined()
    expect(data.auxFiles).toBeDefined()
    expect(data.assetList).toBeDefined()
    // 类型签名满足即可,真实值由 fs 决定(可能是空字符串 / 空数组)
    expect(typeof data.prdMarkdown).toBe('string')
    expect(Array.isArray(data.auxFiles)).toBe(true)
    expect(Array.isArray(data.assetList)).toBe(true)
  })
})

// ============================================================================
// 类型契约 —— AnalyzingData 含三字段(compile-time + runtime shape check)
// ============================================================================

describe('AnalyzingData · D5 三字段形状契约', () => {
  it('pick 验证:三字段必须是 prdMarkdown: string / auxFiles: AuxFile[] / assetList: Asset[]', () => {
    const slice: Pick<AnalyzingData, 'prdMarkdown' | 'auxFiles' | 'assetList'> = {
      prdMarkdown: '',
      auxFiles: [],
      assetList: [],
    }
    expect(typeof slice.prdMarkdown).toBe('string')
    expect(Array.isArray(slice.auxFiles)).toBe(true)
    expect(Array.isArray(slice.assetList)).toBe(true)
  })
})
