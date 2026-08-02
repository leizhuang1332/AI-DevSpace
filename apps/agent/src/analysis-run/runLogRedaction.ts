/**
 * Run Log 脱敏(issue 06 · ADR-0021 决策 38)
 *
 * Analysis Run 落盘 / SSE 推送前对文本与 JSON value 抹除常见敏感串;
 * 覆盖:Authorization 头、Bearer token、apiKey / token / secret / password
 * 键值对、PEM 私钥块、AKID 阿里云 access key prefix 等。
 *
 * 设计原则(issue 06 验收 5 / 6 / 7):
 * - 落盘前 + SSE 发布前同步执行(单点真相在 AnalysisAgentRunner 拦截处)
 * - 服务端兜底在 AnalysisRunService.appendLogEntry 再做一次,避免跨 provider
 *   漏脱敏或 race 写入
 * - 客户端不再做补救遮盖(决策 38:日志 UI 不负责补救服务端未脱敏内容)
 * - 不修改 system prompt / thinking —— 这两类根本不会进 Run Log
 *
 * 与 SessionLogger.summarize 的差异:
 * - SessionLogger 用于 query 生命周期的 preview 摘要,只处理 string
 * - 本模块用于 Run Log 完整持久化,需保留全部结构(对象/数组/字符串),
 *   且脱敏后必须仍能通过 zod 校验 + 还原 JSON
 *
 * 不做的事:
 * - 不做语义指纹(避免误判)
 * - 不强制把所有 16 字符以上 base64 串都抹掉(误伤太大)
 * - 不修改字符串长度计量语义(只替换原文,JSON 序列化由 caller 负责)
 */

/** 默认敏感串正则集合(issue 06 决策 38:至少覆盖授权头、API key、token、password、私钥)
 *
 * 顺序敏感:先做带引号的值,再做裸值;先做带 key 前缀的整段,再做无 key 头的纯 Bearer 串。
 * 每条替换都是 idempotent —— 同一段文本多次 redact 结果一致。
 *
 * 各正则 capture group 1 (即第一个 `()`) = "key prefix",会与 REDACTED_PLACEHOLDER
 * 拼接成"key=[REDACTED]"形态,便于阅读且不暴露原值;无 capture group 1 的正则
 * (PEM / AKID / JWT / 裸 Bearer)整段替换为 REDACTED_PLACEHOLDER。 */
export const DEFAULT_REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  // 1) PEM 私钥块:-----BEGIN [type] PRIVATE KEY----- ... -----END ... PRIVATE KEY-----
  //    整段多行抹掉,避免中间内容漏脱敏。无捕获组 → 整体替换为 [REDACTED]
  /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/g,

  // 2) Authorization 头 / 字段(任意形式:JSON / header / env)
  //    - "authorization": "Bearer xxx" → "authorization": "[REDACTED]"
  //    - "Authorization: Bearer xxx"  → "Authorization: [REDACTED]"
  //    - 整段被替换;prefix 含 "Authorization: " (或带引号)
  /(["']?authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+[A-Za-z0-9._~+/=-]+|[A-Za-z0-9._~+/=-]+)["']?/gi,
  // 3) 裸 Bearer token(无 authorization 前缀,出现在文本中部,保留前导空白)
  /(\s|^)Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,

  // 4) 带花括号值:api_key={...} → api_key=[REDACTED]
  /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)\{[^{}]*\}/gi,
  // 5) 带双引号:api_key="..." → api_key=[REDACTED]
  /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)"[^"]*"/gi,
  // 6) 带单引号:api_key='...' → api_key=[REDACTED]
  /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)'[^']*'/gi,

  // 7) 裸值(无引号):api_key=xxx / token: yyy —— 抹到下一个空白 / 引号 / 边界
  //    注意:字符类**不**排除 `]` —— 否则已脱敏文本 api_key=[REDACTED] 二次
  //    处理时,`[` 后到 `]` 之间的字符会被匹配 + 尾部 `]` 留在外面,导致
  //    `api_key=[REDACTED]` → `api_key=[REDACTED]]` 的非 idempotent bug
  /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)[^\s"',;}]+/gi,

  // 8) AKID 阿里云 access key prefix(无 key 前缀,直接出现在文本里)
  /\bAKID[A-Za-z0-9]{12,}\b/g,

  // 9) 通用 JWT(三段式 base64,以 . 分隔,各段 16+ chars)
  /\beyJ[A-Za-z0-9_=]+\.[A-Za-z0-9_=]+\.?[A-Za-z0-9_.+/=]*/g,
] as const

/** 脱敏替换占位符 —— 不暴露原始长度,避免从长度还原原文。 */
export const REDACTED_PLACEHOLDER = '[REDACTED]'

/** 保留 key 前缀 + 替换 value,便于阅读时仍知道"这里有 secret"且不泄露原值。 */
function redactMatchedGroup(keyPrefix: string): string {
  return `${keyPrefix}${REDACTED_PLACEHOLDER}`
}

