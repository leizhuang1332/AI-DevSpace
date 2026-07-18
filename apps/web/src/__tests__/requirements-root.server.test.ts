/**
 * requirements-root.server 测试
 * (issue: zone-data-fidelity-fixes · 05 · D-6.1)
 *
 * 验收点(对应 PRD T-2.5):
 * - 注入 configPath 含 `workspaceRoot: <fixture>` → 返回 expandHome(workspaceRoot)
 * - config 无 workspaceRoot 字段 → fallback AIDEVSPACE_HOME
 * - config 文件不存在 + AIDEVSPACE_HOME 不存在 → fallback `cwd + ../..`
 * - config 不存在时静默降级,不抛错
 *
 * 测试用 `os.tmpdir()` 隔离,afterEach 清理 fixture + 还原 env。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  resolveRequirementsRoot,
  expandHome,
  type ResolveRequirementsRootOptions,
} from '@/lib/requirements-root.server'

// ============================================================================
// fixture 隔离 + env 隔离
// ============================================================================

let tmpRoot: string
const ORIGINAL_AIDEVSPACE_HOME = process.env.AIDEVSPACE_HOME

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-req-root-'))
  // 关键:每个用例从干净 env 出发,避免宿主 shell 里设置的 AIDEVSPACE_HOME 串扰
  delete process.env.AIDEVSPACE_HOME
})

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
  }
  if (ORIGINAL_AIDEVSPACE_HOME === undefined) {
    delete process.env.AIDEVSPACE_HOME
  } else {
    process.env.AIDEVSPACE_HOME = ORIGINAL_AIDEVSPACE_HOME
  }
})

/** 在 tmpRoot 下写 config.yaml,内容由 caller 决定 */
function writeConfig(content: string): string {
  writeFileSync(join(tmpRoot, 'config.yaml'), content, 'utf8')
  return join(tmpRoot, 'config.yaml')
}

// ============================================================================
// expandHome 单元测试 —— ~ 展开原语
// ============================================================================

describe('expandHome', () => {
  it('~ 开头 → 用 homedir() 替换', () => {
    expect(expandHome('~/.aidevspace')).toBe(join(process.env.HOME || '/tmp', '.aidevspace'))
  })

  it('~ 后跟子路径(如 ~/.aidevspace/requirements)→ 正确展开', () => {
    const expanded = expandHome('~/.aidevspace/requirements')
    expect(expanded.endsWith('/.aidevspace/requirements')).toBe(true)
    expect(expanded.startsWith('/')).toBe(true) // 绝对路径
  })

  it('非 ~ 开头 → 原样返回(相对路径)', () => {
    expect(expandHome('relative/path')).toBe('relative/path')
  })

  it('非 ~ 开头 → 原样返回(绝对路径)', () => {
    expect(expandHome('/tmp/fake-root')).toBe('/tmp/fake-root')
  })

  it('单独 ~ → 用 homedir()(boundary case)', () => {
    expect(expandHome('~')).toBe(process.env.HOME || '/tmp')
  })

  it('~~ 开头(两个 ~)→ 原样返回(不是 ~ 展开场景)', () => {
    // 用户极不可能写 ~~,但要保证行为合理 —— 我们只看首字符,首字符是 ~ 但
    // 第二字符也是 ~ 不应该走 join,避免产生 `join(home, '~xxx')` 这种怪路径
    // 实现选择:只展开严格 `~/...` 或单独的 `~`;其他保留原样
    const result = expandHome('~~weird')
    expect(result).toBe('~~weird')
  })
})

// ============================================================================
// 第一层:config.yaml 命中(workspaceRoot 存在)
// ============================================================================

describe('resolveRequirementsRoot · 第一层 config.yaml', () => {
  it('config.yaml 含 workspaceRoot 标量 → 返回 expandHome(workspaceRoot)', () => {
    const configPath = writeConfig('workspaceRoot: /tmp/fake-root\n')

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/tmp/fake-root')
  })

  it('config.yaml 含 workspaceRoot 标量 + AIDEVSPACE_HOME 也设了 → config.yaml 优先', () => {
    const configPath = writeConfig('workspaceRoot: /tmp/fake-root\n')
    process.env.AIDEVSPACE_HOME = '/env-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/tmp/fake-root')
  })

  it('config.yaml workspaceRoot 用 ~ 路径 → 展开为绝对路径', () => {
    const configPath = writeConfig('workspaceRoot: ~/.aidevspace\n')

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toMatch(/\.aidevspace$/)
    expect(root.startsWith('/')).toBe(true)
  })

  it('config.yaml workspaceRoot 带引号 → 解析后正确(去掉引号)', () => {
    // 后端可能用 `workspaceRoot: "/Users/Ray/.aidevspace"` 这种带引号形式
    const configPath = writeConfig('workspaceRoot: "/tmp/quoted-root"\n')

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/tmp/quoted-root')
  })
})

