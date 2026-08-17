/**
 * pathUtil —— 跨端路径归一化 helper
 *
 * 当前唯一导出 `normalizeWorkspaceRoot`:把 Git Bash mingw 风格 POSIX 路径
 * (`/c/Users/foo`)归一化为 Windows 原生路径(`C:\Users\foo`)。
 *
 * 修 bug:用户在 Git Bash 里 `export AIDEVSPACE_HOME=$HOME/.aidevspace`(= `/c/Users/Lorcan/.aidevspace`)
 * 时,Node.js `path.join('/c/...', ...)` 把开头 `/` 当 drive-relative;git.exe 从
 * Node.js cwd(`D:\...`)收到 `/c/foo` 时**不**走 MSYS mount 翻译,而是当
 * drive-relative。两边都写到 `<cwd_drive>:\c\...` 错位目录,与用户期望的
 * `C:\Users\...` 不一致 —— 「git says exists / Node.js says not exists」。
 *
 * 修复:
 * - win32 平台 + 输入匹配 `^/[a-zA-Z]/...` → 返回 `<Letter>:\...`(盘符大写、
 *   分隔符 `\`);否则原样返回
 * - POSIX 平台 → 原样返回(无 mingw 概念)
 *
 * 不变更:
 * - 已 native 的 Windows 路径(`C:\foo` / `C:/foo`)原样返回
 * - POSIX 路径(`/tmp/foo`)原样返回
 * - `~/...`(由调用方的 `expandHome` 处理)不在本 helper 范围
 *
 * 调用方:`WorkspaceService.resolveRoot`、`resolveRequirementsRoot`、
 * `resolveTokenPath`、agent `AIDEVSPACE_ROOT` 等所有 `AIDEVSPACE_*` env 入口。
 */
/**
 * 把 Git Bash mingw 风格的 `/<letter>/...` 路径转成 Windows 原生 `<Letter>:\...`。
 *
 * 平台 /路径 → 输出:
 * - win32 + `^/[a-zA-Z]/` → 大写盘符 + `\` 分隔
 * - 其他 → 原样返回
 *
 * 注:`process.platform` 直接读取,不 `import { platform }` —— 后者在模块加载时
 * 把值解构到局部变量,后续 `Object.defineProperty(process, 'platform', ...)`
 * 改不到那份绑定,测试无法切换平台视角。
 *
 * @example
 * normalizeWorkspaceRoot('/c/Users/Lorcan/.aidevspace')
 * // → 'C:\\Users\\Lorcan\\.aidevspace' (win32)
 * // → '/c/Users/Lorcan/.aidevspace'       (POSIX,no-op)
 *
 * @example
 * normalizeWorkspaceRoot('C:\\Users\\me\\aidev') // → 'C:\\Users\\me\\aidev'(已 native,不动)
 */
export function normalizeWorkspaceRoot(input: string): string {
  if (process.platform !== 'win32') return input
  // mingw 风格:/<单字母>/(必须跟 / 才算,避免误伤 /tmp/foo 这种)
  const m = /^\/([a-zA-Z])\//.exec(input)
  if (!m) return input
  const letter = m[1].toUpperCase()
  // 替换剩下的所有 / 为 \
  const rest = input.slice(m[0].length).replace(/\//g, '\\')
  return `${letter}:\\${rest}`
}