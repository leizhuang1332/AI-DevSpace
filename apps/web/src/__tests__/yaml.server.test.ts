/**
 * yaml.server 解析器单元测试
 * (issue: zone-data-fidelity-fixes · 05 · D-6.2)
 *
 * 抽出原 designing.server.ts 的 parseFlatYamlMap / parseNestedBlock /
 * stripQuotes,行为不变;新增命名 `parseFlatMap` 作为顶层导出的"标量专用"别名,
 * 因为 requirements-root 只需要 `workspaceRoot: <path>` 这种 flat scalar,
 * 用 nested block 解析反而是过度授权(误把缩进后的字段当成 workspaceRoot 字段)。
 *
 * 测试范围:
 * - parseFlatMap: scalar 字段提取(config.yaml / meta.yaml 场景)
 * - parseNestedBlock: 完整版本(design/ 下 4 个 yaml 场景,保留以防 regression)
 * - parseListYaml: list 入口 + entry 适配器
 * - stripQuotes: 单/双引号剥离
 */

import { describe, it, expect } from 'vitest'
import {
  parseFlatMap,
  parseNestedBlock,
  parseListYaml,
  stripQuotes,
} from '@/lib/yaml.server'

// ============================================================================
// parseFlatMap —— 用于 config.yaml / meta.yaml 这种 flat scalar 场景
// ============================================================================

describe('parseFlatMap', () => {
  it('提取单一顶层 key 下的标量字段(config.yaml 的 workspaceRoot 场景)', () => {
    const map = parseFlatMap('workspaceRoot: /tmp/x\n', 'workspaceRoot')
    expect(map).toEqual({ workspaceRoot: '/tmp/x' })
  })

  it('提取多个标量字段(meta.yaml 的 id / title / createdAt 场景)', () => {
    const raw = 'id: req-007-test托尔斯泰\ntitle: test托尔斯泰\ncreatedAt: 2026-07-18T02:03:42.710Z\n'
    const map = parseFlatMap(raw, 'title')
    // 返回的 map 包含 title block 下的所有标量字段(不限于 topKey 名)
    expect(map).toEqual({
      id: 'req-007-test托尔斯泰',
      title: 'test托尔斯泰',
      createdAt: '2026-07-18T02:03:42.710Z',
    })
  })

  it('topKey 不存在 → null(不抛错)', () => {
    const map = parseFlatMap('foo: bar\n', 'workspaceRoot')
    expect(map).toBeNull()
  })

  it('多顶层 key 时只返回指定 topKey 下的字段(顶层 block 结束判定)', () => {
    const raw = [
      'first:',
      '  workspaceRoot: /tmp/x',
      'second:',
      '  workspaceRoot: /tmp/y',
      '',
    ].join('\n')
    const map = parseFlatMap(raw, 'first')
    expect(map).toEqual({ workspaceRoot: '/tmp/x' })
  })

  it('多顶层 key 时,要求 second 块的字段也能正确提取', () => {
    const raw = [
      'first:',
      '  workspaceRoot: /tmp/x',
      'second:',
      '  workspaceRoot: /tmp/y',
      '',
    ].join('\n')
    const map = parseFlatMap(raw, 'second')
    expect(map).toEqual({ workspaceRoot: '/tmp/y' })
  })

  it('带引号的字段值会被去除引号("foo" → foo)', () => {
    const map = parseFlatMap('workspaceRoot: "/Users/Ray/.aidevspace"\n', 'workspaceRoot')
    expect(map).toEqual({ workspaceRoot: '/Users/Ray/.aidevspace' })
  })

  it('单引号同样去除(后端写入端可能用 \'/Users/Ray/...\')', () => {
    const map = parseFlatMap("title: 'test需求'\n", 'title')
    expect(map).toEqual({ title: 'test需求' })
  })

  it('空字符串输入 → null(非空顶层 key 都找不到)', () => {
    expect(parseFlatMap('', 'workspaceRoot')).toBeNull()
  })

  it('只有注释的行 → null', () => {
    expect(parseFlatMap('# only a comment\n', 'workspaceRoot')).toBeNull()
  })

  it('多个顶层 scalar 字段都被收集(config.yaml 场景,顶层都是 scalar)', () => {
    // 顶层都是 scalar 时,topKey 作为"存在性校验",返回**所有**顶层 scalar 字段
    // (对齐 meta.yaml 行为: meta.yaml 也是 id/title/createdAt 三个顶层 scalar)
    // 调用方只取 `result[topKey]`,其他字段无关但收集到 result 里也不影响
    const raw = ['theme: system', 'workspaceRoot: /Users/Ray/.aidevspace', ''].join('\n')
    const map = parseFlatMap(raw, 'workspaceRoot')
    expect(map).toEqual({
      theme: 'system',
      workspaceRoot: '/Users/Ray/.aidevspace',
    })
  })

  it('多个顶层 scalar:调用方只取关心的字段(workspaceRoot),其他字段被忽略也无副作用', () => {
    const raw = [
      'theme: system',
      'workspaceRoot: /Users/Ray/.aidevspace',
      'agentEndpoint: http://localhost:7777',
      '',
    ].join('\n')
    const map = parseFlatMap(raw, 'workspaceRoot')
    expect(map).not.toBeNull()
    // 只关心 workspaceRoot,其他字段忽略(实现细节可收集可不收集,但调用方契约只关心 workspaceRoot)
    expect(map!.workspaceRoot).toBe('/Users/Ray/.aidevspace')
  })
})

