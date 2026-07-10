'use client';
import { useUIOverlay } from './ui-overlay-store';
import { useEffect, useMemo, useState } from 'react';
import { requirements } from '@/app/(workspace)/data/mock';

interface RepoOpt {
  name: string;
  url: string;
  branch: string;
}

const REPO_POOL: RepoOpt[] = [
  { name: 'refund-service', url: 'git@github.com:company/refund-service.git', branch: 'main' },
  { name: 'order-service', url: 'git@github.com:company/order-service.git', branch: 'main' },
  { name: 'pay-gateway', url: 'git@github.com:company/pay-gateway.git', branch: 'main' },
  { name: 'risk-service', url: 'git@github.com:company/risk-service.git', branch: 'main' },
];

const SKILL_CHAIN = ['analyze', 'design', 'plan', 'code', 'test', 'submit'];

export function NewRequirementModal() {
  const { cmdN, close } = useUIOverlay();
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [prd, setPrd] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset on open
  useEffect(() => {
    if (cmdN) {
      setName('');
      setBranch('main');
      setPrd('');
      setSelected(new Set());
    }
  }, [cmdN]);

  const toggle = (r: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  const canSubmit = useMemo(() => name.trim().length > 0 && selected.size > 0, [name, selected]);

  if (!cmdN) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const id = `req-${String(requirements.length + 1).padStart(3, '0')}`;
    // Step 2 仅 mock 推入；P1+ Agent 接通 (POST /api/requirements)
    console.log('[NewRequirementModal] create', {
      id,
      title: name,
      branch,
      repos: [...selected],
      prdBytes: prd.length,
    });
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-8"
      onClick={close}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative z-[101] w-[720px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Head */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-3 text-text-1">
            <span className="text-lg">✨</span>
            新建需求
          </h2>
          <button
            type="button"
            onClick={close}
            title="关闭 (ESC)"
            className="w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm flex items-center justify-center hover:bg-bg-elevated hover:text-text-1"
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-5">
          <div className="flex items-center gap-2 mb-6 text-xs text-text-3">
            <div className="flex items-center gap-2 text-brand-600 font-medium">
              <span className="w-6 h-6 rounded-full bg-brand-500 text-white inline-flex items-center justify-center font-semibold text-[11px] border border-brand-500">1</span>
              基本信息
            </div>
            <span className="w-6 h-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-bg-subtle inline-flex items-center justify-center font-semibold text-[11px] border border-border">2</span>
              关联仓库
            </div>
            <span className="w-6 h-px bg-border" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-bg-subtle inline-flex items-center justify-center font-semibold text-[11px] border border-border">3</span>
              PRD &amp; 启动
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 overflow-y-auto">
          {/* Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-text-1 mb-2">
              需求名称 <span className="text-destructive">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：退款功能优化"
              className="w-full px-3 py-3 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 font-sans outline-none transition focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]"
            />
            <div className="text-xs text-text-3 mt-1">简洁、动词开头 · 如「退款功能优化」「会员等级重构」</div>
          </div>

          {/* Branch */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-text-1 mb-2">目标分支（合并到）</label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-3 py-3 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 font-mono outline-none transition focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]"
            />
            <div className="text-xs text-text-3 mt-1">submit-stage 完成后，AI 自动请求合并到此分支</div>
          </div>

          {/* Repos */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-text-1 mb-2">
              关联仓库 <span className="text-destructive">*</span>
            </label>
            <div className="bg-bg-subtle border border-border rounded-md p-3 max-h-[200px] overflow-auto">
              {REPO_POOL.map((r) => {
                const on = selected.has(r.name);
                return (
                  <div
                    key={r.name}
                    onClick={() => toggle(r.name)}
                    className={`flex items-center gap-3 p-2 rounded-sm cursor-pointer text-sm hover:bg-bg-elevated ${on ? 'bg-bg-elevated' : ''}`}
                  >
                    <span
                      className={`w-4 h-4 rounded-sm border-[1.5px] inline-flex items-center justify-center text-white text-[11px] ${
                        on
                          ? 'bg-brand-500 border-brand-500'
                          : 'border-border-strong bg-transparent'
                      }`}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-mono font-medium text-text-1">{r.name}</div>
                      <div className="text-xs font-mono text-text-3">{r.url}</div>
                    </div>
                    <div className="text-xs text-text-3 ml-auto">{r.branch}</div>
                  </div>
                );
              })}
              <div className="mt-2 px-2 py-2 text-sm text-brand-600 cursor-pointer hover:underline flex items-center gap-1.5">
                + 添加新仓库（粘贴 Git URL）
              </div>
            </div>
            <div className="text-xs text-text-3 mt-1">
              已选 {selected.size} 个 · 每个仓库会自动创建 git worktree
            </div>
          </div>

          {/* PRD */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-text-1 mb-2">PRD 原文（可选 · 也可以在创建后粘贴）</label>
            <textarea
              value={prd}
              onChange={(e) => setPrd(e.target.value.slice(0, 5000))}
              placeholder="支持 Markdown · AI 会基于此生成 analysis/01-understanding.md"
              rows={5}
              className="w-full px-3 py-3 bg-bg-subtle border border-border-strong rounded-md text-sm text-text-1 font-mono leading-relaxed outline-none transition resize-y focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]"
            />
            <div className="text-xs text-text-3 text-right">{prd.length} / 5000</div>
          </div>

          {/* Skill chain */}
          <div className="mb-2">
            <label className="block text-sm font-medium text-text-1 mb-2">默认 Skill 链</label>
            <div className="flex items-center gap-1 px-3 py-3 bg-brand-50 rounded-md text-sm text-brand-600">
              {SKILL_CHAIN.map((s, i) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span className="px-2 py-0.5 bg-bg-elevated border border-brand-500 rounded-sm font-mono text-xs text-brand-600">
                    {s}
                  </span>
                  {i < SKILL_CHAIN.length - 1 && <span className="text-text-3">→</span>}
                </span>
              ))}
              <span className="ml-auto text-xs text-text-3">可在需求设置中调整</span>
            </div>
          </div>
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-subtle">
          <div className="text-xs text-text-3">⌘N 全局快捷键 · ESC 关闭</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium text-text-2 hover:text-text-1"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ✓ 创建需求
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}