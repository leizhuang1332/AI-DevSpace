import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { RequirementService } from '../services/RequirementService.js'

function createService(): RequirementService {
  return new RequirementService({ root: '/unused', git: vi.fn() })
}

describe('RequirementService.parseUpload', () => {
  it.each([
    ['prd.md', '# 标题\n\n正文'],
    ['prd.txt', '标题\n正文'],
  ])('将 %s Buffer 原样解析为 UTF-8 文本且不返回图片', async (filename, content) => {
    const result = await createService().parseUpload(Buffer.from(content, 'utf8'), filename)

    expect(result).toEqual({ ok: true, markdown: content, images: [] })
  })

  it('解析真实 DOCX 为 Markdown 并按出现顺序抽取图片', async () => {
    const buffer = readFileSync(
      new URL('../../test/fixtures/sample-prd.docx', import.meta.url),
    )

    const result = await createService().parseUpload(buffer, 'sample-prd.docx')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('# 标题')
    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toMatchObject({ name: 'prd-1', mime: 'image/png' })
    expect(Buffer.from(result.images[0].base64, 'base64')).toHaveLength(69)
  })

  it('解析无图片 DOCX 时返回空图片列表', async () => {
    const buffer = readFileSync(
      new URL('../../test/fixtures/sample-prd-no-image.docx', import.meta.url),
    )

    const result = await createService().parseUpload(buffer, 'sample-prd-no-image.docx')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain('# 标题')
    expect(result.images).toEqual([])
  })

  it('加密 DOCX 解析失败时不向上抛错', async () => {
    const buffer = readFileSync(
      new URL('../../test/fixtures/encrypted-prd.docx', import.meta.url),
    )

    const result = await createService().parseUpload(buffer, 'encrypted-prd.docx')

    expect(result).toMatchObject({ ok: false, reason: 'parse-error' })
    if (result.ok) return
    expect(result.message.length).toBeGreaterThan(0)
  })
})

describe('RequirementService.validateUpload', () => {
  it.each([
    {
      filename: 'prd.md',
      mime: 'text/markdown',
      buffer: Buffer.from('# 标题'),
    },
    {
      filename: 'prd.txt',
      mime: 'text/plain',
      buffer: Buffer.from('标题'),
    },
    {
      filename: 'sample-prd.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync(new URL('../../test/fixtures/sample-prd.docx', import.meta.url)),
    },
    {
      filename: 'sample-prd-no-image.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync(
        new URL('../../test/fixtures/sample-prd-no-image.docx', import.meta.url),
      ),
    },
  ])('接受合法上传 $filename', async ({ buffer, filename, mime }) => {
    await expect(
      createService().validateUpload(buffer, filename, mime),
    ).resolves.toEqual({ ok: true })
  })

  it.each(['prd.rar', 'prd.exe'])('拒绝不支持的文件扩展名 %s', async (filename) => {
    const result = await createService().validateUpload(
      Buffer.from('content'),
      filename,
      'application/octet-stream',
    )

    expect(result).toMatchObject({ ok: false, reason: 'ext' })
  })

  it('拒绝不在白名单内的 MIME', async () => {
    const result = await createService().validateUpload(
      Buffer.from('# 标题'),
      'prd.md',
      'application/octet-stream',
    )

    expect(result).toMatchObject({ ok: false, reason: 'mime' })
  })

  it('拒绝 magic bytes 不是 ZIP 头的 DOCX', async () => {
    const result = await createService().validateUpload(
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
      'prd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    expect(result).toMatchObject({ ok: false, reason: 'magic' })
  })

  it('接受大小恰好为 10 MB 的文本文件', async () => {
    await expect(
      createService().validateUpload(
        Buffer.alloc(10 * 1024 * 1024),
        'prd.txt',
        'text/plain',
      ),
    ).resolves.toEqual({ ok: true })
  })

  it('拒绝超过 10 MB 的文件', async () => {
    const result = await createService().validateUpload(
      Buffer.alloc(10 * 1024 * 1024 + 1),
      'prd.txt',
      'text/plain',
    )

    expect(result).toMatchObject({ ok: false, reason: 'size' })
  })

  it('将伪装成 DOCX 的普通 ZIP 解析失败收敛为 parse-error', async () => {
    const result = await createService().validateUpload(
      readFileSync(new URL('../../test/fixtures/not-a-docx.zip', import.meta.url)),
      'prd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    expect(result).toMatchObject({ ok: false, reason: 'parse-error' })
  })

  it('拒绝加密 DOCX 且返回 parse-error', async () => {
    const result = await createService().validateUpload(
      readFileSync(new URL('../../test/fixtures/encrypted-prd.docx', import.meta.url)),
      'encrypted-prd.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    expect(result).toMatchObject({ ok: false, reason: 'parse-error' })
  })

  it('拒绝任一解码后超过 2 MB 的内嵌图片', async () => {
    const buffer = readFileSync(
      new URL('../../test/fixtures/oversized-image.docx', import.meta.url),
    )
    const result = await createService().validateUpload(
      buffer,
      'oversized-image.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    expect(result).toMatchObject({ ok: false, reason: 'image-too-large' })
  })
})
