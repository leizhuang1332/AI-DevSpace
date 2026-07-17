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
 *   - ticket 06 起:提交后真正调 POST /api/requirements(ticket 04 实现),
 *     拿后端分配的 id + meta.yaml 落盘后再跳 DRAFTING(决策 57),不再 mock id
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
import {
  createRequirement,
  isCreateRequirementError,
  type CreateRequirementError,
} from '@/lib/requirement';

/**
 * slug 生成规则 — PRD §8.3
 * - title → kebab-case
 * - 去路径非法字符(决策 E3)
 * - 保留中文 / 英文字母 / 数字 / `-` / `_` / `.`
 * - 截断 50 字,空 fallback `untitled`
 *
 * 注:ticket 06 后,这个函数**只用于 UI 实时预览**;真正的 id 由后端
 * 分配并通过 POST /api/requirements 返回。
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
      .slice(0, 50) || 'untitled' // 截断 50 字,空 fallback
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // 打开时重置(决策 E10 — 取消无副作用)
  useEffect(() => {
    if (cmdN) {
      setName('');
      setSubmitError(null);
      setIsSubmitting(false);
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
    if (submitError) setSubmitError(null);
  };

  // slug 预览(决策 24 陪伴感)
  const slug = useMemo(() => slugify(name), [name]);
  const slugPreview = name.trim().length > 0 ? `req-${slug}` : 'req-NNN-<slug>';

  // 提交按钮启用条件(决策 E1 — trim 后非空 + 不在提交中)
  const canSubmit = name.trim().length > 0 && !isSubmitting;

  if (!cmdN) return null;

  /**
   * 提交(ticket 06 + 决策 11 I 方案 + PRD §7 提交后行为)
   * 1. await POST /api/requirements → 拿后端分配的 id(meta.yaml 真实落盘)
   * 2. 成功 → 关闭弹窗 + router.push(`/requirements/<id>/drafting/`)(决策 57)
   * 3. 失败 → 弹窗不关,inline 红字(对齐 PRD §9 E6-E9 + 决策 34 E7)
   *
   * 错误码映射(对齐 PRD §9):
   * - 400 E_INVALID_TITLE  → modal 不关,inline 红字
   * - 401 E_AUTH           → modal 关,跳设置页(决策 34)
   * - 5xx / 网络错         → modal 不关,inline 红字 + 用户点 ✓ 创建重试
   *
   * ticket 06 之前这里是 mock(`Date.now()` 拼 id + router.push),后端
   * 从未被调用 → DRAFTING 找不到目录,显示红色 banner(决策 E6 路径)。
   */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createRequirement({ title: name });
      // 成功:关闭弹窗 → 跳 DRAFTING(决策 57)
      close();
      router.push(`/requirements/${result.id}/drafting/`);
    } catch (err) {
      if (isCreateRequirementError(err)) {
        // 401 鉴权失败 → 跳设置页(决策 34),modal 关
        if (err.status === 401) {
          close();
          router.push('/settings/?section=agent');
          return;
        }
        // 其他错误 → modal 不关,inline 红字
        setSubmitError(humanizeError(err));
      } else {
        // 网络错 / Zod 错等 → modal 不关,inline 红字
        setSubmitError(
          err instanceof Error ? err.message : '创建失败,请重试',
        );
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-8"
      onClick={isSubmitting ? undefined : close}
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
        aria-describedby={submitError ? 'new-req-modal-error' : 'new-req-modal-desc'}
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
            disabled={isSubmitting}
            title="关闭 (ESC)"
            aria-label="关闭"
            className="w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm flex items-center justify-center hover:bg-bg-elevated hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed"
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
              aria-invalid={submitError ? 'true' : 'false'}
              aria-describedby={
                submitError ? 'new-req-modal-error' : 'new-req-modal-desc'
              }
              disabled={isSubmitting}
              className="w-full px-3 py-3 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 font-sans outline-none transition focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)] disabled:opacity-70 disabled:cursor-not-allowed"
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
            {/* 提交错误(ticket 06 · PRD §9 E6-E9 inline 提示) */}
            {submitError && (
              <div
                id="new-req-modal-error"
                data-testid="new-req-modal-error"
                role="alert"
                className="mt-3 px-3 py-2 bg-[#fef2f2] border border-[#fecaca] rounded-md text-sm text-[#991b1b] flex items-start gap-2"
              >
                <span aria-hidden="true">⚠️</span>
                <span className="flex-1">{submitError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-subtle">
          <div className="text-xs text-text-3">
            {isSubmitting ? '正在创建…' : '⌘N 全局快捷键 · ESC 关闭'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="new-req-modal-cancel"
              onClick={close}
              disabled={isSubmitting}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium text-text-2 hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="new-req-modal-submit"
              disabled={!canSubmit}
              className="inline-flex items-center h-8 px-4 rounded-md text-md font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '创建中…' : '✓ 创建'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * 把 CreateRequirementError 转成对用户友好的中文提示(避免暴露后端 JSON / AgentError 原文)。
 * - 400 E_INVALID_TITLE → 「标题不合法」
 * - 500 E_ID_COLLISION   → 「编号冲突,请稍后重试」
 * - 507 E_DISK_FULL      → 「磁盘空间不足」
 * - 其它 4xx/5xx         → 「创建失败 (HTTP <code>):<message>」
 */
function humanizeError(err: CreateRequirementError): string {
  const code = err.code
  switch (code) {
    case 'E_INVALID_TITLE':
      return '标题不合法,请检查后重试'
    case 'E_ID_COLLISION':
      return '编号冲突,请稍后重试'
    case 'E_DISK_FULL':
      return '磁盘空间不足,请清理后重试'
    default: {
      const msg =
        typeof err.body === 'object' && err.body !== null && 'message' in err.body
          ? String((err.body as { message: unknown }).message)
          : err.message
      return `创建失败 (HTTP ${err.status})${msg ? ` · ${msg}` : ''}`
    }
  }
}