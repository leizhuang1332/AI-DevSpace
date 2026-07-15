'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { resolveAuxLink, type AuxFile } from '@ai-devspace/shared'

/**
 * Minimal Markdown preview component (issue 07).
 *
 * Visual baseline: the .preview region in
 * docs/design/pages/19c-drafting-ide-file-tree.html and the inline-link demo
 * in 19-final-drafting.html.
 *
 * Supported blocks (issue 07 AC #1):
 * - Headings H1 / H2 / H3 (ATX-style with required space after the hash)
 * - Unordered lists (dash or asterisk prefix; - [ ] / - [x] task-list accepted)
 * - Fenced code blocks (triple backtick ... triple backtick)
 * - Paragraphs (consecutive non-empty non-block lines)
 *
 * Supported inline (within heading / paragraph / list-item text):
 * - Inline code (single backtick wrapping, no nested backticks)
 * - Links [text](target): each link is resolved through
 *   resolveAuxLink(currentFile, target, auxFiles).
 *   - Hit a known AuxFile with .md extension -> render as a button whose
 *     click handler calls onAuxLinkClick(target). Single-drawer invariant
 *     lives in DraftingZone (openAuxId is single-valued).
 *   - Miss (external URL / fragment-only / non-md / missing / .. traversal)
 *     -> render as plain text (issue 07 AC #3-#6 "ignored").
 *
 * Why a hand-rolled parser instead of marked / remark:
 * - No markdown library is currently installed (see package.json deps).
 * - We only need five block types + two inline types for the MVP preview.
 * - The resolver truth table is shared with packages/shared (issue 01),
 *   so link correctness does not depend on this component.
 *
 * Out of scope:
 * - Edit mode (parent components toggle between textarea and this component).
 * - Drawer open / switch logic (parent owns openAuxId state).
 * - Anchor scroll-into-view inside preview (issue 03 anchor-bar covers the
 *   textarea path; preview follow-up can be added later).
 */

export interface MarkdownPreviewProps {
  /** Markdown source to render */
  markdown: string
  /**
   * Virtual filename for resolveAuxLink semantic anchor.
   *
   * The shared `resolveAuxLink` currently matches by basename only and does
   * not actually read this value (verified in packages/shared tests). The
   * parameter is kept on the signature so the API is forward-compatible
   * with future relative-path resolution; passing the right value matters
   * semantically even if matching is basename-only today.
   */
  currentFile: string
  /** Known AuxFiles for link resolution */
  auxFiles: AuxFile[]
  /** Click handler for resolved aux links */
  onAuxLinkClick?: (target: AuxFile) => void
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lang: string; body: string }

