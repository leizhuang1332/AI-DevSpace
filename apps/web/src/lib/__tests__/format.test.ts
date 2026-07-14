import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatRelativeTime } from '../format'

// 固定"当前时间"以便断言 —— formatRelativeTime 用 Date.now(),
// 测试侧用 vi.useFakeTimers 把系统时间锁住。
const NOW = new Date('2026-07-14T12:00:00.000Z').getTime()

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('< 5s → 刚刚', () => {
    const iso = new Date(NOW - 1_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('刚刚')
  })

  it('5s ~ 60s → x 秒前', () => {
    const iso = new Date(NOW - 30_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('30 秒前')
  })

  it('1min ~ 1h → x 分钟前', () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('5 分钟前')
  })

  it('未来时间(异常态)→ 刚刚', () => {
    const iso = new Date(NOW + 60_000).toISOString()
    expect(formatRelativeTime(iso)).toBe('刚刚')
  })

  it('空字符串 / 无效 ISO → 不抛错', () => {
    expect(formatRelativeTime('')).toBeTruthy()
    expect(formatRelativeTime('not-a-date')).toBeTruthy()
  })
})
