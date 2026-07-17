'use client';
/**
 * NewRequirementModal — v1.0.3 (decision 36 overlay / 决策 11 I 方案)
 *
 * 设计依据:
 *   - PRD:    .scratch/new-requirement-modal/PRD.md
 *   - SPEC:   .scratch/new-requirement-modal/UI-POLISH-SPEC.md
 *   - HTML:   docs/design/pages/01-new-requirement-modal.html
 *
 * v1.0 → v1.0.3 主要变化:
 *   - 720px → 420px(决策 28 紧凑型)
 *   - 5 字段 → 1 字段(决策 24 陪伴 + 功能内聚)
 *   - 移除:目标分支 / 关联仓库 / PRD 原文 / Skill 链(分别由决策 4/7/Q7/38 接手)
 *   - 新增:slug 实时预览 + 字数计数 + 路径字符实时过滤(决策 E2/E3)
 *   - 提交后:立即关闭弹窗 + 跳 DRAFTING(决策 57),不再 mock 推入列表
 *
 * 入口(决策 5 / Q12):
 *   - ⌘N / Ctrl+N 全局快捷键(keyboard-bridge 在 ui-overlay-store 实现)
 *   - Cmd+K 命令面板搜"新建需求"(command-palette.tsx 调 openCmdN)
 *   - 概览页 `+ 新建需求` 按钮 — (workspace)/page.tsx
 *   - 需求列表页 `+ 新建需求` 按钮 — (workspace)/requirements/page.tsx
 */
import { useUIOverlay } from './ui-overlay-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTabFocusTrap } from '@/hooks/use-tab-focus-trap';

/**
 * slug 生成规则 — PRD §8.3
 * - title → kebab-case
 * - 去路径非法字符(决策 E3)
 * - 保留中文 / 英文字母 / 数字 / `-` / `_` / `.`
 * - 截断 50 字,空 fallback `untitled`
 */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[\s　]+/g, '-') // 空白(含全角空格)→ -
      .replace(/[\\\/:*?"<>|]/g, '') // 路径非法字符去除
      .replace(/[^\p{L}\p{N}\-_.]/gu, '') // 仅保留 unicode 字母数字 + - _ .
      .replace(/-+/g, '-') // 多个 - 合并
      .replace(/^-+|-+$/g, '') // 去首尾 -
      .slice(0, 50) || 'untitled'
  );
}

/**
 * 路径非法字符过滤(决策 E3)
 * - 输入层实时过滤 `\` `/` `:` `*` `?` `"` `<` `>` `|`
 * - 不改变中英文 / 数字 / 常见标点
 */
const FORBIDDEN_CHARS = /[\\\/:*?"<>|]/g;
function filterForbidden(input: string): string {
  return input.replace(FORBIDDEN_CHARS, '');
}

export function NewRequirementModal() {
  const { cmdN, close, restoreFocus } = useUIOverlay();
  const router = useRouter();
  const [name, setName] = useState('');
  const formRef = useRef<HTMLFormElement | null>(null);

  // 打开时重置(决策 E10 — 取消无副作用)
  useEffect(() => {
    if (cmdN) {
      setName('');
    }
  }, [cmdN]);

  // 关闭时焦点回触发按钮(决策 24 / 30 a11y)——
  // 参考 aux-drawer.tsx 的 prop-driven effect 模式,而不是 setTimeout,
  // 避免 React 18 batching 抖动。`restoreFocus` 内部用 captureTrigger
  // 在 open/keydown 阶段采下的 lastFocusedRef。
  useEffect(() => {
    if (!cmdN) restoreFocus();
  }, [cmdN, restoreFocus]);

  // Tab/Shift+Tab 焦点陷阱(spec §11) — 抽到 useTabFocusTrap 与 attach-repos-dialog 复用,
  // 这里只关注 Tab;Escape 由 store 全局 keydown 处理。
  useTabFocusTrap(cmdN, formRef);

  // 实时过滤 + 截断 50 字(决策 E2 + E3)
  const handleNameChange = (v: string) => {
    setName(filterForbidden(v).slice(0, 50));
  };

  // slug 预览(决策 24 陪伴感)
  const slug = useMemo(() => slugify(name), [name]);
  const slugPreview = name.trim().length > 0 ? `req-${slug}` : 'req-NNN-<slug>';

  // 提交按钮启用条件(决策 E1 — trim 后非空)
  const canSubmit = name.trim().length > 0;

  if (!cmdN) return null;

  /**
   * 提交(决策 11 I 方案)
   * 1. 立即关闭弹窗
   * 2. 跳 DRAFTING 工位(决策 57 默认 redirect)
   * 3. Agent 端接管:写 meta.yaml + requirement.md
   * 4. DRAFTING 显示骨架屏 → 完成后 banner 出现
   *
   * 注:N-NNN 占位用 timestamp 后 6 位(mvp 阶段;
   * p1+ 后端会查 requirements/ 目录实际计算最大编号 + 1)
   */
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const nn = String(Date.now()).slice(-6);
    const id = `req-${nn}-${slug}`;
    // Step 11 仅 mock 跳转;P1+ Agent 接通 (POST /api/requirements + 写文件)
    close();
    router.push(`/requirements/${id}/drafting/`);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-8"
      onClick={close}
      role="presentation"
    >
      <form
        ref={formRef}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        data-testid="new-req-modal"
        aria-modal="true"
        aria-labelledby="new-req-modal-title"
        aria-describedby="new-req-modal-desc"
        className="relative z-[101] w-[420px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Head */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2
            id="new-req-modal-title"
            className="text-xl font-semibold tracking-tight flex items-center gap-3 text-text-1"
          >
            <span className="text-lg">✨</span>
            新建需求
          </h2>
          <button
            type="button"
            data-testid="new-req-modal-close"
            onClick={close}
            title="关闭 (ESC)"
            aria-label="关闭"
            className="w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm flex items-center justify-center hover:bg-bg-elevated hover:text-text-1"
          >
            ✕
          </button>
        </div>

        {/* Body — 单字段(决策 8 i) */}
        <div className="px-6 py-6">
          <div className="mb-5">
            <label
              htmlFor="new-req-name"
              className="block text-sm font-medium text-text-1 mb-2"
            >
              需求名称 <span className="text-destructive">*</span>
            </label>
            <input
              id="new-req-name"
              type="text"
              autoFocus
              maxLength={50}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="如:退款功能优化"
              aria-required="true"
              className="w-full px-3 py-3 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 font-sans outline-none transition focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]"
            />
            <div id="new-req-modal-desc" className="text-xs text-text-3 mt-1">
              创建后跳到 DRAFTING 工位继续
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="text-sm font-mono text-text-3">
                {name.trim().length > 0 ? (
                  <>
                    req-<span className="text-text-2">NNN</span>-
                    <span className="text-brand-600">{slug}</span>
                  </>
                ) : (
                  <span className="opacity-60">{slugPreview}</span>
                )}
              </div>
              <div className="text-xs font-mono text-text-3">
                {name.length} / 50
              </div>
            </div>
          </div>
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-subtle">
          <div className="text-xs text-text-3">⌘N 全局快捷键 · ESC 关闭</div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="new-req-modal-cancel"
              onClick={close}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium text-text-2 hover:text-text-1"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="new-req-modal-submit"
              disabled={!canSubmit}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ✓ 创建
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
