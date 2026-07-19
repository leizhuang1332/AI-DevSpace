import {
  MAX_UPLOAD_BYTES,
  UPLOAD_VALIDATION_MESSAGES,
  getUploadExtension,
  hasDocxMagic,
  isSupportedUploadExtension,
  isSupportedUploadMime,
  type AssetMeta,
  type ParseUploadResponse,
  type UploadFailReason,
  type UploadReplaceResponse,
  type UploadValidationResult as SharedUploadValidationResult,
} from '@ai-devspace/shared'
import { agentFetch, AgentError } from './agent-client'

export type UploadValidationResult = SharedUploadValidationResult

/**
 * ticket 01 —— 前端闸门 `validateUpload(file)`
 *
 * Z3 闸门:ext ∩ MIME ∩ magic(.docx)∩ size ≤ 10 MB。
 * 图片字节检查不进前端(前端看不到 base64),由 `parseUpload()` 服务端兜。
 *
 * 命中任一拒绝条件 → 返回 `{ok:false, reason, message?}`,调用方显示顶部红条;
 * 全部通过 → `{ok:true}`,调用方可以继续走 `parseUpload()`。
 *
 * 重导出到前端两处入口共用:
 * - `parseForDialog(file)` —— Dialog 选完文件 → 仅解析 → 预填 textarea
 * - `uploadAndReplace(reqId, file)` —— DRAFTING 选完文件 → 解析 + 覆盖 requirement.md
 */
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

// ============================================================================
// ticket 03 (ADR-0015 D3 / D6 / D8) —— 双入口 UI 共用上层 API
//
// 两处入口共用同一组 Z3 闸门 + 服务端解析管道,语义差异在 ticket 03 已锁定:
// - Dialog 预填:`parseForDialog(file)` 仅解析 → 返回 markdown 给前端 textarea,**不写盘**
// - DRAFTING 覆盖:`uploadAndReplace(reqId, file)` 解析 + 写盘 + 落 assets/(W4)
//
// 实现方式:前端先把 File 转 base64 → POST JSON 到 agent 端。
// 不引入 @fastify/multipart 是为了避免 native binding + 复杂配置,base64 上限
// 13.3 MB 在 10 MB 文件上限下没有边界风险(由 agent Fastify bodyLimit 守门)。
// ============================================================================

/** 闸门失败 / 服务端闸门或解析失败时的统一错误形态(给 UI 显示红条用) */
export type UploadActionResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; reason: UploadFailReason; message: string }

/**
 * ADR-0015 D6 顶部红条统一文案(锁定,前后端共用的语义)。
 *
 * ticket 03 验收要求 Dialog / DRAFTING 闸门失败时**都用这一句**(不暴露具体 reason):
 *
 * > ⚠️ 无法解析此文件(可能加密或格式不兼容 / 超过大小上限 / 包含过大图片)。
 * > 下方空白,你可以继续粘贴文本,或者换一份文件再试。
 *
 * **为什么放在 lib 而不是组件里**:ticket 03 涉及两个 UI 入口(Dialog / DRAFTING),
 * 红条文案在两处都展示 —— 把"reason → 文字"映射放 lib 一次性,组件只读 `result.message`
 * 即可。`humanizeUploadFailReason` 是公开 API,组件可以直接用。
 */
export const UNIFIED_BANNER_MESSAGE =
  '无法解析此文件(可能加密或格式不兼容 / 超过大小上限 / 包含过大图片)。下方空白,你可以继续粘贴文本,或者换一份文件再试。'

/** `requirement-not-found` 不在 D6 文案里;给一个独立提示,避免让用户重试同一个已删的 req */
const REQUIREMENT_GONE_MESSAGE = '该需求已不存在,刷新页面后重试。'
/** 客户端网络错也不走 D6 文案(用户更应该知道是网络问题而非文件问题) */
const NETWORK_MESSAGE = '网络异常,无法连接 agent。请稍后重试。'

/**
 * 公开 API:把 reason 映射成 UI 文案。
 *
 * 锁定 ADR-0015 D6 顶部红条:任何**文件问题**(ext/mime/magic/size/
 * image-too-large/parse-error)都用 `UNIFIED_BANNER_MESSAGE`,不暴露具体 reason。
 *
 * 例外:
 * - `network` 是客户端问题,不能用 D6(否则用户会以为是文件问题)
 * - `requirement-not-found` 是用户上下文问题,给独立提示
 *
 * 组件调用:
 * ```tsx
 * const hint = humanizeUploadFailReason(result.reason)
 * ```
 */
export function humanizeUploadFailReason(reason: UploadFailReason): string {
  if (reason === 'requirement-not-found') return REQUIREMENT_GONE_MESSAGE
  if (reason === 'network') return NETWORK_MESSAGE
  return UNIFIED_BANNER_MESSAGE
}

/**
 * 失败 reason → 统一 UI 文案(给顶部红条用)
 *
 * 锁定 ADR-0015 D6 顶部红条:任何**文件问题**(ext/mime/magic/size/
 * image-too-large/parse-error)都用 `UNIFIED_BANNER_MESSAGE`,不暴露具体 reason。
 *
 * 注:这个函数由 `postUploadFile` 内部使用,把"reason → 文字"映射**只做一次**。
 * 组件读 `result.message` 即可,不要在组件里再调 `humanizeUploadFailReason`。
 */
