/**
 * toolClassifier —— ADR-0010 Q4 (P1 工具分类)
 *
 * 把一个 tool_use 事件分类为「读」或「写」,驱动 WriteQueue 走 / 不走 串行队列。
 *
 * 写:
 *   - 工具名直接命中写集合(Edit / Write / NotebookEdit)
 *   - Bash 且命令内容匹配写命令正则
 *
 * 读:
 *   - 工具名命中读集合(Read / Grep / Glob)
 *   - Bash 且命令内容不含写信号(默认按读)
 *   - 未知工具名(保守按读 —— 避免误阻塞未识别的扩展工具)
 *
 * 设计取舍:
 *   - 正则保守(命中即写),宁可误杀不可漏放
 *   - 不解析 shell 引号 / 转义;P1 阶段够用,P2 引入 PreToolUse hook 后由 SDK 做精确检测
 */

/** 工具名集合 —— 写类(精确,不含 Bash) */
const WRITE_TOOL_NAMES = new Set<string>(['Edit', 'Write', 'NotebookEdit'])

/** 工具名集合 —— 读类(精确,不含 Bash) */
const READ_TOOL_NAMES = new Set<string>(['Read', 'Grep', 'Glob'])

/**
 * Bash 命令里出现以下任意模式 → 视为写操作。
 *
 * 保守策略:命中即写,可宁误杀不可漏放(漏拦 rm / git push 等破坏性操作代价大)。
 * 数组按"行为类别"分组,新增模式时挑对应分组追加,避免末尾堆积。
 */
const BASH_WRITE_PATTERNS: RegExp[] = [
  // ── 文件 / 目录 删除 · 移动 · 复制 · 改元数据 ─────────────────
  /\brm\b/, // 删除(rm -rf / rm -f 等)
  /\bmv\b/, // 移动(目标侧写)
  /\bcp\b/, // 复制(目标侧写)
  /\bchmod\b/, // 改权限
  /\bchown\b/, // 改属主

  // ── 输出重定向(覆盖 / 追加) ────────────────────────────────────
  />/, // 含 > 或 >> 的任何形式

  // ── git 改工作区 / 分支拓扑 / 远端 ──────────────────────────────
  /git\s+(?:commit|push|checkout|reset|merge|rebase)\b/,

  // ── 包管理器(改 node_modules + lockfile) ───────────────────────
  /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b/,

  // ── 文件 / 目录 创建 · 原地编辑 ────────────────────────────────
  /\bsed\s+-i\b/, // 原地编辑
  /\btouch\b/, // 创建空文件
  /\bmkdir\b/, // 创建目录
]

export type ToolClass = 'read' | 'write'

/**
 * 对一个 tool_use 事件分类。
 * @param name  工具名(Edit / Read / Bash ...)
 * @param input 工具入参(可能是任意 JSON 结构)
 */
export function classifyTool(name: string, input: unknown): ToolClass {
  if (WRITE_TOOL_NAMES.has(name)) return 'write'
  if (READ_TOOL_NAMES.has(name)) return 'read'

  if (name === 'Bash') {
    const cmd = extractBashCommand(input)
    // 拿不到 command 字符串时保守按写(宁可误杀不可漏放)
    if (cmd === null) return 'write'
    return isBashWriteCommand(cmd) ? 'write' : 'read'
  }

  // 未知工具 —— 保守按读,不阻塞
  return 'read'
}

/** 从 Bash tool input 里抽出 command 字符串;input 形状异常 → null */
function extractBashCommand(input: unknown): string | null {
  if (input === null || input === undefined || typeof input !== 'object') return null
  const cmd = (input as { command?: unknown }).command
  return typeof cmd === 'string' && cmd.length > 0 ? cmd : null
}

/** 命令字符串是否匹配任何写模式 */
function isBashWriteCommand(cmd: string): boolean {
  if (cmd.length === 0) return false
  for (const re of BASH_WRITE_PATTERNS) {
    if (re.test(cmd)) return true
  }
  return false
}