import { clsx } from 'clsx';
import type { RequirementStatusT } from '@ai-devspace/shared';

const VARIANTS: Record<RequirementStatusT, { dot: string; bg: string; label: string }> = {
  draft:        { dot: 'bg-[#cbd5e1]', bg: 'bg-bg-subtle',          label: '草稿' },
  drafting:     { dot: 'bg-[#e2e8f0]', bg: 'bg-bg-subtle',          label: '写 PRD' },
  analyzing:    { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '分析中' },
  designing:    { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '设计中' },
  planning:     { dot: 'bg-[#a5b4fc]', bg: 'bg-bg-subtle',          label: '计划中' },
  implementing: { dot: 'bg-brand',     bg: 'bg-bg-subtle',          label: '实施中' },
  submitting:   { dot: 'bg-warning',   bg: 'bg-bg-subtle',          label: '提交中' },
  done:         { dot: 'bg-success',   bg: 'bg-bg-subtle',          label: '已完成' },
  archived:     { dot: 'bg-[#64748b]', bg: 'bg-bg-subtle',          label: '已归档' },
  // CLARIFYING 特殊:品牌色点 + 警告红角标
  clarifying:   { dot: 'bg-brand',     bg: 'bg-bg-subtle',          label: '待澄清' },
};

// Shared dot color map for cross-component reuse (e.g. StatusBar).
// Values match the resolved CSS color used by StatusBadge's `dot` class
// so any consumer (status dot, inline style, etc.) renders the same color.
export const STATUS_DOT: Record<RequirementStatusT, string> = {
  draft:        'var(--text-3)',
  drafting:     '#cbd5e1',
  analyzing:    '#a5b4fc',
  designing:    '#a5b4fc',
  planning:     '#a5b4fc',
  implementing: 'var(--brand)',
  submitting:   'var(--warning)',
  done:         'var(--success)',
  archived:     '#64748b',
  clarifying:   'var(--brand)',
};

export function StatusBadge({ status }: { status: RequirementStatusT }) {
  const v = VARIANTS[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 h-5 px-2 rounded text-xs font-medium', v.bg, 'text-text-2')}>
      <span className={clsx('w-1.5 h-1.5 rounded-full relative', v.dot)}>
        {status === 'clarifying' && (
          <span className="absolute -top-0.5 -right-0.5 w-[5px] h-[5px] rounded-full bg-error border-[1.5px] border-bg-elevated" />
        )}
      </span>
      {v.label}
    </span>
  );
}