/**
 * HighRiskDetector —— ADR-0010 Q6.1 + ADR-0009 第 1 层「预」
 *
 * 5 类高危检测(摘自 ADR-0010 Q6 + ADR-0009 决策 46):
 *   1. 删业务文件   Bash 含 rm 且非白名单 / Edit|Write 目标在 protected_paths
 *   2. force-push   Bash 正则 git push.*(-f|--force)\b
 *   3. 推 main      Bash 命令解析后 target branch ∈ {main, master}
 *   4. 敏感信息     Write|Edit content 走 secrets 扫描(api_key= / Bearer / AKID)
 *   5. 跳 verify    Bash 含 --no-verify / --no-gpg-sign
 *
 * 设计取舍:
 *  - **保守**:命中即报高危,不解析 shell 引号转义 —— SDK 已经做精确化,
 *    本层只是兜底过滤
 *  - **白名单在命令前** —— rm 的白名单常用模式:rm -rf node_modules / .aidevspace/snapshots
 *    决策 46:不可逆操作默认阻止;白名单由用户在 meta.yaml protected_paths 同源配置
 *  - **secrets 用正则** —— 决策 46:api_key= / Bearer / AKID(阿里云 access key prefix)
 *  - **不抛错** —— 返回 RiskHit[];由 PermissionHook 决定 allow/deny
 *  - **target branch 解析极简** —— 抓 git push 后面第一个非 flag 字符串
 *    (碰到 git push -u origin feature/x 会抽出 origin,不命中;只解析 git push origin main 形态)
 *    因为目标分支真实名可能在 origin/xxx 后,本期先按「命令行末尾的 raw 字符串」判断
 */

export type RiskCategory =
  | 'delete-business-file'
  | 'force-push'
  | 'push-to-main'
  | 'secret-leak'
  | 'skip-verify'

export interface RiskHit {
  category: RiskCategory
  /** 给 AI / 用户的简短说明(可进 deny reason / SSE 弹窗) */
  reason: string
  /** 命中处(命令 / 文件路径 / 内容片段) —— UI 展示用 */
  snippet: string
}

export interface HighRiskDetectorDeps {
  /** 不可碰路径清单(决策 46 第 1 行);默认含 ~/.aidevspace/, .git/, node_modules/ */
  protectedPaths?: ReadonlyArray<string>
  /** rm 白名单(命中即放行);默认空 */
  rmAllowlist?: ReadonlyArray<RegExp | string>
  /** secrets 扫描正则;默认 api_key= / Bearer / AKID */
  secretPatterns?: ReadonlyArray<RegExp>
}

export interface HighRiskDetector {
  /** 检测一个 tool_use 是否高危 —— 返回所有命中(可能多条) */
  detect(toolName: string, input: unknown): RiskHit[]
}

const DEFAULT_PROTECTED_PATHS = ['~/.aidevspace/', '.git/', 'node_modules/'] as const

const DEFAULT_SECRET_PATTERNS = [
  /\bapi[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  /\bBearer\s+[A-Za-z0-9_.=]{20,}/i,
  /\bAKID[A-Za-z0-9]{16,}\b/, // 阿里云 access key prefix
  // 决策 46 也提到 .env / *secret* / *password* / BEGIN PRIVATE KEY;
  // 写文件时命中文件路径也算 —— 由 Bash 检测路径时再补
] as const

/** 解析 Bash tool input 中的 command 字符串 */
function extractBashCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const cmd = (input as { command?: unknown }).command
  return typeof cmd === 'string' && cmd.length > 0 ? cmd : null
}

/** 解析 Edit / Write tool input 中的 file_path */
function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const p = (input as { file_path?: unknown; path?: unknown }).file_path
    ?? (input as { path?: unknown }).path
  return typeof p === 'string' && p.length > 0 ? p : null
}

/** 解析 Edit / Write tool input 中的 content / new_string */
function extractContent(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const c = (input as { content?: unknown }).content
    ?? (input as { new_string?: unknown }).new_string
  return typeof c === 'string' ? c : null
}

/** Bash 命令里 target branch 是否 ∈ {main, master} */
const PUSH_TARGET_RE = /\bgit\s+push\b([^\n]*)$/i

