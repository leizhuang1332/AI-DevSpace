'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { resolveAuxLink, type AssetMeta, type AuxFile } from '@ai-devspace/shared'

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
 * - Image blocks (ticket 02 / ADR-0015 D5):行首或单独一行的
 *   `![alt](assets/prd-N.<ext>)` / `![alt](./assets/prd-N.<ext>)`。
 *   src 在 `assets` 列表中找到匹配 → 用 `AssetMeta.url` 渲染 `<img>`;
 *   找不到 → 原样渲染 `<img src={原始 src}>`,best-effort 不阻塞预览。
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
  /**
   * ticket 02 (ADR-0015 D5):已知 assets 元数据列表。
   * 解析 `![alt](assets/prd-N.png)` 时按 `name`(=文件 basename)匹配,
   * 命中后用 `AssetMeta.url`(agent 路由路径)作为 `<img>` 的 src。
   *
   * 为可选,与父组件向后兼容:不传时图片按原 src 渲染(便于 PR review 时
   * 单独看 markdown 文本)。
   */
  assets?: AssetMeta[]
}

// ---------------------------------------------------------------------------
// Block parser
// ---------------------------------------------------------------------------

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lang: string; body: string }
  | { kind: 'image'; alt: string; src: string }

const FENCE_RE = /^```(\S*)\s*$/
const HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*\s*$/
// List item: - item / * item, with optional [ ] / [x] checkbox
const LIST_ITEM_RE = /^[-*]\s+(?:\[(?: |x|X)\]\s+)?(.*)$/
// Markdown image at line start(允许前置缩进),tail 不带其他字符(孤立成段)。
// 例:`![Alt](assets/prd-1.png)` / `![Alt](./assets/prd-1.png)`
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\((\.\/)?([^)\s]+)\)\s*$/

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
    // image at line start(ticket 02):整行仅含 image markdown → 独立 block
    const imageMatch = line.match(IMAGE_LINE_RE)
    if (imageMatch) {
      const alt = imageMatch[1] ?? ''
      const leadingDot = imageMatch[2] === './'
      // `src` 把 `./` 前缀去掉(允许 mammoth 输出 `./assets/prd-1.png` 与
      // `assets/prd-1.png` 两种形态),解析时统一按 basename 匹配。
      const rawSrc = imageMatch[3]
      const src = leadingDot ? rawSrc.replace(/^\.\//, '') : rawSrc
      blocks.push({ kind: 'image', alt, src })
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
        FENCE_RE.test(cur) ||
        IMAGE_LINE_RE.test(cur)
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
// Inline parser: split text into [code | link | image | text] tokens
// ---------------------------------------------------------------------------

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; text: string; target: string }
  | { kind: 'image'; alt: string; src: string }

const INLINE_CODE_RE = /`([^`\n]+)`/
const INLINE_LINK_RE = /\[([^\]\n]+)\]\(([^)\n]+)\)/
// inline image `![alt](src)`,空 alt 也允许。src 与 alt 都不可含换行。
// 注意:会和 INLINE_LINK_RE 的形态重合,但顺序(image 优先于 link)处理——
// 否则 `![a](b)` 会被 link 的 `[a](b)` 抢先吃掉。详见 `parseInline`。
const INLINE_IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/

/**
 * Parse inline tokens left-to-right. We scan for the earliest match among
 * inline-code, inline-image, inline-link; emit a text token for the prefix,
 * then the matched token, and continue from the end of the match.
 *
 * 顺序约束:
 * - image **优先于** link(否则 `![alt](src)` 会被 link 的 `[alt](src)` 抢先吃掉)
 * - code 仍然最先检查,让 backtick 在 link / image 文本里也保持字面
 *   (虽然现实几乎不会出现 `[see `x.md`](...)` 这种嵌套)
 */
