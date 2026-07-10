'use client';
import { useUIOverlay } from './ui-overlay-store';
import { useEffect, useState } from 'react';

type Mode = 'command' | 'ai' | 'history';

interface Item {
  icon: string;
  label: string;
  desc?: string;
  shortcut?: string[];
  section?: string;
}

const ALL: Item[] = [
  { icon: '▶', label: '运行 code-stage Skill', desc: '继续执行下一个 Task（当前 #12 退款接口开发）', shortcut: ['⌘', 'R'], section: '需求操作' },
  { icon: '⏸', label: '暂停当前 Skill', desc: '保存 AI 会话上下文到 conversations/', section: '需求操作' },
  { icon: '⟳', label: '重新运行 code-stage', desc: '丢弃当前进度，重新执行', section: '需求操作' },
  { icon: '📄', label: '打开 design/02-api.md', desc: '当前需求 · 设计阶段 · API 定义', section: '导航' },
  { icon: '📦', label: '打开 artifacts/refund.sql', desc: '产物 · 5 分钟前由 design-stage 生成', section: '导航' },
  { icon: '⌘⇧E', label: '在 IDEA 打开 refund-service worktree', desc: '~/.aidevspace/requirements/req-2024-007/refund-service', shortcut: ['⌘', '⇧', 'E'], section: '导航' },
  { icon: '📚', label: '添加知识：refund-idempotency', desc: '从历史需求沉淀 · 已存在于知识库', section: '仓库 / 知识库' },
];

const HISTORY: Item[] = [
  { icon: '⚡', label: 'code-stage 启动', desc: '5 分钟前 · req-001', section: '今天' },
  { icon: '✨', label: 'AI: "退款幂等性怎么保证"', desc: '12 分钟前 · 引用 3 个文件', section: '今天' },
  { icon: '⚡', label: '打开 requirements 列表', desc: '1 小时前', section: '今天' },
  { icon: '⚡', label: '运行 analyze-stage', desc: '昨天 18:42 · req-002', section: '昨天' },
  { icon: '✨', label: 'AI: "会员成长值并发更新 Bug"', desc: '昨天 17:30', section: '昨天' },
];

const CMD_FILTERED = (q: string) => ALL.filter((i) => i.label.includes(q));
const AI_SUGGEST = (q: string) => [{ icon: '✨', label: `AI: "${q}"` }];

export function CommandPalette() {
  const { cmdK, close } = useUIOverlay();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('command');

  // Reset query when palette opens; ⌘I toggles AI mode
  useEffect(() => {
    if (cmdK) setQuery('');
  }, [cmdK]);

  useEffect(() => {
    if (!cmdK) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setMode((m) => (m === 'ai' ? 'command' : 'ai'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdK]);

  if (!cmdK) return null;

  let items: Item[];
  if (mode === 'history') items = HISTORY;
  else if (query.startsWith('>')) items = CMD_FILTERED(query.slice(1));
  else if (query.startsWith('✨')) items = AI_SUGGEST(query.slice(1));
  else if (mode === 'ai') items = query ? AI_SUGGEST(query) : [];
  else items = CMD_FILTERED(query);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 bg-slate-900/40 backdrop-blur-sm">
      <div
        className={`relative z-[101] w-[680px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden ${
          mode === 'ai' ? 'border-t-2 border-t-brand-500' : ''
        }`}
      >
        {/* Context header */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-b border-border text-xs text-text-3">
          <div className="inline-flex items-center gap-1.5">
            <span className="bg-bg-elevated border border-border px-1.5 py-0.5 rounded font-mono">
              退款功能优化
            </span>
            <span>· 绑当前需求（⌘⇧K 切全局）</span>
          </div>
          <div className="flex gap-1">
            {(['command', 'ai', 'history'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-xs ${
                  mode === m ? 'bg-bg-elevated text-brand-600 font-medium shadow-sm' : 'text-text-2'
                }`}
              >
                {m === 'command' ? '命令' : m === 'ai' ? 'AI 提问' : '历史'}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <span className={`text-lg ${mode === 'ai' ? 'text-brand-600' : 'text-text-3'}`}>⌘K</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令、AI 提问、文件…"
            className="flex-1 border-none outline-none bg-transparent text-lg text-text-1 placeholder-text-3"
          />
          <span className="font-mono text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded">ESC</span>
        </div>

        {/* AI result card (AI mode, when query exists) */}
        {mode === 'ai' && query && !query.startsWith('✨') && (
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-text-2">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                AI 已就绪
              </div>
              <button className="text-xs text-text-2 hover:text-text-1" onClick={close}>
                ✕
              </button>
            </div>
            <div className="bg-bg-subtle rounded-md p-4 text-md text-text-1 leading-relaxed">
              <div className="font-medium mb-2 flex items-center gap-2">✨ 可执行结果</div>
              <ul className="pl-5 text-sm text-text-2 list-disc">
                <li>扫描 12 个代码位置 · 已生成建议</li>
                <li>草拟 add-idempotency-check Skill · 待 review</li>
              </ul>
              <div className="mt-3 pt-3 border-t border-border flex gap-2">
                <button className="h-6 px-2.5 text-xs rounded bg-brand-500 text-white font-medium">
                  ▶ 让 code-stage 修复
                </button>
                <button className="h-6 px-2.5 text-xs rounded bg-bg-elevated border border-border text-text-2">
                  📌 加入知识库
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results list */}
        <div className="max-h-[420px] overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-text-3">
              {mode === 'ai' ? '输入自然语言提问 · AI 给出可执行结果卡片' : '无匹配命令'}
            </div>
          )}
          {items.map((it, i) => (
            <Item key={i} item={it} />
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-t border-border text-xs text-text-3">
          <div className="flex gap-3">
            <span><kbd className="kbd">↑↓</kbd> 选择</span>
            <span><kbd className="kbd">↵</kbd> 执行</span>
            <span><kbd className="kbd">⌘I</kbd> AI 模式</span>
            <span><kbd className="kbd">/</kbd> 全局搜索</span>
          </div>
          <div>绑当前需求 · ⌘⇧K 切全局</div>
        </div>
      </div>
    </div>
  );
}

function Item({ item }: { item: Item }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 cursor-pointer text-md hover:bg-bg-subtle">
      <div className="w-7 h-7 rounded-md bg-bg-subtle flex items-center justify-center text-sm text-text-2">
        {item.icon}
      </div>
      <div className="flex-1">
        <div className="text-text-1">{item.label}</div>
        {item.desc && <div className="text-xs text-text-3">{item.desc}</div>}
      </div>
      {item.shortcut && (
        <span className="inline-flex gap-0.5">
          {item.shortcut.map((k) => (
            <kbd key={k} className="kbd">{k}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}