function humanizeUploadFail(
  reason: UploadFailReason,
  _serverMessage: string | null,
): string {
  return humanizeUploadFailReason(reason)
}

/** 把 File 转 base64 字符串(同步 FileReader → await 转 Promise) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('文件读取结果非字符串'))
        return
      }
      // result 是 `data:<mime>;base64,<b64>` —— 去掉前缀
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** shared 包给出的"合法 reason 集合"(服务端会发的),用于从 AgentError 抽出 */
const SERVER_REASONS: ReadonlySet<UploadFailReason> = new Set([
  'ext',
  'mime',
  'magic',
  'size',
  'image-too-large',
  'parse-error',
  'requirement-not-found',
])

/**
 * 服务端闸门 / 解析失败时,从 `AgentError.body` 抽取 reason + message。
 * AgentError 失败时 body 形如 `{ error, reason, message }`,我们关心 `reason` 与 `message`。
 * - 已知 reason → 原样返回
 * - 未知 reason → 视为 `network`(避免泄露 server-side 错误码到 UI)
 */
function extractUploadFailFromAgentError(err: unknown): {
  reason: UploadFailReason
  message: string | null
} {
  if (err instanceof AgentError) {
    const body = err.body as
      | { reason?: string; message?: string }
      | null
      | undefined
    const reasonRaw = body?.reason
    const message = body?.message ?? null
    const reason: UploadFailReason =
      reasonRaw && SERVER_REASONS.has(reasonRaw as UploadFailReason)
        ? (reasonRaw as UploadFailReason)
        : 'network'
    return { reason, message }
  }
  return { reason: 'network', message: null }
}

/**
 * ticket 03 内部共享 helper:把 File → 闸门 → base64 → POST → 错误归一化。
 *
 * 80% 的"上传"流程在前端只是这段代码 + 不同的 path 与响应解析;
 * 抽到这一处让 `parseForDialog` / `uploadAndReplace` 都从它出发,
 * 避免两处副本漂移(standards axis review finding #1)。
 */
async function postUploadFile<TData>(
  file: File,
  path: string,
  /** 把 raw 响应映射成对外 data;在 caller 处实现 */
  mapData: (raw: unknown) => TData,
): Promise<UploadActionResult<TData>> {
  const local = await validateUpload(file)
  if (!local.ok) {
    return {
      ok: false,
      reason: local.reason as UploadFailReason,
      message: humanizeUploadFail(
        local.reason as UploadFailReason,
        local.message ?? null,
      ),
    }
  }
  let contentBase64: string
  try {
    contentBase64 = await fileToBase64(file)
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : '读取文件失败',
    }
  }
  try {
    const raw = await agentFetch<unknown>(path, {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mime: file.type,
        contentBase64,
      }),
    })
    return { ok: true, data: mapData(raw) }
  } catch (err) {
    const { reason, message } = extractUploadFailFromAgentError(err)
    return {
      ok: false,
      reason,
      message: humanizeUploadFail(reason, message),
    }
  }
}

/**
 * Dialog 预填入口(ADR-0015 D3 / D5)。
 *
 * 流程:
 * 1) 前端 `validateUpload(file)` 闸门(命中即返回红条文案,不调服务端)
 * 2) 服务端 `POST /api/uploads/parse` → 闸门 + 解析,**不写盘**
 * 3) 返回 markdown + images → 调用方塞进本地 state(textarea + 待发的 images)
 *
 * 不会触及任何 req 目录 / assets/,真正的写盘等到用户点"创建"时由
 * `createRequirement` 接管(ticket 04 + ticket 02 衔接)。
 */
export async function parseForDialog(
  file: File,
): Promise<
  UploadActionResult<{
    markdown: string
    /** docx 解出的图片 base64 数组,等"创建"时随 POST 一起发给服务端落 assets/ */
    images: ReadonlyArray<{ name: string; base64: string; mime: string }>
  }>
> {
  return postUploadFile(
    file,
    '/api/uploads/parse',
    (raw) => {
      const data = raw as ParseUploadResponse
      return { markdown: data.markdown, images: data.images }
    },
  )
}

/**
 * DRAFTING 覆盖入口(ADR-0015 D3 / D8 W4)。
 *
 * 流程:
 * 1) 前端 `validateUpload(file)` 闸门(命中即返回红条文案)
 * 2) 服务端 `POST /api/requirement/:id/upload-replace` → 闸门 + 解析 +
 *    landAssets + replaceDataUriWithAssetPath + 覆盖 requirement.md
 * 3) 返回 markdown + assets → 调用方刷新 prdMarkdown(react 受控 state)与
 *    auxFiles(asset 列表本 ticket 不动 — 留 ticket 04 拓展)
 *
 * 强度 W4:不弹 modal / 不输入确认 / 不写历史快照 —— 失败 → 顶部红条,成功 → 立即覆盖。
 */
export async function uploadAndReplace(
  reqId: string,
  file: File,
): Promise<UploadActionResult<{ markdown: string; assets: AssetMeta[] }>> {
  return postUploadFile(
    file,
    `/api/requirement/${encodeURIComponent(reqId)}/upload-replace`,
    (raw) => {
      const data = raw as UploadReplaceResponse
      return { markdown: data.markdown, assets: data.assets }
    },
  )
}