const FENCE_RE = /^```(\S*)\s*$/
const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/
// List item: - item / * item, with optional [ ] / [x] checkbox
const LIST_ITEM_RE = /^[-*]\s+(?:\[(?: |x|X)\]\s+)?(.*)$/

function parseBlocks(markdown: string): Block[] {
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i += 1
      continue
    }
    // fenced code block
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? ''
      const bodyLines: string[] = []
      i += 1
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        bodyLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // skip closing fence
      blocks.push({ kind: 'code', lang, body: bodyLines.join('\n') })
      continue
    }
    // heading
    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3
      blocks.push({ kind: 'heading', level, text: headingMatch[2].trim() })
      i += 1
      continue
    }
    // list block (consecutive list-item lines)
    if (LIST_ITEM_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length && LIST_ITEM_RE.test(lines[i])) {
        const m = lines[i].match(LIST_ITEM_RE)!
        items.push(m[1])
        i += 1
      }
      blocks.push({ kind: 'list', items })
      continue
    }
    // paragraph: consume consecutive non-empty / non-block lines
    const paraLines: string[] = [line]
    i += 1
    while (i < lines.length) {
      const cur = lines[i]
      if (
        cur.trim() === '' ||
        HEADING_RE.test(cur) ||
        LIST_ITEM_RE.test(cur) ||
        FENCE_RE.test(cur)
      ) {
        break
      }
      paraLines.push(cur)
      i += 1
    }
    blocks.push({ kind: 'paragraph', lines: paraLines })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Inline parser: split text into [code | link | text] tokens
// ---------------------------------------------------------------------------

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; text: string; target: string }

const INLINE_CODE_RE = /`([^`\n]+)`/
const INLINE_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/

/**
 * Parse inline tokens left-to-right. We scan for the earliest match of either
 * inline-code or link, emit a text token for the prefix, then the matched
 * token, and continue from the end of the match.
 *
 * Order matters: inline-code must be checked first so that backticks inside
 * link text like [see `x.md`](...) still parse the backtick as a code span
 * (well, mixed content is rare; we keep it simple by checking code first).
 */
function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0
  while (cursor < text.length) {
    const remaining = text.slice(cursor)
    const codeMatch = remaining.match(INLINE_CODE_RE)
    const linkMatch = remaining.match(INLINE_LINK_RE)
    // pick the earliest match by index
    let earliest:
      | { kind: 'code' | 'link'; match: RegExpMatchArray }
      | null = null
    if (codeMatch && (!linkMatch || codeMatch.index! <= linkMatch.index!)) {
      earliest = { kind: 'code', match: codeMatch }
    } else if (linkMatch) {
      earliest = { kind: 'link', match: linkMatch }
    }
    if (!earliest) {
      tokens.push({ kind: 'text', value: remaining })
      break
    }
    const idx = earliest.match.index!
    if (idx > 0) {
      tokens.push({ kind: 'text', value: remaining.slice(0, idx) })
    }
    if (earliest.kind === 'code') {
      tokens.push({ kind: 'code', value: earliest.match[1] })
      cursor += idx + earliest.match[0].length
    } else {
      tokens.push({
        kind: 'link',
        text: earliest.match[1],
        target: earliest.match[2],
      })
      cursor += idx + earliest.match[0].length
    }
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render a single inline-text source (paragraph / heading text / list-item
 * text) into React children. Inline links go through resolveAuxLink; resolved
 * matches render as buttons, misses render as plain spans.
 */
function renderInline(
  text: string,
  ctx: {
    currentFile: string
    auxFiles: AuxFile[]
    onAuxLinkClick?: (target: AuxFile) => void
  },
): ReactNode[] {
  const tokens = parseInline(text)
  return tokens.map((t, i) => {
    if (t.kind === 'text') {
      return <Fragment key={i}>{t.value}</Fragment>
    }
    if (t.kind === 'code') {
      return (
        <code
          key={i}
          className="font-mono bg-bg-subtle px-1.5 py-0.5 rounded text-xs text-brand-600"
        >
          {t.value}
        </code>
      )
    }
    // link
    const resolved = resolveAuxLink(ctx.currentFile, t.target, ctx.auxFiles)
    if (resolved && ctx.onAuxLinkClick) {
      const onClick = () => ctx.onAuxLinkClick!(resolved)
      return (
        <button
          key={i}
          type="button"
          data-testid="md-preview-link"
          data-link-target={t.target}
          data-resolved-id={resolved.id}
          data-resolved-filename={resolved.filename}
          onClick={onClick}
          className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand hover:text-brand-600 font-medium"
        >
          {t.text}
        </button>
      )
    }
    // unresolved (external / fragment / missing / non-md / ..)
    return (
      <span
        key={i}
        data-testid="md-preview-link-ignored"
        data-link-target={t.target}
      >
        {t.text}
      </span>
    )
  })
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function MarkdownPreview({
  markdown,
  currentFile,
  auxFiles,
  onAuxLinkClick,
}: MarkdownPreviewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown])

  const ctx = useMemo(
    () => ({ currentFile, auxFiles, onAuxLinkClick }),
    [currentFile, auxFiles, onAuxLinkClick],
  )

  return (
    <div
      data-testid="markdown-preview"
      data-current-file={currentFile}
      className="flex flex-col gap-3 text-sm leading-relaxed text-text-2"
    >
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'heading': {
            const inner = renderInline(b.text, ctx)
            if (b.level === 1) {
              return (
                <h1
                  key={idx}
                  data-testid="md-preview-heading"
                  data-heading-level="1"
                  className="text-2xl font-bold text-text-1 pb-2 border-b border-border"
                >
                  {inner}
                </h1>
              )
            }
            if (b.level === 2) {
              return (
                <h2
                  key={idx}
                  data-testid="md-preview-heading"
                  data-heading-level="2"
                  className="text-lg font-semibold text-text-1 mt-3"
                >
                  {inner}
                </h2>
              )
            }
            return (
              <h3
                key={idx}
                data-testid="md-preview-heading"
                data-heading-level="3"
                className="text-md font-semibold text-text-1 mt-2"
              >
                {inner}
              </h3>
            )
          }
          case 'paragraph': {
            const text = b.lines.join(' ')
            return (
              <p
                key={idx}
                data-testid="md-preview-paragraph"
                className="text-text-2"
              >
                {renderInline(text, ctx)}
              </p>
            )
          }
          case 'list': {
            return (
              <ul
                key={idx}
                data-testid="md-preview-list"
                className="list-disc ml-6 text-text-2"
              >
                {b.items.map((it, i2) => (
                  <li key={i2}>{renderInline(it, ctx)}</li>
                ))}
              </ul>
            )
          }
          case 'code': {
            return (
              <pre
                key={idx}
                data-testid="md-preview-code"
                data-code-lang={b.lang || undefined}
                className="bg-bg-subtle border border-border rounded-md p-3 overflow-x-auto font-mono text-xs text-text-1"
              >
                <code>{b.body}</code>
              </pre>
            )
          }
        }
      })}
    </div>
  )
}