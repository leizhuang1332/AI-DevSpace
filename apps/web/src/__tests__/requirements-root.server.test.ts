/**
 * requirements-root.server 测试
 * (issue: zone-data-fidelity-fixes · 05 · D-6.1 / next-build-homedir-fix · 01)
 *
 * 验收点(对应 zone-data-fidelity-fixes PRD T-2.5):
 * - 注入 configPath 含 `workspaceRoot: <fixture>` → 返回 expandHome(workspaceRoot)
 * - config 无 workspaceRoot 字段 → fallback AIDEVSPACE_HOME
 * - config 文件不存在 + AIDEVSPACE_HOME 不存在 → fallback `cwd + ../..`
 * - config 不存在时静默降级,不抛错
 *
 * 默认 config 路径现在来自 `getDefaultConfigPath()`(next-build-homedir-fix
 * PRD D-1),env `AIDEVSPACE_CONFIG_PATH` 存在时被短路;本文件测试 env 全部
 * 干净,默认行为验证见 `requirements-root-config-path.test.ts`。
 *
 * 测试用 `os.tmpdir()` 隔离,afterEach 清理 fixture + 还原 env。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { platform } from 'node:process'
import {
  resolveRequirementsRoot,
  expandHome,
  type ResolveRequirementsRootOptions,
} from '@/lib/requirements-root.server'

/**
 * `normalizeWorkspaceRoot` 走 `process.platform`(live 读取)。
 * 在 POSIX runner 上测 win32 行为 → 必须 stub `process.platform`。
 * `Object.defineProperty(..., { configurable: true })` 是 vitest 下能干净还原
 * 的写法(afterEach 复原)。
 */
const ORIGINAL_PLATFORM = platform
function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

// ============================================================================
// fixture 隔离 + env 隔离
// ============================================================================

let tmpRoot: string
const ORIGINAL_AIDEVSPACE_HOME = process.env.AIDEVSPACE_HOME
const ORIGINAL_AIDEVSPACE_CONFIG_PATH = process.env.AIDEVSPACE_CONFIG_PATH

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidevspace-req-root-'))
  // 关键:每个用例从干净 env 出发,避免宿主 shell 里设置的 AIDEVSPACE_HOME
  // 或 build script 注入的 AIDEVSPACE_CONFIG_PATH 串扰
  delete process.env.AIDEVSPACE_HOME
  delete process.env.AIDEVSPACE_CONFIG_PATH
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
  if (ORIGINAL_AIDEVSPACE_CONFIG_PATH === undefined) {
    delete process.env.AIDEVSPACE_CONFIG_PATH
  } else {
    process.env.AIDEVSPACE_CONFIG_PATH = ORIGINAL_AIDEVSPACE_CONFIG_PATH
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
    // 断言必须跨平台:expandHome 走 `join()`,Windows 下产出 `C:\...\.aidevspace\requirements`,
    // 所以不能用 `startsWith('/')` 判绝对路径、也不能用 `/` 硬编码分隔符。
    expect(expanded.split(sep).join('/')).toMatch(/\/\.aidevspace\/requirements$/)
    expect(isAbsolute(expanded)).toBe(true)
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
    expect(isAbsolute(root)).toBe(true)
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

  it('不传 options 时仍能工作(默认 configPath 由 getDefaultConfigPath() 解析)', () => {
    // 默认 configPath(env 已干净 → fallback `join(homedir(), '.aidevspace', 'config.yaml')`)
    // 解析失败 + AIDEVSPACE_HOME 未设 → 走到 cwd fallback
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

// ============================================================================
// 跨平台归一化:Git Bash mingw 路径(/c/Users/...) → Windows 原生 (C:\Users\...)
// ============================================================================
//
// 用户在 Git Bash 里 `export AIDEVSPACE_HOME=$HOME/.aidevspace`,Node.js 和
// git.exe 都会把 `/c/foo` 当 drive-relative,落到 `<cwd_drive>:\c\...`。
// 此处验证 `resolveRequirementsRoot` 的两层(env / config)都会自动归一化。
//
// 现状:config.yaml 直接写 mingw 路径(`/c/Users/...`)在 win32 上被
// `readWorkspaceRootFromConfig` 视为非绝对路径返回 null(详见 path.isAbsolute
// 行为)→ 实际触发归一化的入口是 env 层。下面的 env case 已覆盖本 bug 场景。
// ============================================================================

describe('resolveRequirementsRoot · win32 视角下 mingw 路径归一化', () => {
  beforeEach(() => {
    stubPlatform('win32')
  })

  afterEach(() => {
    stubPlatform(ORIGINAL_PLATFORM)
  })

  it('AIDEVSPACE_HOME = /c/Users/me/aidev → C:\\Users\\me\\aidev(env 层)', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = '/c/Users/me/aidev'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('C:\\Users\\me\\aidev')
  })

  it('AIDEVSPACE_HOME = /c/Users/Lorcan/.aidevspace → C:\\Users\\Lorcan\\.aidevspace(本 bug 场景)', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = '/c/Users/Lorcan/.aidevspace'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('C:\\Users\\Lorcan\\.aidevspace')
  })

  it('AIDEVSPACE_HOME 盘符大写 /D/Users/foo → D:\\Users\\foo', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = '/D/Users/foo'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('D:\\Users\\foo')
  })

  it('AIDEVSPACE_HOME = C:\\Users\\me\\aidev 原样返回(回归:已 native 路径不被双重转义)', () => {
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = 'C:\\Users\\me\\aidev'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('C:\\Users\\me\\aidev')
  })

  it('AIDEVSPACE_HOME = /tmp/fake-root 在 win32 上原样返回(/tmp 后跟 p,不是 mingw 盘符)', () => {
    // 回归:不要把所有 / 开头的路径都当 mingw 路径 — /tmp 不匹配 ^/[a-zA-Z]/,
    // 必须原样返回,避免误把 /tmp 当作 /t/mp 的盘符路径。
    const configPath = join(tmpRoot, 'not-exists-config.yaml')
    process.env.AIDEVSPACE_HOME = '/tmp/fake-root'

    const root = resolveRequirementsRoot({ configPath })

    expect(root).toBe('/tmp/fake-root')
  })
})