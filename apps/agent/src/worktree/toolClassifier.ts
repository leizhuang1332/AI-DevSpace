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
 * 保守策略:
 *   - `\brm\b` —— 删除文件;`-rf` / `-f` / `-r` 都覆盖
 *   - `\bmv\b` / `\bcp\b` —— mv 是搬移(目标侧写),cp 是复制(目标侧写)
 *   - `\bchmod\b` / `\bchown\b` —— 修改元数据(写)
 *   - `>` / `>>` —— 输出重定向
 *   - `git commit` / `git push` —— 推代码改动
 *   - `git checkout` (切换 branch / 恢复文件) / `git reset` —— 改工作区
 *   - `git merge` / `git rebase` —— 改分支拓扑
 *   - `npm install` / `pnpm install` / `yarn install` —— 改 node_modules + lockfile
 *   - `sed -i` —— 原地编辑
 *   - `touch` —— 创建文件
 */
const BASH_WRITE_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\bchmod\b/,
  /\bchown\b/,
  />/,
  /git\s+commit\b/,
  /git\s+push\b/,
  /git\s+checkout\b/,
  /git\s+reset\b/,
  /git\s+merge\b/,
  /git\s+rebase\b/,
  /\bnpm\s+install\b/,
  /\bpnpm\s+(?:install|add)\b/,
  /\byarn\s+(?:install|add)\b/,
  /\bsed\s+-i\b/,
  /\btouch\b/,
  /\bmkdir\b/,
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
    if (cmd === null) return 'read'
    return isBashWriteCommand(cmd) ? 'write' : 'read'
  }

  // 未知工具 —— 保守按读,不阻塞
  return 'read'
}

/** 从 Bash tool input 里抽出 command 字符串;input 形状异常 → null */
function extractBashCommand(input: unknown): string | null {
  if (input === null || input === undefined || typeof input !== 'object') return null
  const cmd = (input as { command?: unknown }).command
  return typeof cmd === 'string' ? cmd : null
}

/** 命令字符串是否匹配任何写模式 */
function isBashWriteCommand(cmd: string): boolean {
  if (cmd.length === 0) return false
  for (const re of BASH_WRITE_PATTERNS) {
    if (re.test(cmd)) return true
  }
  return false
}