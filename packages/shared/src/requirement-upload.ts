import { z } from 'zod'

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

// ============================================================================
// ticket 02 (ADR-0015 D5) —— `assets/` 落地相关:images / asset metadata /
// 资源树节点 / mime ↔ ext 互转。
// 与 apps/agent RequirementService.landAssets / RequirementService.get /
// apps/web MarkdownPreview 共用契约。
// ============================================================================

/**
 * ticket 02 —— 单张落地资产条目。
 *
 * 形状锁定原因(ADR-0015 D5):
 * - `name` 不含路径前缀(`prd-1.png`,不是 `assets/prd-1.png`),因为 markdown
 *   里的相对路径解析由 MarkdownPreview 自己负责拼接。
 * - `url` 是 agent 端相对路径(`/api/requirement/<id>/assets/<name>`),
 *   前端 fetcher 自行追加 agent base。
 * - `path` 给 agent 内部消费(写盘 / 资源树扫描),与 `url` 不同源。
 * - `size` 是字节数(写盘后 stat 出来),`mime` 与解析时一致。
 *
 * 字段冻结规则:这个 schema 是 ticket 02 的契约,前端 MarkdownPreview 与
 * 后端 ResourceTree 都依赖 `name` / `url` / `size` / `mime` 四个字段;
 * 任何新增字段需向后兼容(前端允许 `AssetMeta` 含未知字段)。
 */
export const AssetMetaSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1),
})
export type AssetMeta = z.infer<typeof AssetMetaSchema>

/**
 * 把 `image/<subtype>` mime 映射到文件扩展名(无 `.` 前缀)。
 *
 * Mammoth 主要输出 png / jpeg / gif;svg / webp 是 docx 公式 / 形状可能
 * 出现的扩展,保留兼容。未知 mime 默认 `bin` —— 调用方应在 `validateUpload`
 * 阶段把陌生 mime 拦在进栈前。
 */
const IMAGE_MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/tiff': 'tiff',
}

export function imageMimeToExtension(mime: string): string {
  return IMAGE_MIME_TO_EXT[mime.toLowerCase()] ?? 'bin'
}

/** 反向:扩展名 → mime(用于 GET 资源时的 Content-Type 推断)。 */
const EXT_TO_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
}

export function extensionToImageMime(extension: string): string {
  const key = extension.toLowerCase().replace(/^\./, '')
  return EXT_TO_IMAGE_MIME[key] ?? 'application/octet-stream'
}

/**
 * 资源树节点(扁平,带可选 children)。
 *
 * 服务端 `RequirementService.list(reqId)` 返回,N 为层级深度 ≤ 2
 * (顶层目录 + 子文件)。`_` 前缀目录排除(沿用既有 `_archived/` 约定,
 * ADR-0015 D5);`assets/` 由于不带下划线因此纳入。
 */
export type ResourceTreeNode = z.infer<typeof ResourceTreeNodeSchema>
interface ResourceTreeNodeShape {
  name: string
  path: string
  type: 'directory' | 'file'
  children?: ResourceTreeNodeShape[]
}
export const ResourceTreeNodeSchema: z.ZodType<ResourceTreeNodeShape> = z.object({
  name: z.string().min(1),
  /** 相对 reqDir 路径(目录不带 `/`,顶层节点 `name === path`) */
  path: z.string().min(1),
  type: z.enum(['directory', 'file']),
  children: z.array(z.lazy(() => ResourceTreeNodeSchema)).optional(),
})
