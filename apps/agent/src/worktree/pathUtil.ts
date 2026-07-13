/**
 * pathUtil —— 跨平台 POSIX 路径拼接
 *
 * node:path 的 join 会按 OS 切换分隔符(Windows 下输出 `\fake\aidevspace\...`),
 * 但 git 路径在 args 里始终用 `/`,且我们想跨平台测试时结果稳定。
 *
 * 简单实现:用 `/` 拼接并规范化 `//` 和尾随 `/`。
 */

export function posixJoin(...parts: string[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (!p) continue
    // 把 p 拆成 segment,过滤空
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') out.pop()
      else out.push(seg)
    }
  }
  // 始终绝对路径
  return '/' + out.join('/')
}