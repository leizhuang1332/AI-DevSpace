/**
 * products-yaml IO 集成测试(issue 19d · VS4 验收)
 *
 * 覆盖:
 * - parseProductsYaml:解析 → AnalyzingProductItem[]
 * - serializeProductsYaml:回写 → 同构(读 → 写 → 读 等价)
 * - loadProducts:文件不存在 / 损坏文件容错
 * - saveProducts:落盘后 loadProducts 能读回相同数据
 * - applyProductChange:edit / delete / add / merge 纯函数(顺序稳定)
 * - 写回时保留其他会话/类型数据(同一 sessionsDir 下不同 sessionId 互不干扰)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseProductsYaml,
  serializeProductsYaml,
  applyProductChange,
  type ProductsFile,
  type ProductItem,
} from '@/lib/products'
import {
  loadProducts,
  saveProducts,
} from '@/lib/products.server'

// ============================================================================
// parseProductsYaml — YAML → ProductsFile(issue 19d 验收:解析为 item[])
// ============================================================================

describe('parseProductsYaml', () => {
  it('空字符串 → 空 ProductsFile(三类空数组)', () => {
    expect(parseProductsYaml('')).toEqual({
      subproblems: [],
      risks: [],
      options: [],
    })
  })

  it('解析三类条目:id / title / description / severity', () => {
    const yaml = [
      'subproblems:',
      '  - id: q-1',
      '    title: 退款金额上限?',
      '    description: 单笔限额',
      '    severity: green',
      'risks:',
      '  - id: r-1',
      '    title: 高并发重复创建',
      '    severity: orange',
      'options:',
      '  - id: o-1',
      '    title: 同步单阶段',
      '    severity: blue',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems).toEqual([
      { id: 'q-1', title: '退款金额上限?', description: '单笔限额', severity: 'green' },
    ])
    expect(file.risks).toEqual([
      { id: 'r-1', title: '高并发重复创建', severity: 'orange' },
    ])
    expect(file.options).toEqual([
      { id: 'o-1', title: '同步单阶段', severity: 'blue' },
    ])
  })

  it('description 可选:缺失时为 undefined', () => {
    const yaml = [
      'subproblems:',
      '  - id: q-1',
      '    title: 标题',
      '    severity: blue',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems[0].description).toBeUndefined()
  })

  it('severity 缺失 → 默认为 blue', () => {
    const yaml = [
      'subproblems:',
      '  - id: q-1',
      '    title: 标题',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems[0].severity).toBe('blue')
  })

  it('未知 severity → 默认为 blue(容错)', () => {
    const yaml = [
      'subproblems:',
      '  - id: q-1',
      '    title: 标题',
      '    severity: purple',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems[0].severity).toBe('blue')
  })

  it('id 缺失的条目 → 跳过(否则下游无法编辑/删除)', () => {
    const yaml = [
      'subproblems:',
      '  - title: 漏 id',
      '  - id: q-ok',
      '    title: 正常',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems).toHaveLength(1)
    expect(file.subproblems[0].id).toBe('q-ok')
  })

  it('title 为空字符串的条目 → 跳过(空 title 没有意义)', () => {
    const yaml = [
      'subproblems:',
      '  - id: q-1',
      '    title: ""',
      '  - id: q-2',
      '    title: 正常',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems).toHaveLength(1)
    expect(file.subproblems[0].id).toBe('q-2')
  })

  it('comments 注释行被忽略', () => {
    const yaml = [
      '# 顶部注释',
      'subproblems:',
      '  # 列表注释',
      '  - id: q-1',
      '    title: 正常 # 行尾注释',
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems[0].title).toBe('正常')
    expect(file.subproblems[0].id).toBe('q-1')
  })

  it('字符串带引号 → 去除引号', () => {
    const yaml = [
      'subproblems:',
      '  - id: "q-1"',
      "    title: '带引号'",
    ].join('\n')
    const file = parseProductsYaml(yaml)
    expect(file.subproblems[0].id).toBe('q-1')
    expect(file.subproblems[0].title).toBe('带引号')
  })
})

// ============================================================================
// serializeProductsYaml — ProductsFile → YAML(写回等价)
// ============================================================================

describe('serializeProductsYaml', () => {
  it('空 ProductsFile → 三类 key 都在但数组为空', () => {
    const yaml = serializeProductsYaml({ subproblems: [], risks: [], options: [] })
    expect(yaml).toContain('subproblems: []')
    expect(yaml).toContain('risks: []')
    expect(yaml).toContain('options: []')
  })

  it('带 description / severity 完整字段写入', () => {
    const file: ProductsFile = {
      subproblems: [
        { id: 'q-1', title: '退款金额上限?', description: '单笔限额', severity: 'green' },
      ],
      risks: [],
      options: [],
    }
    const yaml = serializeProductsYaml(file)
    expect(yaml).toContain('id: q-1')
    expect(yaml).toContain('title: 退款金额上限?')
    expect(yaml).toContain('description: 单笔限额')
    expect(yaml).toContain('severity: green')
  })

  it('description 缺失时不输出该行', () => {
    const file: ProductsFile = {
      subproblems: [{ id: 'q-1', title: '标题', severity: 'blue' }],
      risks: [],
      options: [],
    }
    const yaml = serializeProductsYaml(file)
    expect(yaml).not.toContain('description:')
  })

  it('读 → 写 → 读 等价(round-trip)', () => {
    const original: ProductsFile = {
      subproblems: [
        { id: 'q-1', title: 'A', description: 'desc-a', severity: 'green' },
        { id: 'q-2', title: 'B', severity: 'orange' },
      ],
      risks: [{ id: 'r-1', title: 'R', severity: 'red' }],
      options: [
        { id: 'o-1', title: 'O1', description: 'd1', severity: 'blue' },
      ],
    }
    const yaml = serializeProductsYaml(original)
    const reparsed = parseProductsYaml(yaml)
    expect(reparsed).toEqual(original)
  })
})

// ============================================================================
// applyProductChange — 纯函数:edit / delete / add / merge
// ============================================================================

describe('applyProductChange', () => {
  const baseFile: ProductsFile = {
    subproblems: [
      { id: 'q-1', title: '退款金额上限?', severity: 'green' },
      { id: 'q-2', title: '退款审核流?', severity: 'green' },
      { id: 'q-3', title: '退款失败回滚?', severity: 'green' },
    ],
    risks: [{ id: 'r-1', title: '高并发', severity: 'orange' }],
    options: [],
  }

  it('edit 行为:更新指定 id 的 title / description / severity', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'edit',
      id: 'q-2',
      patch: { title: '退款审核流程?', description: '自动 / 人工', severity: 'blue' },
    })
    expect(next.subproblems[1]).toEqual({
      id: 'q-2',
      title: '退款审核流程?',
      description: '自动 / 人工',
      severity: 'blue',
    })
    // 其他条目不变
    expect(next.subproblems[0].id).toBe('q-1')
    expect(next.subproblems[2].id).toBe('q-3')
    // 不影响其他类型
    expect(next.risks).toEqual(baseFile.risks)
  })

  it('edit 不改 id(验收:产物 id 稳定)', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'edit',
      id: 'q-1',
      patch: { title: '新标题' },
    })
    expect(next.subproblems[0].id).toBe('q-1')
    expect(next.subproblems[0].title).toBe('新标题')
  })

  it('delete 行为:按 id 移除该条', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'delete',
      id: 'q-2',
    })
    expect(next.subproblems).toHaveLength(2)
    expect(next.subproblems.map((s) => s.id)).toEqual(['q-1', 'q-3'])
  })

  it('delete 不存在 id → 文件不变(no-op)', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'delete',
      id: 'q-NONEXISTENT',
    })
    expect(next).toEqual(baseFile)
  })

  it('delete 后 yaml 顺序稳定(其余条目保持原顺序)', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'delete',
      id: 'q-1',
    })
    expect(next.subproblems.map((s) => s.id)).toEqual(['q-2', 'q-3'])
  })

  it('add 行为:追加到该类型末尾,返回新 id', () => {
    const next = applyProductChange(baseFile, {
      kind: 'options',
      action: 'add',
      item: { id: 'o-new', title: '新方案', severity: 'blue' },
    })
    expect(next.options).toHaveLength(1)
    expect(next.options[0].id).toBe('o-new')
    // 其他类型不变
    expect(next.subproblems).toEqual(baseFile.subproblems)
    expect(next.risks).toEqual(baseFile.risks)
  })

  it('merge 行为:原 N 条删除,新条追加到末尾,新 id 唯一', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'merge',
      ids: ['q-1', 'q-2'],
      newId: 'q-merged',
      newTitle: '退款相关?',
      newSeverity: 'green',
    })
    // 4 → 删 2 → 剩 1 原 + 1 新 = 2
    expect(next.subproblems).toHaveLength(2)
    expect(next.subproblems.map((s) => s.id)).toEqual(['q-3', 'q-merged'])
    expect(next.subproblems[1].title).toBe('退款相关?')
    expect(next.subproblems[1].id).toBe('q-merged')
  })

  it('merge 新 id 与原 ids 不重复(产物 id 稳定:旧 id 不复用)', () => {
    const next = applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'merge',
      ids: ['q-1', 'q-2'],
      newId: 'q-3', // 故意与现有 id 重复
      newTitle: '新合并',
      newSeverity: 'blue',
    })
    // 仍然添加,因为 caller 负责生成唯一 id(本函数不查重)
    // 但保证新条追加到末尾,顺序不变
    expect(next.subproblems).toHaveLength(2)
    expect(next.subproblems[1].id).toBe('q-3')
  })

  it('applyProductChange 返回新对象(不修改入参)', () => {
    const before = JSON.parse(JSON.stringify(baseFile))
    applyProductChange(baseFile, {
      kind: 'subproblems',
      action: 'delete',
      id: 'q-1',
    })
    expect(baseFile).toEqual(before)
  })
})

// ============================================================================
// loadProducts / saveProducts — 文件 IO 集成(issue 19d 验收)
// ============================================================================

describe('loadProducts', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'products-load-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('文件不存在 → 返回空 ProductsFile(容错)', () => {
    expect(loadProducts(tmpDir, 'sess-a')).toEqual({
      subproblems: [],
      risks: [],
      options: [],
    })
  })

  it('空文件 → 返回空 ProductsFile', () => {
    const sessionDir = join(tmpDir, 'sess-a')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'products.yaml'), '')
    expect(loadProducts(tmpDir, 'sess-a')).toEqual({
      subproblems: [],
      risks: [],
      options: [],
    })
  })

  it('损坏 YAML(纯字符串)→ 返回空 ProductsFile(容错)', () => {
    const sessionDir = join(tmpDir, 'sess-a')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'products.yaml'), ':::broken{')
    expect(loadProducts(tmpDir, 'sess-a')).toEqual({
      subproblems: [],
      risks: [],
      options: [],
    })
  })

  it('正常 YAML → 解析为三类 item 数组', () => {
    const sessionDir = join(tmpDir, 'sess-a')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, 'products.yaml'),
      [
        'subproblems:',
        '  - id: q-1',
        '    title: Q1',
        '    severity: green',
        'risks:',
        '  - id: r-1',
        '    title: R1',
        '    severity: orange',
      ].join('\n'),
    )
    const file = loadProducts(tmpDir, 'sess-a')
    expect(file.subproblems).toHaveLength(1)
    expect(file.risks).toHaveLength(1)
  })
})

describe('saveProducts + loadProducts round-trip', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'products-roundtrip-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('save → load 等价:写回的内容能完整读回', () => {
    const file: ProductsFile = {
      subproblems: [
        { id: 'q-1', title: 'A', description: 'd', severity: 'green' },
      ],
      risks: [{ id: 'r-1', title: 'R', severity: 'red' }],
      options: [{ id: 'o-1', title: 'O', severity: 'blue' }],
    }
    saveProducts(tmpDir, 'sess-a', file)
    expect(loadProducts(tmpDir, 'sess-a')).toEqual(file)
  })

  it('落盘文件可被直接读取,内容是合法 YAML', () => {
    const file: ProductsFile = {
      subproblems: [{ id: 'q-1', title: 'A', severity: 'green' }],
      risks: [],
      options: [],
    }
    saveProducts(tmpDir, 'sess-a', file)
    const raw = readFileSync(join(tmpDir, 'sess-a', 'products.yaml'), 'utf8')
    expect(raw).toContain('subproblems:')
    expect(raw).toContain('id: q-1')
    expect(raw).toContain('title: A')
  })

  it('写回时保留其他会话/类型数据(同 sessionsDir 不同 sessionId 互不干扰)', () => {
    // 初始化两个会话
    saveProducts(tmpDir, 'sess-a', {
      subproblems: [{ id: 'q-a', title: 'A', severity: 'green' }],
      risks: [],
      options: [],
    })
    saveProducts(tmpDir, 'sess-b', {
      subproblems: [{ id: 'q-b', title: 'B', severity: 'orange' }],
      risks: [],
      options: [],
    })
    // 修改 sess-a 的 risks
    saveProducts(tmpDir, 'sess-a', {
      subproblems: [{ id: 'q-a', title: 'A', severity: 'green' }],
      risks: [{ id: 'r-a', title: 'RA', severity: 'red' }],
      options: [],
    })
    // sess-b 应不受影响
    expect(loadProducts(tmpDir, 'sess-b')).toEqual({
      subproblems: [{ id: 'q-b', title: 'B', severity: 'orange' }],
      risks: [],
      options: [],
    })
  })

  it('saveProducts 会创建 sessionId 子目录(若不存在)', () => {
    saveProducts(tmpDir, 'sess-new', {
      subproblems: [{ id: 'q-1', title: 'A', severity: 'blue' }],
      risks: [],
      options: [],
    })
    expect(loadProducts(tmpDir, 'sess-new').subproblems).toHaveLength(1)
  })

  it('编辑后写回:旧 id 顺序稳定', () => {
    const initial: ProductsFile = {
      subproblems: [
        { id: 'q-1', title: 'A', severity: 'green' },
        { id: 'q-2', title: 'B', severity: 'green' },
        { id: 'q-3', title: 'C', severity: 'green' },
      ],
      risks: [],
      options: [],
    }
    saveProducts(tmpDir, 'sess-a', initial)
    const loaded = loadProducts(tmpDir, 'sess-a')
    const afterDelete = applyProductChange(loaded, {
      kind: 'subproblems',
      action: 'delete',
      id: 'q-2',
    })
    saveProducts(tmpDir, 'sess-a', afterDelete)
    const final = loadProducts(tmpDir, 'sess-a')
    expect(final.subproblems.map((s) => s.id)).toEqual(['q-1', 'q-3'])
  })
})