function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let cursor = 0
  while (cursor < text.length) {
    const remaining = text.slice(cursor)
    const codeMatch = remaining.match(INLINE_CODE_RE)
    const imageMatch = remaining.match(INLINE_IMAGE_RE)
    const linkMatch = remaining.match(INLINE_LINK_RE)
    type Candidate = {
      kind: 'code' | 'image' | 'link'
      match: RegExpMatchArray
    }
    const candidates: Candidate[] = []
    if (codeMatch) candidates.push({ kind: 'code', match: codeMatch })
    if (imageMatch) candidates.push({ kind: 'image', match: imageMatch })
    if (linkMatch) candidates.push({ kind: 'link', match: linkMatch })
    if (candidates.length === 0) {
      tokens.push({ kind: 'text', value: remaining })
      break
    }
    // 选 index 最小者;并列时按 code > image > link(防止 link 抢走 image)
    candidates.sort((a, b) => {
      const ai = a.match.index!
      const bi = b.match.index!
      if (ai !== bi) return ai - bi
      const order: Record<Candidate['kind'], number> = {
        code: 0,
        image: 1,
        link: 2,
      }
      return order[a.kind] - order[b.kind]
    })
    const earliest = candidates[0]
    const idx = earliest.match.index!
    if (idx > 0) {
      tokens.push({ kind: 'text', value: remaining.slice(0, idx) })
    }
    if (earliest.kind === 'code') {
      tokens.push({ kind: 'code', value: earliest.match[1] })
      cursor += idx + earliest.match[0].length
    } else if (earliest.kind === 'image') {
      const raw = earliest.match[2]
      const src = raw.startsWith('./') ? raw.slice(2) : raw
      tokens.push({ kind: 'image', alt: earliest.match[1], src })
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
    assets?: AssetMeta[]
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
    if (t.kind === 'image') {
      // ticket 02 (ADR-0015 D5):inline 图片同样通过 resolveAssetSrc 解析成
      // agent 路由 url;data-asset-name / data-asset-src / data-resolved-src
      // 三个 testid 属性与 block image 保持一致,便于 E2E 检索。
      const resolvedSrc = resolveAssetSrc(t.src, ctx.assets)
      return (
        <img
          key={i}
          data-testid="md-preview-image"
          data-asset-inline="true"
          data-asset-name={
            t.src.includes('/') ? t.src.slice(t.src.lastIndexOf('/') + 1) : t.src
          }
          data-asset-src={t.src}
          data-resolved-src={resolvedSrc}
          src={resolvedSrc}
          alt={t.alt}
          loading="lazy"
          className="inline-block max-w-full h-auto rounded-md border border-border my-1 align-baseline"
        />
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

/**
 * 把 markdown image 的 src 解析成浏览器可访问的 src:
 * - 命中 `assets[]` 中的 `name` → 返回 `AssetMeta.url`(agent 路由路径)
 * - 未命中 → best-effort 返回原 `src`(允许预览渲染未知图片,例如外链 CDN;
 *   网络策略由父组件的 fetcher 决定)
 *
 * 解析规则:
 * 1. 取出 src 的 basename(`assets/prd-1.png` → `prd-1.png`;`./assets/prd-1.png`
 *    在 parseBlocks 阶段已剥掉 `./`)
 * 2. 在 `assets[]` 按 `name` 字段精确比对
 *
 * 注:不做 prefix / fuzzy 匹配 —— `landAssets` 的命名是确定的 `prd-<N>.<ext>`,
 * markdown 由 `replaceDataUriWithAssetPath` 重写后路径也是这个形态,精确匹配
 * 即可。带 `?query` / `#fragment` 后缀的 src 不在 ticket 02 范围。
 */
function resolveAssetSrc(src: string, assets: AssetMeta[] | undefined): string {
  if (!assets || assets.length === 0) return src
  // 取出 last segment(basename),允许 src 含 `/`
  const basename = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src
  const hit = assets.find((a) => a.name === basename)
  return hit ? hit.url : src
}

export function MarkdownPreview({
  markdown,
  currentFile,
  auxFiles,
  onAuxLinkClick,
  assets,
}: MarkdownPreviewProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown])

  const ctx = useMemo(
    () => ({ currentFile, auxFiles, assets, onAuxLinkClick }),
    [currentFile, auxFiles, assets, onAuxLinkClick],
  )

  return (
    <div
      data-testid="markdown-preview"
      data-current-file={currentFile}
      data-asset-count={String(assets?.length ?? 0)}
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
          case 'image': {
            const resolvedSrc = resolveAssetSrc(b.src, assets)
            return (
              // Next/Image 不强制:mammoth 解出的 docx 图片尺寸不稳定,
              // 交给浏览器原生 `<img>` + max-width 自适应即可(markdown 预览场景)。
              <img
                key={idx}
                data-testid="md-preview-image"
                data-asset-name={
                  b.src.includes('/') ? b.src.slice(b.src.lastIndexOf('/') + 1) : b.src
                }
                data-asset-src={b.src}
                data-resolved-src={resolvedSrc}
                src={resolvedSrc}
                alt={b.alt}
                loading="lazy"
                className="max-w-full h-auto rounded-md border border-border my-2"
              />
            )
          }
        }
      })}
    </div>
  )
}