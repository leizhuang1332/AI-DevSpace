/**
 * 时间格式化工具(apps/web 共享)
 *
 * DRAFTING 工位多处需要"x 秒前 / x 分钟前"展示:
 * - PRD 编辑器头部(`drafting-prd-pane.tsx`)显示最后保存时间
 * - 辅助文件抽屉头部(`aux-drawer.tsx`)显示最后保存时间
 *
 * mock 期实现 —— 真实实现替换为 dayjs / date-fns 时只需改这一个文件。
 */

/**
 * 简单"x 秒前 / x 分钟前"格式化。
 *
 * - `iso` 为 ISO 字符串(由 `new Date().toISOString()` 生成);较当前时刻晚也
 *   一律显示"刚刚"
 * - < 5s → 刚刚(防止毫秒级抖动)
 * - < 60s → "x 秒前"
 * - < 60min → "x 分钟前"
 * - 更早 → ISO 字符串本地化时间(配合绝对值,不丢失)
 *
 * 纯函数,可独立单测。
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (diff < 0) return '刚刚'
  if (diff < 5_000) return '刚刚'
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`
  return new Date(iso).toLocaleTimeString()
}
