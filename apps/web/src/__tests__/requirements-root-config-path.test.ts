/**
 * `getDefaultConfigPath()` 单元测试
 * (issue: next-build-homedir-fix · 01)
 *
 * 验收点(对应 PRD T-2.1 ~ T-2.6):
 * - T-2.1 env 未设 + 干净 env → 返回 `join(homedir(), '.aidevspace', 'config.yaml')`
 * - T-2.2 env Unix 绝对路径 → 直接返回
 * - T-2.3 env Windows 绝对路径 → 原样返回
 * - T-2.4 env 空字符串 → fallback 到 `homedir()`(避免空字符串误判)
 * - T-2.5 env 全空白 → fallback 到 `homedir()`(与空字符串等价处理)
 * - T-2.6 返回值必须是 `isAbsolute()` 真的绝对路径(防止 cwd 相对路径泄漏)
 *
 * 关键设计:`getDefaultConfigPath()` 是 lazy 函数,module-top 不调 `homedir()`。
 * NFT 在 `next build` 期间看不到这个调用,build 走 env 注入的稳定路径即可。
 *
 * 关于"env 短路时 homedir 不被调用"的硬证明:
 * 本文件不引入 `vi.spyOn` / `vi.mock('node:os')`,理由:
 * 1. ESM 模式下 `vi.spyOn(os, 'homedir')` 抛 "Cannot redefine property"(vitest
 *    跑 native ESM,`node:os` 的 named export 是只读 binding)
 * 2. `vi.mock('node:os', factory)` 在 vitest + native ESM 下不会拦截其他模块
 *    对 `node:os` 的 import(需要 `server.deps.inline: ['node:os']` 配置,
 *    超出本 issue 范围)
 * 3. 按 skill 原则"测外部行为,不是实现细节":行为断言(env 设了 → 返 env 值;
 *    env 未设 → 返 homedir 拼出的路径)是充分的;`homedir()` 短路的硬证明靠
 *    source code review(函数体一个 if 早返,见 requirements-root.server.ts:74-80)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isAbsolute } from 'node:path'
import { getDefaultConfigPath } from '@/lib/requirements-root.server'

// ============================================================================
// env 隔离
// ============================================================================

const ORIGINAL_AIDEVSPACE_CONFIG_PATH = process.env.AIDEVSPACE_CONFIG_PATH

beforeEach(() => {
  delete process.env.AIDEVSPACE_CONFIG_PATH
})

afterEach(() => {
  if (ORIGINAL_AIDEVSPACE_CONFIG_PATH === undefined) {
    delete process.env.AIDEVSPACE_CONFIG_PATH
  } else {
    process.env.AIDEVSPACE_CONFIG_PATH = ORIGINAL_AIDEVSPACE_CONFIG_PATH
  }
})

// ============================================================================
// T-2.1:env 未设 → fallback join(homedir(), ...)
// ============================================================================

describe('getDefaultConfigPath · T-2.1 env 未设', () => {
  it('返回的路径包含 \'.aidevspace/config.yaml\'', () => {
    const result = getDefaultConfigPath()
    expect(result).toContain('.aidevspace')
    expect(result).toMatch(/config\.yaml$/)
  })

  it('返回值是绝对路径', () => {
    const result = getDefaultConfigPath()
    expect(isAbsolute(result)).toBe(true)
  })

  it('两次调用结果一致(同一进程内 homedir 不变)', () => {
    const a = getDefaultConfigPath()
    const b = getDefaultConfigPath()
    expect(a).toBe(b)
  })
})

// ============================================================================
// T-2.2:env Unix 绝对路径 → 短路返回
// ============================================================================

describe('getDefaultConfigPath · T-2.2 env 短路', () => {
  it('Unix 绝对路径 → 直接返回 env 值', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '/etc/aidevspace/config.yaml'
    expect(getDefaultConfigPath()).toBe('/etc/aidevspace/config.yaml')
  })

  it('多次调用结果一致(env 短路稳定)', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '/srv/aidevspace/config.yaml'
    expect(getDefaultConfigPath()).toBe('/srv/aidevspace/config.yaml')
    expect(getDefaultConfigPath()).toBe('/srv/aidevspace/config.yaml')
  })

  it('env 值不会被 trim 或 normalize(原样返回)', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '  /etc/aidevspace/config.yaml  '
    // 整个 env(包含两端空格)是有效路径,原样返回 —— 这是部署者
    // 自己保证的事,函数不该擅自 normalize
    expect(getDefaultConfigPath()).toBe('  /etc/aidevspace/config.yaml  ')
  })
})

// ============================================================================
// T-2.3:env Windows 绝对路径 → 原样返回
// ============================================================================

describe('getDefaultConfigPath · T-2.3 Windows 路径', () => {
  it('Windows 反斜杠路径 → 原样返回', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = 'C:\\Users\\Alice\\.aidevspace\\config.yaml'
    expect(getDefaultConfigPath()).toBe('C:\\Users\\Alice\\.aidevspace\\config.yaml')
  })

  it('Windows 混合斜杠路径 → 原样返回', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = 'D:/aidevspace/config.yaml'
    expect(getDefaultConfigPath()).toBe('D:/aidevspace/config.yaml')
  })

  it('UNC 路径 → 原样返回', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '\\\\fileserver\\share\\aidevspace\\config.yaml'
    expect(getDefaultConfigPath()).toBe('\\\\fileserver\\share\\aidevspace\\config.yaml')
  })
})

// ============================================================================
// T-2.4:env 空字符串 → fallback 到 homedir()
// ============================================================================

describe('getDefaultConfigPath · T-2.4 空字符串', () => {
  it('空字符串 → fallback 到包含 \'.aidevspace/config.yaml\' 的绝对路径', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = ''
    const result = getDefaultConfigPath()
    expect(result).toContain('.aidevspace')
    expect(result).toMatch(/config\.yaml$/)
    expect(isAbsolute(result)).toBe(true)
  })

  it('空字符串 fallback ≠ 空字符串返回', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = ''
    expect(getDefaultConfigPath()).not.toBe('')
  })
})

// ============================================================================
// T-2.5:env 全空白 → fallback 到 homedir()
// ============================================================================

describe('getDefaultConfigPath · T-2.5 全空白', () => {
  it('单空格 → fallback 到绝对路径', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = ' '
    const result = getDefaultConfigPath()
    expect(result).not.toBe(' ')
    expect(isAbsolute(result)).toBe(true)
  })

  it('多空格 + tab + 换行 → fallback 到绝对路径', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '   \t\n  '
    const result = getDefaultConfigPath()
    expect(result).not.toBe('   \t\n  ')
    expect(isAbsolute(result)).toBe(true)
  })
})

// ============================================================================
// T-2.6:返回值跨平台绝对路径契约
// ============================================================================

describe('getDefaultConfigPath · T-2.6 跨平台绝对路径契约', () => {
  it('env 设了 Unix 路径 → 返回值是绝对路径', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '/etc/aidevspace/config.yaml'
    expect(isAbsolute(getDefaultConfigPath())).toBe(true)
  })

  it('env 设了 Windows 路径 → 返回值是绝对路径', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = 'C:\\aidevspace\\config.yaml'
    expect(isAbsolute(getDefaultConfigPath())).toBe(true)
  })

  it('env 未设 → 返回值是绝对路径(fallback join(homedir(), ...))', () => {
    delete process.env.AIDEVSPACE_CONFIG_PATH
    expect(isAbsolute(getDefaultConfigPath())).toBe(true)
  })

  it('env 空字符串 → 返回值是绝对路径(fallback 同上)', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = ''
    expect(isAbsolute(getDefaultConfigPath())).toBe(true)
  })

  it('env 全空白 → 返回值是绝对路径(fallback 同上)', () => {
    process.env.AIDEVSPACE_CONFIG_PATH = '   '
    expect(isAbsolute(getDefaultConfigPath())).toBe(true)
  })
})
