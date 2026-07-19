import {
  MAX_UPLOAD_BYTES,
  UPLOAD_VALIDATION_MESSAGES,
  getUploadExtension,
  hasDocxMagic,
  isSupportedUploadExtension,
  isSupportedUploadMime,
  type UploadValidationResult as SharedUploadValidationResult,
} from '@ai-devspace/shared'

export type UploadValidationResult = SharedUploadValidationResult

export async function validateUpload(file: File): Promise<UploadValidationResult> {
  const extension = getUploadExtension(file.name)
  if (!isSupportedUploadExtension(extension)) {
    return {
      ok: false,
      reason: 'ext',
      message: UPLOAD_VALIDATION_MESSAGES.ext,
    }
  }

  if (!isSupportedUploadMime(file.type)) {
    return {
      ok: false,
      reason: 'mime',
      message: UPLOAD_VALIDATION_MESSAGES.mime,
    }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: 'size',
      message: UPLOAD_VALIDATION_MESSAGES.size,
    }
  }

  if (extension === '.docx' && !hasDocxMagic(await readBytes(file.slice(0, 4)))) {
    return {
      ok: false,
      reason: 'magic',
      message: UPLOAD_VALIDATION_MESSAGES.magic,
    }
  }

  return { ok: true }
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
}
