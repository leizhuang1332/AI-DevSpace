import { knowledge, type KnowledgeItem } from '@/app/(workspace)/data/mock';

const CAT_META: Record<KnowledgeItem['category'], { icon: string; label: string; subCount?: { label: string; count: number }[] }> = {
  domain:  { icon: '📘', label: 'domain',  subCount: [{ label: '支付', count: 3 }, { label: '会员', count: 2 }, { label: '订单', count: 3 }] },
  pattern: { icon: '📐', label: 'patterns' },
  bug:     { icon: '🐛', label: 'bugs' },
  standard:{ icon: '📏', label: 'standards' },
  note:    { icon: '📝', label: 'notes' },
};

const CAT_PILL: Record<KnowledgeItem['category'], string> = {
  domain:   'bg-[#eef2ff] text-[#4338ca]',
  pattern:  'bg-[#fef3c7] text-[#92400e]',
  bug:      'bg-[#fee2e2] text-[#991b1b]',
  standard: 'bg-[#dcfce7] text-[#166534]',
  note:     'bg-bg-subtle text-text-3',
};

export default function KnowledgePage() {
  const total = knowledge.length;

  // 统计各分类数量（用于 sub-nav tabs）
  const counts: Record<string, number> = { all: total };
  (Object.keys(CAT_META) as KnowledgeItem['category'][]).forEach((c) => {
    counts[c] = knowledge.filter((k) => k.category === c).length;
  });

  return (
    <main className="p-6 lg:p-8 overflow-auto">
      {/* Page head */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">知识库</h1>
          <div className="text-text-2 text-md mt-1">
            跨需求复用的领域知识、技术方案、Bug 经验、最佳实践 · AI 自动从历史沉淀
          </div>
        </div>
        <div className="flex gap-2">
          <button className="h-8 px-3 rounded-md text-md font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle">
            ⌘⇧O 从对话提取
          </button>
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">
            + 新增知识
          </button>
        </div>
      </div>

      {/* Toolbar: search + sort */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-3">🔍</span>
          <input
            type="text"
            placeholder="搜索知识（全文索引 ripgrep）…"
            className="w-full h-8 pl-8 pr-3 bg-bg-elevated border border-border-strong rounded-md text-md outline-none"
          />
        </div>
        <button className="h-8 px-3 rounded-md text-md font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle">
          排序：最近使用 ↓
        </button>
      </div>

      {/* Sub-nav tabs */}
      <div className="flex gap-0.5 p-1 bg-bg-subtle rounded-md w-fit mb-4">
        {([
          { key: 'all',      label: '全部',  icon: '' },
          { key: 'domain',   label: 'domain',   icon: '📘' },
          { key: 'pattern',  label: 'patterns', icon: '📐' },
          { key: 'bug',      label: 'bugs',     icon: '🐛' },
          { key: 'standard', label: 'standards',icon: '📏' },
          { key: 'note',     label: 'notes',    icon: '📝' },
        ] as { key: string; label: string; icon: string }[]).map((t, i) => (
          <button
            key={t.key}
            className={`h-7 px-3 rounded-sm text-sm inline-flex items-center gap-1.5 ${
              i === 0
                ? 'bg-bg-elevated text-text-1 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                : 'text-text-2'
            }`}
          >
            {t.icon && <span>{t.icon}</span>}
            <span>{t.label}</span>
            <span
              className={`text-xs px-1.5 rounded-md ${
                i === 0 ? 'bg-brand-50 text-brand-700' : 'bg-bg-subtle text-text-3'
              }`}
            >
              {counts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Tree + list layout */}
      <div className="grid grid-cols-[240px_1fr] gap-4">
        {/* Tree */}
        <aside className="bg-bg-elevated border border-border rounded-lg p-3">
          <h3 className="text-[11px] text-text-3 uppercase tracking-wider font-medium px-2 mb-2">
            分类树
          </h3>
          <div className="flex items-center justify-between px-2 py-1.5 rounded-sm text-sm bg-brand-50 text-brand-700 font-medium">
            <span><span className="mr-2">📁</span>全部</span>
            <span className="text-xs text-brand-700">{total}</span>
          </div>
          {(Object.keys(CAT_META) as KnowledgeItem['category'][]).map((c) => {
            const meta = CAT_META[c];
            return (
              <div key={c}>
                <div className="flex items-center justify-between px-2 py-1.5 rounded-sm text-sm text-text-2 hover:bg-bg-subtle cursor-pointer">
                  <span><span className="mr-2">{meta.icon}</span>{meta.label}</span>
                  <span className="text-xs text-text-3">{counts[c] ?? 0}</span>
                </div>
                {meta.subCount?.map((s) => (
                  <div
                    key={s.label}
                    className="pl-5 pr-2 py-1 text-xs text-text-2 hover:bg-bg-subtle rounded-sm cursor-pointer flex items-center justify-between"
                  >
                    <span>· {s.label}</span>
                    <span className="text-text-3">{s.count}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </aside>

        {/* List */}
        <div className="flex flex-col gap-2">
          {knowledge.map((k) => (
            <article
              key={k.id}
              className="bg-bg-elevated border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-[0_2px_4px_rgba(0,0,0,0.06)] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-md font-medium text-text-1">{k.title}</div>
                <span className={`text-xs px-2 py-0.5 rounded-xl ${CAT_PILL[k.category]}`}>
                  {CAT_META[k.category].icon} {CAT_META[k.category].label}
                </span>
              </div>
              <p className="text-sm text-text-2 leading-relaxed line-clamp-2 overflow-hidden">
                {k.body}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-text-3">
                <div className="flex gap-1">
                  {k.tags.map((t) => (
                    <span key={t} className="font-mono text-text-2 bg-bg-subtle px-1.5 py-0.5 rounded-sm">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3 items-center">
                  <span className={k.source === 'ai' ? 'text-brand-700' : ''}>
                    {k.source === 'ai' ? '✨ AI 自动沉淀' : '📝 人工整理'}
                  </span>
                  <span>📌 引用 {k.refs} 次</span>
                  <span>{k.agoText}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
        <strong>设计说明：</strong>知识库 4 类标签（domain / patterns / bugs / standards）+ 自由 tag。
        <b>AI 自动沉淀</b>（✨ 标记）= AI 从历史需求的代码、Review、对话中抽取；
        <b>人工整理</b>（📝）= 用户手动录入。standards 类（带「强制」标记）每次 AI 上下文装配必注入。
        空态：「📚 沉淀第一条知识 · + 新增知识」。点击条目 → 全屏 markdown 编辑器。
      </div>
    </main>
  );
}