// ============================================================================
// parseNestedBlock —— 用于 design/ 下 4 个 yaml(stage / candidates / design_doc / tradeoff)
// 保留以便 regression;新代码若只需 scalar,优先用 parseFlatMap
// ============================================================================

describe('parseNestedBlock', () => {
  it('提取嵌套标量字段(stage.yaml 场景)', () => {
    const raw = [
      'stage:',
      '  badge: ④ 设计',
      '  title: 退款功能优化 · DESIGNING',
      '  meta: 等选 3 / 3',
      '',
    ].join('\n')
    const block = parseNestedBlock(raw, 'stage')
    expect(block).toEqual({
      badge: '④ 设计',
      title: '退款功能优化 · DESIGNING',
      meta: '等选 3 / 3',
    })
  })

  it('topKey 不存在 → null', () => {
    const block = parseNestedBlock('other:\n  foo: bar\n', 'stage')
    expect(block).toBeNull()
  })

  it('解析顶层 list(candidates 场景),list 直接挂在 result[key]', () => {
    const raw = [
      'candidates:',
      '  - id: A',
      '    title: 同步单阶段',
      '  - id: B',
      '    title: 异步多阶段',
      '',
    ].join('\n')
    const block = parseNestedBlock(raw, 'candidates')
    expect(Array.isArray(block?.candidates)).toBe(true)
    expect((block!.candidates as Record<string, unknown>[]).length).toBe(2)
    expect((block!.candidates as Record<string, unknown>[])[0]).toEqual({
      id: 'A',
      title: '同步单阶段',
    })
  })

  it('解析块字符串(`markdown: |` 后跟 4 空格缩进行)', () => {
    const raw = [
      'design_doc:',
      '  title: x',
      '  markdown: |',
      '    ## 问题背景',
      '    ## 范围',
      '',
    ].join('\n')
    const block = parseNestedBlock(raw, 'design_doc')
    expect(block?.markdown).toBe('## 问题背景\n## 范围')
  })
})

// ============================================================================
// parseListYaml —— parseNestedBlock + entry adapter 的组合(designing.server.ts 内部用)
// ============================================================================

describe('parseListYaml', () => {
  it('提取顶层 list 并逐条 entry 适配', () => {
    interface Item {
      id: string
      title: string
    }
    const raw = [
      'candidates:',
      '  - id: A',
      '    title: foo',
      '  - id: B',
      '    title: bar',
      '',
    ].join('\n')
    const items = parseListYaml<Item>(raw, 'candidates', (map) => {
      if (typeof map.id !== 'string' || typeof map.title !== 'string') return null
      return { id: map.id, title: map.title }
    })
    expect(items).toEqual([
      { id: 'A', title: 'foo' },
      { id: 'B', title: 'bar' },
    ])
  })

  it('topKey 不存在 → 返回空数组', () => {
    const items = parseListYaml('foo: bar\n', 'candidates', (map) => map)
    expect(items).toEqual([])
  })

  it('entry 适配器返回 null → 跳过该 entry(不污染其他 entry)', () => {
    interface Item {
      id: string
    }
    const raw = [
      'candidates:',
      '  - id: A',
      '  - id: B',
      '',
    ].join('\n')
    const items = parseListYaml<Item>(raw, 'candidates', (map) => {
      // 只接受 A,跳过 B
      if (map.id === 'A') return { id: 'A' }
      return null
    })
    expect(items).toEqual([{ id: 'A' }])
  })
})

// ============================================================================
// stripQuotes —— 引号剥离原语
// ============================================================================

describe('stripQuotes', () => {
  it('双引号包裹 → 去掉两端', () => {
    expect(stripQuotes('"hello"')).toBe('hello')
  })

  it('单引号包裹 → 去掉两端', () => {
    expect(stripQuotes("'hello'")).toBe('hello')
  })

  it('无引号 → 原样返回', () => {
    expect(stripQuotes('hello')).toBe('hello')
  })

  it('只有左引号 → 原样返回(长度不足 2)', () => {
    expect(stripQuotes('"')).toBe('"')
    expect(stripQuotes("'")).toBe("'")
  })

  it('不匹配(左单右双)→ 原样返回', () => {
    expect(stripQuotes('"hello\'')).toBe('"hello\'')
  })

  it('空字符串 → 原样返回', () => {
    expect(stripQuotes('')).toBe('')
  })

  it('中文内容带引号', () => {
    expect(stripQuotes('"test托尔斯泰"')).toBe('test托尔斯泰')
  })
})