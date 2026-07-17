/**
 * pathUtil —— 跨平台 POSIX 路径拼接
 *
 * node:path 的 join 会按 OS 切换分隔符(Windows 下输出 `\fake\aidevspace\...`),
 * 但 git 路径在 args 里始终用 `/`,且我们想跨平台测试时结果稳定。
 *
 * 简单实现:用 `/` 拼接并规范化 `//` 和尾随 `/`,同时把 Windows 绝对路径
 * (`C:\...` / `C:/...`)转成 POSIX 形态(`/c/...` 或保留 drive 前缀)。
 *
 * Windows 兼容:mkdtempSync 在 Windows 上返回 `C:\Users\...\Temp\xxx`,
 * 不能简单地 prepend `/`(会变成 `/C:/Users/...` 不存在的路径)。识别到
 * drive-letter 开头时,把它转成 `/<drive>/...` 形态以保留绝对性 + 跨平台
 * 稳定。
 */

export function posixJoin(...parts: string[]): string {
  const out: string[] = []
  let leadingSlash = false
  let driveLetter: string | null = null
  for (const p of parts) {
    if (!p) continue
    // 把 p 中的 \ 全部转为 /,统一按 POSIX 解析
    const norm = p.replace(/\\/g, '/')
    const segs = norm.split('/')
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      if (seg === '' || seg === '.') continue
      // 检测首段是否是 Windows drive letter(e.g. "C:")
      if (i === 0 && /^[A-Za-z]:$/.test(seg)) {
        driveLetter = seg[0].toLowerCase()
        continue
      }
      if (seg === '..') out.pop()
      else out.push(seg)
    }
    if (norm.startsWith('/')) leadingSlash = true
  }
  // 拼接:drive letter → /<drive>/...;否则按 leadingSlash 决定前缀
  if (driveLetter) return '/' + driveLetter + '/' + out.join('/')
  if (leadingSlash) return '/' + out.join('/')
  return '/' + out.join('/')
}

/**
 * 把任意 OS-native 路径转成 git args 用的 POSIX 形态。
 *
 * - Windows `C:\Users\test\repos\a` → `/c/Users/test/repos/a`
 * - Windows `C:/Users/test/repos/a` → `/c/Users/test/repos/a`
 * - POSIX `/fake/aidevspace/repos/a` → `/fake/aidevspace/repos/a`
 *
 * 注:这里不能用 `node:path` 的 `posix.normalize`(它是相对路径语义),
 * 也不能用 `path.toNamespacedPath`(Windows-only)。直接复用 posixJoin
 * 的语义,但入口是单个已拼好的 native path,所以拆 drive-letter 后
 * 用 `posixJoin` 风格拼接。
 */
export function toPosixPath(nativePath: string): string {
  if (!nativePath) return '/'
  // 先把所有 \ 转 /,然后用 posixJoin 的语义拼
  const norm = nativePath.replace(/\\/g, '/')
  const segs = norm.split('/')
  const out: string[] = []
  let driveLetter: string | null = null
  let isAbsolute = norm.startsWith('/')
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if (seg === '' || seg === '.') continue
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) {
      driveLetter = seg[0].toLowerCase()
      continue
    }
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  if (driveLetter) return '/' + driveLetter + '/' + out.join('/')
  if (isAbsolute) return '/' + out.join('/')
  return '/' + out.join('/')
}