/**
 * 对一段字符串执行脱敏替换。
 *
 * 入参安全:非 string 返回原值(类型守卫失败 → no-op)。
 * 多轮迭代一次足够:每条正则只匹配一次(全局标志 /g + 不重叠),
 * 后续替换的 key 前缀不会再次命中。
 *
 * Replace 回调的 replaceValue 处理:
 * - 若正则有 1+ 捕获组 + 第一个捕获组是 string → 用其作为 key 前缀
 *   拼 REDACTED_PLACEHOLDER(便于阅读 + 不暴露原值)
 * - 否则 → 整段匹配替换为 REDACTED_PLACEHOLDER
 *
 * 注:JS String.prototype.replace 回调参数序列为
 *   (match, p1, p2, ..., offset, string)
 * 我们用 ...args,然后在 args 中挑出第一个 string(跳过 offset/string
 * 这两个 non-string 的"形参",因为 number 类型也能出现)。
 */
export function redactText(
  text: string,
  patterns: ReadonlyArray<RegExp> = DEFAULT_REDACTION_PATTERNS,
): string {
  if (typeof text !== 'string') return text
  let out = text
  for (const re of patterns) {
    out = out.replace(re, (...args: unknown[]) => {
      // JS String.prototype.replace 回调参数序列:
      //   (match, p1, p2, ..., offset, string)
      // 我们跳过 match 自身(args[0]),在剩下 args 中挑出第一个 string 类型的
      // capture group 作为 "key prefix" —— 找不到(无 group 或 group 为空)时
      // 整段替换为 REDACTED_PLACEHOLDER(单值 token / PEM / AKID / JWT 等)。
      let prefix = ''
      for (let i = 1; i < args.length; i++) {
        const a = args[i]
        if (typeof a === 'string' && a.length > 0) {
          prefix = a
          break
        }
        if (typeof a === 'number') {
          // offset —— string.replace 内部传 number;再往后不会再有 capture group
          break
        }
      }
      if (prefix.length > 0) return redactMatchedGroup(prefix)
      return REDACTED_PLACEHOLDER
    })
  }
  return out
}

/**
 * 对单条 Run Log entry 做脱敏(issue 06 · ADR-0021 决策 38 · 71 · 72)。
 *
 * - text / tool_use.input / tool_result.output 全部走 redactValue,抹掉常见
 *   secret 串(Authorization / Bearer / api_key= / token= / secret= / password= /
 *   PEM 私钥 / AKID / JWT 三段式)
 * - system prompt / raw chain-of-thought 不会进 Run Log(handleSdkEnvelope
 *   仅在 text / tool_use / tool_result 三类事件落日志)
 *
 * 失败保护:任何脱敏异常都让 entry 保持原状;调用方应将其视为不可信
 * (issue 06 决策 38:脱敏必须发生在写盘前;调用方应拒绝写盘而非静默吞错,
 * 避免"未脱敏内容进 log")。
 *
 * @returns 脱敏后 entry;若脱敏过程抛错,返回原 entry(由调用方决定如何处理)
 */
export function redactLogEntry(entry: import('@ai-devspace/shared').AnalysisLogEntry): import('@ai-devspace/shared').AnalysisLogEntry {
  try {
    if (entry.kind === 'text') {
      return { ...entry, text: redactText(entry.text) }
    }
    if (entry.kind === 'tool_use') {
      return { ...entry, input: redactValue(entry.input) }
    }
    if (entry.kind === 'tool_result') {
      return { ...entry, output: redactValue(entry.output) }
    }
  } catch {
    /* 脱敏异常 → 返回原 entry,让调用方决定拒绝写盘 / 安全降级 */
  }
  // TS narrowing 兜底:已 exhaustively 处理所有 kind,这里 unreachable
  return entry
}

/**
 * 递归遍历 unknown value,对所有 string 做 redactText。
 *
 * - string → 脱敏后 string
 * - number / boolean / null / undefined → 原样
 * - Array → 递归每个元素
 * - object → 递归每个属性(保留 key 名,便于阅读 + 不破坏 JSON 结构)
 *
 * 已知非 secret 形态(BigInt / Symbol / Function)→ JSON.stringify 失败;
 * 不在 Run Log 工具入参 / 输出中出现(SDK 仅传 plain JSON);安全抛出兜底。
 */
export function redactValue(
  value: unknown,
  patterns: ReadonlyArray<RegExp> = DEFAULT_REDACTION_PATTERNS,
): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') return redactText(value as string, patterns)
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value
  if (Array.isArray(value)) {
    return value.map((it) => redactValue(it, patterns))
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, patterns)
    }
    return out
  }
  // Symbol / Function / 未识别 → 原样返回(由 caller 决定是否需要 stringify)
  return value
}
