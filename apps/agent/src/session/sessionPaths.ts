/**
 * sessionPaths —— ADR-0010 Q7.2 会话持久化路径约定
 *
 *   <root>/requirements/<reqId>/sessions/<localSid>/
 *     ├── meta.yaml        # session 元数据 (SessionStore)
 *     └── messages.jsonl   # AI 事件增量镜像 (MessagesMirror)
 *
 * `local_sid` 是 Agent 生成的全局唯一 UUID (Q7.1),但磁盘布局是 per-req 的
 * (Q7.2)。SessionStore / MessagesMirror 的对外接口只收 `localSid`,靠
 * `findSessionDir` 扫描各 req 的 `sessions/<localSid>` 目录反查 reqId。
 *
 * 用 node:path.join(真实磁盘路径,跨平台),不用 posixJoin(那是给 git args 的)。
 */

import { join } from 'node:path'
import { readdirSync, existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'

/** <root>/requirements/<reqId>/sessions/ (某个 req 的全部 session 容器) */
export function sessionsDirFor(root: string, reqId: string): string {
  return join(root, 'requirements', reqId, 'sessions')
}

/** <root>/requirements/<reqId>/sessions/<localSid>/ */
export function sessionDirFor(root: string, reqId: string, localSid: string): string {
  return join(sessionsDirFor(root, reqId), localSid)
}

/** session 目录下的 meta.yaml */
export function metaPathFor(root: string, reqId: string, localSid: string): string {
  return join(sessionDirFor(root, reqId, localSid), 'meta.yaml')
}

/** session 目录下的 messages.jsonl */
export function messagesPathFor(root: string, reqId: string, localSid: string): string {
  return join(sessionDirFor(root, reqId, localSid), 'messages.jsonl')
}

/** session 目录下的 log.jsonl(query 生命周期结构化日志,SessionLogger 写入) */
export function logPathFor(root: string, reqId: string, localSid: string): string {
  return join(sessionDirFor(root, reqId, localSid), 'log.jsonl')
}

/** findSessionDir 命中结果 */
export interface FoundSession {
  reqId: string
  dir: string
}

/**
 * 扫描各 req 的 `sessions/<localSid>` 目录,反查 session 所在的 reqId。
 * 找不到(含 requirements 目录不存在)返回 null,不抛错。
 */
export function findSessionDir(root: string, localSid: string): FoundSession | null {
  const requirementsDir = join(root, 'requirements')
  let reqEntries: Dirent[]
  try {
    reqEntries = readdirSync(requirementsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of reqEntries) {
    if (!entry.isDirectory()) continue
    const reqId = entry.name
    const dir = sessionDirFor(root, reqId, localSid)
    if (existsSync(dir)) return { reqId, dir }
  }
  return null
}
