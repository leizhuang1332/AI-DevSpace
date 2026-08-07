'use client'

/**
 * TaskCard content Markdown 渲染组件(issue 08 / ADR-0027 D5)
 *
 * 用 `react-markdown` + `remark-gfm`(GFM 支持:ol / 表格 / 删除线 / 任务列表)。
 * 对照 `board-detail-final.html` `.markdown-block` 规则:
 * - h5 / 段落 / 无序列表 / 有序列表 / inline code / 链接
 *
 * XSS 防御:
 * - schema 层已有 `UNSAFE_MARKDOWN_RE`(task-card.ts)粗筛危险标签
 * - 本组件 `disallowedElements` 二次禁:script/iframe/object/embed/style/form
 *   + `unwrapDisallowed`(不渲染但保留子节点文本)
 * - react-markdown 默认不渲染 raw HTML(需 `rehype-raw` 才会,本期不引入)
 *
 * 视觉对照:`.markdown-block p` margin-bottom / `h5` md font / `ul|ol` 左缩进 /
 * `code` mono brand-tint pill。
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

export interface MarkdownContentProps {
  /** Markdown 源文本(TaskCard.content) */
  source: string
}

/** 禁用的危险元素(script / iframe / object / embed / style / form 等不渲染)。 */
const DISALLOWED_ELEMENTS = [
  'script',
  'iframe',
  'object',
  'embed',
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'meta',
  'link',
] as const

/** 自定义渲染:把 HTML 元素映射到 app token 类(对照 board-detail-final.html)。 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-text-1 mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-text-1 mt-4 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-md font-semibold text-text-1 mt-3 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-text-1 mt-3 mb-1">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-md font-semibold text-text-1 mt-3 mb-2">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-semibold text-text-1 mt-3 mb-2">{children}</h6>
  ),
  p: ({ children }) => (
    <p className="mb-2 leading-relaxed text-text-2 text-sm">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="ml-5 mb-2 list-disc text-text-2 text-sm">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="ml-5 mb-2 list-decimal text-text-2 text-sm">{children}</ol>
  ),
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  code: ({ children, className }) => {
    // inline code(无 className 通常是 inline;fenced code block 有 language-xxx)
    const isInline = !className
    if (isInline) {
      return (
        <code className="font-mono text-xs px-1 py-0.5 rounded-sm bg-bg-subtle text-brand-700">
          {children}
        </code>
      )
    }
    return (
      <code className="font-mono text-xs block bg-bg-subtle p-2 rounded-md overflow-x-auto">
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="mb-2">{children}</pre>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-600 hover:text-brand-700 underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-strong pl-3 my-2 text-text-3 text-sm italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <table className="w-full text-sm border-collapse my-2">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-text-1 bg-bg-subtle">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-text-2">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? ''} className="max-w-full rounded-md my-2" />
  ),
}

export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <div data-testid="board-detail-markdown" className="markdown-block">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={[...DISALLOWED_ELEMENTS]}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
