'use client';
import { useState } from 'react';
import type { DraftingSkill } from '@/lib/drafting';

interface Props {
  requirementId: string;
  /**
   * DRAFTING 工位专用:候命 Skill 列表(由父组件 server 端注入)。
   * 传入时,Inline 栏切换为"候命 Skill"section,覆盖默认的"AI 提示 / 检查 / 阻断"卡片列表。
   * 期望的典型 Skill:requirement-brainstorm / requirement-clarify / schema-design(issue 18)。
   */
  draftingSkills?: DraftingSkill[];
  /**
   * 点击 Skill trigger 按钮时的回调(issue 18 验收 #5 "点击可唤起 Skill")。
   * 实际唤起动作由调用方实现(本期 mock:打开 Cmd+K 浮层或聚焦主区 PRD)。
   */
  onSkillTrigger?: (skill: DraftingSkill) => void;
}

interface RailCard {
  type: 'tip' | 'warn' | 'err' | 'plain';
  title: string;
  body: React.ReactNode;
  action?: string;
}

const CARDS_BY_REQ: Record<string, RailCard[]> = {
  'req-001': [
    {
      type: 'tip',
      title: '✨ 缺索引建议',
      body: (
        <>
          检测到 <code className="font-mono">WHERE user_id + status</code> 查询无合适索引,建议在{' '}
          <code className="font-mono">refund_order</code> 表加{' '}
          <code className="font-mono">idx_user_status_created</code>
        </>
      ),
      action: '应用建议 →',
    },
    {
      type: 'warn',
      title: '⚠ 待回答',
      body: '退款失败时是否要回滚已扣减的优惠券额度?',
      action: '⌘K 去回答 →',
    },
    {
      type: 'plain',
      title: '📊 进度',
      body: '设计阶段 100% · 计划阶段 100% · 实施阶段 62% (12/19 tasks)',
    },
    {
      type: 'err',
      title: '🚨 Skill 阻塞',
      body: 'code-stage 等待 3 个澄清问题的回复',
    },
  ],
};

const BORDER_COLOR: Record<RailCard['type'], string> = {
  tip: 'var(--brand)',
  warn: 'var(--warning)',
  err: 'var(--error)',
  plain: 'var(--border)',
};

export function InlineRail({ requirementId, draftingSkills, onSkillTrigger }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  if (draftingSkills) {
    return (
      <DraftingSkillRail
        requirementId={requirementId}
        skills={draftingSkills}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        onSkillTrigger={onSkillTrigger}
      />
    );
  }

  const cards = CARDS_BY_REQ[requirementId] ?? [];

  if (collapsed) {
    return (
      <aside className="bg-bg-subtle border-l border-border p-3 w-12 flex flex-col items-center">
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-3 hover:text-text-1 text-xs"
          aria-label="展开 AI 提示栏"
        >
          ⟩
        </button>
      </aside>
    );
  }

  return (
    <aside className="bg-bg-subtle border-l border-border p-3 overflow-auto w-60">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-text-3 font-medium">AI 提示</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-3 text-xs hover:text-text-1"
          aria-label="折叠 AI 提示栏"
        >
          ⟨ 折叠
        </button>
      </div>
      {cards.map((c, i) => (
        <div
          key={i}
          className="bg-bg-elevated rounded-md p-3 mb-2 text-sm relative"
          style={{ borderLeft: `3px solid ${BORDER_COLOR[c.type]}` }}
        >
          <div className="font-medium mb-1">{c.title}</div>
          <div className="text-text-2 leading-relaxed">{c.body}</div>
          {c.action && (
            <button className="mt-2 text-xs text-brand-600 hover:underline">{c.action}</button>
          )}
        </div>
      ))}
    </aside>
  );
}

// ============================================================================
// DRAFTING 专用视图:候命 Skill 列表(issue 18 · ADR-0011 §5 选项 C Inline 栏下放)
// ============================================================================

function DraftingSkillRail({
  requirementId,
  skills,
  collapsed,
  setCollapsed,
  onSkillTrigger,
}: {
  requirementId: string
  skills: DraftingSkill[]
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  onSkillTrigger?: (skill: DraftingSkill) => void
}) {
  if (collapsed) {
    return (
      <aside
        data-testid="inline-rail"
        data-rail-mode="drafting-skills"
        data-requirement-id={requirementId}
        data-skill-count={skills.length}
        className="bg-bg-subtle border-l border-border p-3 w-12 flex flex-col items-center"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-3 hover:text-text-1 text-xs"
          aria-label="展开候命 Skill 列表"
        >
          ⟩
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="inline-rail"
      data-rail-mode="drafting-skills"
      data-requirement-id={requirementId}
      data-skill-count={skills.length}
      className="bg-bg-subtle border-l border-border p-3 overflow-auto w-60"
    >
      <div className="flex items-center justify-between mb-3">
        <span
          data-testid="inline-rail-drafting-title"
          className="text-xs uppercase tracking-wider text-text-3 font-medium"
        >
          候命 Skill
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-3 text-xs hover:text-text-1"
          aria-label="折叠候命 Skill 列表"
        >
          ⟨ 折叠
        </button>
      </div>

      <ul
        data-testid="inline-rail-drafting-skills"
        className="flex flex-col gap-2"
      >
        {skills.map((s) => (
          <li
            key={s.id}
            data-testid="inline-rail-drafting-skill"
            data-skill-id={s.id}
            data-skill-name={s.name}
            className="bg-bg-elevated rounded-md p-3 text-sm relative border-l-[3px] border-brand"
          >
            <div className="font-semibold text-text-1 mb-0.5 flex items-center gap-1.5">
              <span aria-hidden>🤖</span>
              <span className="font-mono text-xs">{s.name}</span>
            </div>
            <div className="text-text-2 leading-relaxed text-xs mb-1.5">
              {s.description}
            </div>
            <button
              type="button"
              data-testid="inline-rail-drafting-skill-trigger"
              data-skill-id={s.id}
              onClick={() => onSkillTrigger?.(s)}
              className="text-xs text-brand-600 hover:underline font-medium"
            >
              {s.trigger} →
            </button>
          </li>
        ))}
      </ul>

      <p
        data-testid="inline-rail-drafting-tip"
        className="text-[11px] text-text-3 mt-3 leading-relaxed"
      >
        这些 Skill 在 DRAFTING 工位候命 —— 点击或通过 <code className="font-mono">⌘K</code> 唤起。
        它们不修改你的 PRD,只在你需要时辅助。
      </p>
    </aside>
  );
}