// ============================================================================
// 第二层:config.yaml 解析失败 → fallback AIDEVSPACE_HOME
// ============================================================================

describe('resolveRequirementsRoot · 第二层 AIDEVSPACE_HOME fallback', () => {
  it('config.yaml 不存在 + AIDEVSPACE_HOME 存在 → 返回 AIDEVSPACE_HOME', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = '/env-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/env-root')
  })

  it('config.yaml 存在但无 workspaceRoot 字段 → fallback AIDEVSPACE_HOME', () => {
    // 有其他字段但没有 workspaceRoot
    const configPath = writeConfig('theme: system\nsilentWindowSeconds: 30\n')
    process.env.AIDEVSPACE_HOME = '/env-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/env-root')
  })

  it('config.yaml 为空文件 → fallback AIDEVSPACE_HOME(解析得 null)', () => {
    const configPath = writeConfig('')
    process.env.AIDEVSPACE_HOME = '/env-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/env-root')
  })

  it('config.yaml 只有注释 → fallback AIDEVSPACE_HOME', () => {
    const configPath = writeConfig('# only a comment\n')
    process.env.AIDEVSPACE_HOME = '/env-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/env-root')
  })
})

// ============================================================================
// 第三层:AIDEVSPACE_HOME 也不存在 → fallback cwd + ../..
// ============================================================================

describe('resolveRequirementsRoot · 第三层 cwd fallback', () => {
  it('config 不存在 + AIDEVSPACE_HOME 不存在 → 返回 cwd + ../..', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')

    const root = resolveRequirementsRoot({ configPath })

    // 默认 fallback:`resolve(process.cwd(), '../..')` 即 dev 时 `<repo-root>/`
    // 这里不依赖具体 cwd 内容(测试环境下 cwd 是 web/),只验契约
    expect(root).toBe(resolve(process.cwd(), '../..'))
  })

  it('config.yaml 存在但 workspaceRoot 字段为空 → fallback cwd(workspaceRoot 视为缺失)', () => {
    const configPath = writeConfig('workspaceRoot:\n') // 空值
    // AIDEVSPACE_HOME 已删除

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe(resolve(process.cwd(), '../..'))
  })
})

// ============================================================================
// 行为契约
// ============================================================================

describe('resolveRequirementsRoot · 行为契约', () => {
  it('config.yaml 不存在时静默降级,不抛错', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')

    expect(() => resolveRequirementsRoot({ configPath })).not.toThrow()
  })

  it('config.yaml 内容损坏时静默降级,不抛错', () => {
    // 二进制脏数据
    const configPath = join(tmpRoot, 'config.yaml')
    writeFileSync(configPath, '\x00\x01\x02not yaml at all\xff', 'utf8')

    expect(() => resolveRequirementsRoot({ configPath })).not.toThrow()
  })

  it('不传 options 时仍能工作(默认 configPath = ~/.aidevspace/config.yaml)', () => {
    // 默认 configPath 解析失败 + AIDEVSPACE_HOME 未设 → 走到 cwd fallback
    // 这里不断言具体值(默认 configPath 可能恰好存在 → 测宿主环境耦合)
    // 只断言不抛错 + 返回字符串
    const root = resolveRequirementsRoot()
    expect(typeof root).toBe('string')
    expect(root.length).toBeGreaterThan(0)
  })

  it('options.configPath 为 undefined → 等价于不传 options', () => {
    const opts: ResolveRequirementsRootOptions = { configPath: undefined }
    const root = resolveRequirementsRoot(opts)
    expect(typeof root).toBe('string')
    expect(root.length).toBeGreaterThan(0)
  })

  it('cwd fallback 行为(回归 ticket 01 review 抓到的 bug):cwd = apps/web/ 时返回 repo-root', () => {
    // 模拟 dev 形态:tmpRoot 下建 `apps/web/` 子目录,作为 mock cwd
    const mockCwd = join(tmpRoot, 'apps', 'web')
    require('node:fs').mkdirSync(mockCwd, { recursive: true })
    const configPath = join(tmpRoot, 'not-exists-config.yaml')

    const spy = vi.spyOn(process, 'cwd').mockReturnValue(mockCwd)
    try {
      const root = resolveRequirementsRoot({ configPath })
      // cwd + '../..' = `<tmpRoot>/apps/web/../../` = `<tmpRoot>/`
      expect(root).toBe(resolve(mockCwd, '../..'))
    } finally {
      spy.mockRestore()
    }
  })
})