'use client';
import { useUIOverlay } from './ui-overlay-store';
import { useState } from 'react';

interface Row { desc: string; keys: string[]; note?: string }
interface Group { title: string; rows: Row[] }

const GROUPS: Group[] = [
  {
    title: '全局',
    rows: [
      { desc: '命令面板（当前需求）', keys: ['⌘', 'K'] },
      { desc: '命令面板（全局）', keys: ['⌘', '⇧', 'K'] },
      { desc: 'AI 提问模式（在命令面板中）', keys: ['⌘', 'I'] },
      { desc: '新建需求', keys: ['⌘', 'N'] },
      { desc: '切换 / 新建需求 Tab', keys: ['⌘', 'T'] },
      { desc: '关闭当前 Tab', keys: ['⌘', 'W'] },
      { desc: '切换主题', keys: ['⌘', '⇧', 'L'] },
      { desc: '打开设置', keys: ['⌘', ','] },
      { desc: '快捷键速查', keys: ['⌘', '/'], note: '或' },
      { desc: '关闭弹窗 / 退出聚焦', keys: ['ESC'] },
    ],
  },
  {
    title: '左侧一级导航',
    rows: [
      { desc: '概览', keys: ['⌘', '1'] },
      { desc: '需求', keys: ['⌘', '2'] },
      { desc: '仓库', keys: ['⌘', '3'] },
      { desc: '知识库', keys: ['⌘', '4'] },
      { desc: 'Skill 管理', keys: ['⌘', '5'] },
      { desc: '设置', keys: ['⌘', '6'] },
      { desc: '切换 Tab 1~9', keys: ['⌘', '1~9'] },
    ],
  },
  {
    title: '需求详情页',
    rows: [
      { desc: '切主工作区 Tab', keys: ['⌘', '1~4'] },
      { desc: '上 / 下一个 Tab', keys: ['⌘', '['], note: '/' },
      { desc: '重新跑当前 Skill', keys: ['⌘', 'R'] },
      { desc: '在 IDEA 打开 worktree', keys: ['⌘', '⇧', 'E'] },
      { desc: '查看当前 Diff', keys: ['⌘', '⇧', 'D'] },
      { desc: '跳到最新 Commit', keys: ['⌘', '⇧', 'C'] },
      { desc: '提交 AI 提问（在命令面板中）', keys: ['⌘', '↵'] },
    ],
  },
  {
    title: '命令面板内',
    rows: [
      { desc: '选中上下项', keys: ['↑', '↓'] },
      { desc: '执行当前选中', keys: ['↵'] },
      { desc: '切换命令 / AI 模式', keys: ['Tab'] },
      { desc: '全局搜索（知识库 / 需求 / 产物）', keys: ['/'] },
      { desc: '直接命令模式', keys: ['>'] },
      { desc: '清空输入', keys: ['⌘', '⌫'] },
      { desc: '关闭', keys: ['ESC'] },
    ],
  },
  {
    title: '资源树',
    rows: [
      { desc: '上下选中', keys: ['↑', '↓'] },
      { desc: '打开当前节点', keys: ['↵'] },
      { desc: '折叠 / 展开当前节点', keys: ['H'] },
      { desc: '折叠 / 展开所有', keys: ['⌘', '⇧', 'H'] },
      { desc: '展开 / 折叠', keys: ['→', '←'] },
    ],
  },
];

export function ShortcutsCheatsheet() {
  const { cmdSlash, close } = useUIOverlay();
  const [q, setQ] = useState('');

  if (!cmdSlash) return null;

  const filtered = GROUPS.map((g) => ({
    ...g,
    rows: g.rows.filter((r) => r.desc.toLowerCase().includes(q.toLowerCase())),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/85 backdrop-blur-md overflow-auto">
      <div className="relative max-w-[920px] mx-auto px-8 py-8 text-foreground">
        {/* Head */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">⌨️ 快捷键速查</h1>
          <div className="flex items-center gap-3">
            <div className="relative w-[280px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-foreground/50">🔍</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索快捷键…"
                className="w-full h-9 pl-9 pr-3 bg-foreground/5 border border-foreground/10 rounded-md text-foreground text-md outline-none placeholder:text-foreground/40 focus:border-brand-500 focus:bg-foreground/10"
              />
            </div>
            <button
              onClick={close}
              title="关闭 (ESC)"
              className="w-9 h-9 bg-foreground/5 border border-foreground/10 rounded-md flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground text-base"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Grid of groups */}
        <div className="grid grid-cols-2 gap-5">
          {filtered.map((g) => (
            <div key={g.title} className="bg-foreground/5 border border-foreground/10 rounded-lg p-5">
              <h2 className="text-md font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                {g.title}
              </h2>
              {g.rows.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between py-2 text-md ${
                    i !== g.rows.length - 1 ? 'border-b border-foreground/5' : ''
                  }`}
                >
                  <span className="text-foreground/85">{r.desc}</span>
                  <span className="inline-flex gap-1 items-center">
                    {r.keys.map((k, ki) => (
                      <span key={ki} className="kbd-dark">
                        {k}
                      </span>
                    ))}
                    {r.note && <span className="text-xs text-foreground/40 ml-1.5">{r.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* 发现性 (3 层发现性) */}
        <div className="mt-5 bg-foreground/5 border border-foreground/10 rounded-lg p-5">
          <h2 className="text-md font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
            发现性
          </h2>
          <div className="text-md text-foreground/85 leading-relaxed">
            <div><strong className="text-foreground">L1 UI 标注</strong> · hover UI 元素显示快捷键</div>
            <div className="mt-1.5"><strong className="text-foreground">L2 命令面板</strong> · <code className="font-mono">⌘K</code> → 输"快捷键"→ 显示所有</div>
            <div className="mt-1.5"><strong className="text-foreground">L3 速查面板</strong> · <code className="font-mono">⌘/</code> 唤起本页</div>
          </div>
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-foreground/10 text-xs text-foreground/50">
          <div>
            macOS · 按 <kbd className="kbd-dark">Ctrl</kbd> 替代 <kbd className="kbd-dark">⌘</kbd> 在 Windows / Linux
          </div>
          <div>
            任何位置按 <kbd className="kbd-dark">?</kbd> 唤起本页
          </div>
        </div>
      </div>
    </div>
  );
}