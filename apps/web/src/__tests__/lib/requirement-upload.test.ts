import { describe, expect, it } from 'vitest'
import { validateUpload } from '@/lib/requirement-upload'

describe('validateUpload', () => {
  it.each([
    ['prd.md', 'text/markdown', '# 标题'],
    ['prd.txt', 'text/plain', '标题'],
  ])('接受受支持的文本文件 %s', async (name, type, content) => {
    const file = new File([content], name, { type })

    await expect(validateUpload(file)).resolves.toEqual({ ok: true })
  })

  it.each(['sample-with-image.docx', 'sample-without-image.docx'])(
    '接受带 ZIP magic bytes 的 DOCX %s',
    async (name) => {
      const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })

      await expect(validateUpload(file)).resolves.toEqual({ ok: true })
    },
  )

  it.each(['prd.rar', 'prd.exe'])('拒绝不支持的文件扩展名 %s', async (name) => {
    const file = new File(['content'], name, { type: 'application/octet-stream' })

    await expect(validateUpload(file)).resolves.toEqual({
      ok: false,
      reason: 'ext',
      message: '仅支持 .md、.txt 和 .docx 文件',
    })
  })

  it('拒绝不在白名单内的 MIME', async () => {
    const file = new File(['# 标题'], 'prd.md', { type: 'application/octet-stream' })

    await expect(validateUpload(file)).resolves.toEqual({
      ok: false,
      reason: 'mime',
      message: '文件 MIME 类型与支持格式不符',
    })
  })

  it('接受大小恰好为 10 MB 的文件', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024)], 'prd.txt', {
      type: 'text/plain',
    })

    await expect(validateUpload(file)).resolves.toEqual({ ok: true })
  })

  it('拒绝超过 10 MB 的文件', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'prd.txt', {
      type: 'text/plain',
    })

    await expect(validateUpload(file)).resolves.toEqual({
      ok: false,
      reason: 'size',
      message: '文件大小不能超过 10 MB',
    })
  })

  it('拒绝 magic bytes 不是 ZIP 头的 .docx', async () => {
    const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'prd.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await expect(validateUpload(file)).resolves.toEqual({
      ok: false,
      reason: 'magic',
      message: '.docx 文件头无效',
    })
  })
})
