export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_UPLOAD_IMAGE_BYTES = 2 * 1024 * 1024

export const SUPPORTED_UPLOAD_EXTENSIONS = ['.md', '.txt', '.docx'] as const
export const SUPPORTED_UPLOAD_MIME_TYPES = [
  'text/markdown',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export const UPLOAD_VALIDATION_MESSAGES = {
  ext: '仅支持 .md、.txt 和 .docx 文件',
  mime: '文件 MIME 类型与支持格式不符',
  magic: '.docx 文件头无效',
  size: '文件大小不能超过 10 MB',
  imageTooLarge: '单张图片大小不能超过 2 MB',
} as const

export type UploadValidationReason =
  | 'ext'
  | 'mime'
  | 'magic'
  | 'size'
  | 'image-too-large'

export type UploadValidationResult<
  TReason extends string = UploadValidationReason,
> =
  | { ok: true }
  | { ok: false; reason: TReason; message?: string }

export function getUploadExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.')
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase()
}

export function isSupportedUploadExtension(extension: string): boolean {
  return SUPPORTED_UPLOAD_EXTENSIONS.some((candidate) => candidate === extension)
}

export function isSupportedUploadMime(mime: string): boolean {
  return SUPPORTED_UPLOAD_MIME_TYPES.some((candidate) => candidate === mime)
}

export function hasDocxMagic(bytes: ArrayLike<number>): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}