function detectPushToMain(cmd: string): RiskHit | null {
  // 只匹配命令末尾的 git push ... 片段,避免大段文本里的 "git push" 误判
  const m = cmd.match(PUSH_TARGET_RE)
  if (!m) return null
  const tail = m[1] ?? ''
  // tail 形如 " origin main" / " origin master" / " -u origin main"
  // 抽末尾非 flag token
  const tokens = tail.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  // 跳过 flag 开头(-u / -f / --force 等)
  const targetCandidates: string[] = []
  for (const t of tokens) {
    if (t.startsWith('-')) continue
    targetCandidates.push(t)
  }
  if (targetCandidates.length === 0) return null
  // 最后一个 = 真正分支名(可能在 remote 之后)
  // git push origin main      → ['origin', 'main']
  // git push -u origin main   → ['origin', 'main']
  // git push origin HEAD:main → 末尾形如 HEAD:main —— 也算 main
  const last = targetCandidates[targetCandidates.length - 1] ?? ''
  // HEAD:xx 形态
  if (last.includes(':')) {
    const ref = last.split(':').pop() ?? ''
    if (ref === 'main' || ref === 'master') {
      return {
        category: 'push-to-main',
        reason: `git push target branch "${ref}" is protected; this would push to main/master`,
        snippet: cmd.trim(),
      }
    }
    return null
  }
  if (last === 'main' || last === 'master') {
    return {
      category: 'push-to-main',
      reason: `git push target branch "${last}" is protected; this would push to main/master`,
      snippet: cmd.trim(),
    }
  }
  return null
}

/** rm 命令是否命中白名单 */
function isRmAllowlisted(cmd: string, allowlist: ReadonlyArray<RegExp | string>): boolean {
  if (allowlist.length === 0) return false
  for (const pat of allowlist) {
    if (typeof pat === 'string') {
      if (cmd.includes(pat)) return true
    } else {
      if (pat.test(cmd)) return true
    }
  }
  return false
}

/** 路径是否命中 protected_paths(子串匹配) */
function isProtectedPath(p: string, protectedPaths: ReadonlyArray<string>): boolean {
  for (const seg of protectedPaths) {
    const needle = seg.replace(/^~/, '')
    if (p.includes(needle)) return true
  }
  return false
}

export function createHighRiskDetector(
  deps: HighRiskDetectorDeps = {},
): HighRiskDetector {
  const protectedPaths = deps.protectedPaths ?? DEFAULT_PROTECTED_PATHS
  const rmAllowlist = deps.rmAllowlist ?? []
  const secretPatterns = deps.secretPatterns ?? DEFAULT_SECRET_PATTERNS

  function detect(toolName: string, input: unknown): RiskHit[] {
    const hits: RiskHit[] = []

    if (toolName === 'Bash') {
      const cmd = extractBashCommand(input)
      if (cmd === null) return hits

      // 1) rm 非白名单
      if (/\brm\b/.test(cmd) && !isRmAllowlisted(cmd, rmAllowlist)) {
        hits.push({
          category: 'delete-business-file',
          reason:
            'rm command outside the allowlist; deleting business files requires user confirmation',
          snippet: cmd.trim(),
        })
      }

      // 2) force-push
      if (/git\s+push[^\n]*(-f|--force)\b/.test(cmd)) {
        hits.push({
          category: 'force-push',
          reason:
            'git push --force is irreversible; force-push always requires user confirmation',
          snippet: cmd.trim(),
        })
      }

      // 3) push-to-main
      const pushHit = detectPushToMain(cmd)
      if (pushHit) hits.push(pushHit)

      // 5) skip verify
      // 注意:不能用 \b,因为 `--no-verify-server-cert` 也会匹配。
      // 必须确保 --no-verify / --no-gpg-sign 后面跟的是空白/字符串结束(不是字母数字 / -)。
      if (/(?:^|\s|=")(?:--no-verify|--no-gpg-sign)(?=\s|$|"|')/.test(cmd)) {
        hits.push({
          category: 'skip-verify',
          reason:
            'skipping commit hooks via --no-verify/--no-gpg-sign bypasses safety checks',
          snippet: cmd.trim(),
        })
      }
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      const path = extractFilePath(input)
      if (path && isProtectedPath(path, protectedPaths)) {
        hits.push({
          // spec 把"Bash rm"和"Edit/Write 命中不可碰清单"都归到同一类 delete-business-file
          // (ADR-0010 Q6 表格);保留 category 一致,reason 文案区分清楚实际触发场景
          category: 'delete-business-file',
          reason: `target path "${path}" is in the protected list (cannot be modified); spec treats this as the "delete business file" guardrail`,
          snippet: path,
        })
      }

      // 4) secrets in content
      const content = extractContent(input)
      if (content) {
        for (const re of secretPatterns) {
          const m = content.match(re)
          if (m) {
            hits.push({
              category: 'secret-leak',
              reason: 'content appears to contain a secret (api_key/Bearer/AKID)',
              snippet: m[0],
            })
            break // 同 content 只报一条 secret hit
          }
        }
      }
    }

    // 删除(NotebookEdit) — 暂不特别处理(NotebookEdit 形态与 Edit 类似)
    return hits
  }

  return { detect }
}