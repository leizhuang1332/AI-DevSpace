/**
 * TranscriptRefParser 单测 — issue 04 / ADR-0028
 *
 * 覆盖验收项:3 种 #[id] 引用解析用例
 * - `#run-<id>` → run_id
 * - `#prd §2.3` / `#prd:2-5` 等多种分隔符 → prd_section
 * - `#asset <name>` → asset
 *
 * 额外覆盖:未知前缀 fall-through、renderRefAsReadable 链接渲染、
 * 解析位置 index 用于上层替换 / 高亮。
 */

import { describe, it, expect } from 'vitest'
import {
  parseOneToken,
  parseTranscriptRefs,
  renderRefAsReadable,
} from '../../services/board/TranscriptRefParser.js'

describe('TranscriptRefParser.parseOneToken — issue 04', () => {
  // -------------------------------------------------------------------------
  // run_id 形态
  // -------------------------------------------------------------------------

  describe('run_id form', () => {
    it('parses #run-<id>', () => {
      expect(parseOneToken('run-abc123')).toEqual({
        kind: 'run_id',
        run_id: 'run-abc123',
      })
    })

    it('accepts runs with hyphenated ids', () => {
      expect(parseOneToken('run-2026-08-06-001')).toEqual({
        kind: 'run_id',
        run_id: 'run-2026-08-06-001',
      })
    })

    it('returns null for #run with no id', () => {
      expect(parseOneToken('run')).toBeNull()
      expect(parseOneToken('run-')).toBeNull()
    })

    it('rejects ordinary words starting with r (no #r<id> alias to avoid ambiguity)', () => {
      // 设计取舍:`#r<id>` 短别名与 `react` / `runo` 等普通词在 token
      // 形态上无法区分(都形如 `r<letters>`)。spec 只要求 `#run-<id>`,
      // 故本期不接受 `#r<id>` 别名 —— 上层 caller 不要传 `#react`,
      // 期望保持 token literal,不构成 run-id 引用。
      expect(parseOneToken('react')).toBeNull()
      expect(parseOneToken('runo')).toBeNull()
      expect(parseOneToken('recipe')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // prd_section 形态
  // -------------------------------------------------------------------------

  describe('prd_section form', () => {
    it('parses #prd §2.3 (Chinese section sign + dot range)', () => {
      expect(parseOneToken('prd §2.3')).toEqual({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [2, 3],
      })
    })

    it('parses #prd:2-5 (colon + dash range)', () => {
      expect(parseOneToken('prd:2-5')).toEqual({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [2, 5],
      })
    })

    it('parses #prd 2.3 (space + dot range)', () => {
      expect(parseOneToken('prd 2.3')).toEqual({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [2, 3],
      })
    })

    it('parses single line #prd 5', () => {
      expect(parseOneToken('prd 5')).toEqual({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [5, 5],
      })
    })

    it('parses #prd §2.3-5 (full Chinese section sign syntax)', () => {
      expect(parseOneToken('prd §2.3-5')).toEqual({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [2, 5],
      })
    })

    it('returns null for #prd with no line range', () => {
      expect(parseOneToken('prd')).toBeNull()
      expect(parseOneToken('prd §')).toBeNull()
      expect(parseOneToken('prd:')).toBeNull()
    })

    it('returns null when start > end', () => {
      expect(parseOneToken('prd 5.2')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // asset 形态
  // -------------------------------------------------------------------------

  describe('asset form', () => {
    it('parses #asset <name>', () => {
      expect(parseOneToken('asset diagram.png')).toEqual({
        kind: 'asset',
        name: 'diagram.png',
      })
    })

    it('returns null for #asset without name', () => {
      expect(parseOneToken('asset')).toBeNull()
      expect(parseOneToken('asset ')).toBeNull()
    })

    it('returns null when name has unsafe characters', () => {
      expect(parseOneToken('asset ../etc/passwd')).toBeNull()
      expect(parseOneToken('asset name with space')).toBeNull()
    })

    it('accepts underscores and dashes in name', () => {
      expect(parseOneToken('asset prd-1.png')).toEqual({
        kind: 'asset',
        name: 'prd-1.png',
      })
    })
  })

  // -------------------------------------------------------------------------
  // 未知前缀
  // -------------------------------------------------------------------------

  it('returns null for unknown prefix (fall-through)', () => {
    expect(parseOneToken('foo-bar')).toBeNull()
    expect(parseOneToken('random text')).toBeNull()
  })
})

describe('TranscriptRefParser.parseTranscriptRefs — multi-token extraction', () => {
  it('extracts all valid refs in input order with their positions', () => {
    const input = '看 #run-abc123 与 #prd §2.3-5 的产物,以及 #asset diagram.png'
    const refs = parseTranscriptRefs(input)
    expect(refs).toHaveLength(3)
    expect(refs[0]?.ref).toEqual({ kind: 'run_id', run_id: 'run-abc123' })
    expect(refs[1]?.ref).toEqual({
      kind: 'prd_section',
      path: 'requirement.md',
      line_range: [2, 5],
    })
    expect(refs[2]?.ref).toEqual({ kind: 'asset', name: 'diagram.png' })
  })

  it('skips unknown tokens without throwing', () => {
    const input = '看 #unknown-xyz 与 #run-ok123 这两个'
    const refs = parseTranscriptRefs(input)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.ref).toEqual({ kind: 'run_id', run_id: 'run-ok123' })
  })

  it('returns empty array for input without #', () => {
    expect(parseTranscriptRefs('hello world')).toEqual([])
  })

  it('returns empty array for empty / nullish input', () => {
    expect(parseTranscriptRefs('')).toEqual([])
  })

  it('records the index of each match (for UI replacement / highlighting)', () => {
    const input = '前 #run-abc123 后'
    const refs = parseTranscriptRefs(input)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.match).toBe('#run-abc123')
    expect(refs[0]?.index).toBe(input.indexOf('#run-abc123'))
  })

  it('does not treat lone # as a token', () => {
    const input = '单独一个 # 后面无内容'
    expect(parseTranscriptRefs(input)).toEqual([])
  })

  it('extracts multiple refs separated by Chinese punctuation', () => {
    const input = '#run-a1,#run-a2;#run-a3'
    const refs = parseTranscriptRefs(input)
    expect(refs).toHaveLength(3)
    expect(refs.map((r) => r.ref.run_id)).toEqual([
      'run-a1',
      'run-a2',
      'run-a3',
    ])
  })
})

describe('TranscriptRefParser.renderRefAsReadable — issue 04', () => {
  it('renders run_id as 📎 Run #<id>', () => {
    expect(
      renderRefAsReadable({ kind: 'run_id', run_id: 'run-abc123' }),
    ).toBe('📎 Run #abc123')
  })

  it('renders prd_section as 📄 PRD §<start>-<end>', () => {
    expect(
      renderRefAsReadable({
        kind: 'prd_section',
        path: 'requirement.md',
        line_range: [2, 5],
      }),
    ).toBe('📄 PRD §2-5')
  })

  it('renders asset as 🖼️ Asset <name>', () => {
    expect(renderRefAsReadable({ kind: 'asset', name: 'diagram.png' })).toBe(
      '🖼️ Asset diagram.png',
    )
  })
})