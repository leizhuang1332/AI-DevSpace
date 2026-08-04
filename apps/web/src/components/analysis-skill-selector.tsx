/**
 * Analysis Skill 单选器(issue 01 · ADR-0021)
 *
 * 替代原 Admission Dimension 卡片(issue 19a 引入),在 ANALYZING 工位
 * 顶部展示用户已选 Analysis Skill 的"名称 + 功能简介 + 选中状态"。
 *
 * 设计要点:
 * - 数据由 server 注入(`AnalyzingData.availableSkills` +
 *   `AnalyzingData.selectedSkillName`),SSR 期已经从 fs 装载
 * - 用户点选 → 乐观切选中 + 调 `PUT /api/requirements/:id/analysis/skill-selection` 持久化
 * - 写盘失败 → 回滚选中 + toast 提示
 * - 无可用 Skill → 显示"暂无可用 Analysis Skill"明确状态 + 禁用「开始分析」
 *   (issue 01 acceptance 8:不允许用非法 Skill 启动)
 *
 * 本组件**只负责 Skill 选择**,「开始分析」按钮仍在父组件 AnalyzingZone
 * 的常驻位;父组件读 `selectedSkillName` + `availableSkills.length > 0`
 * 决定按钮 disabled。
 *
 * 视觉参考:Linear 风格的极简 radio 列表,每行 = 1 个 Skill;
 * 选中态用左侧 radio 实心圆 + 行高亮 + 左侧 brand 色边。
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AnalysisSkillMeta } from '@ai-devspace/shared'
import {
  writeSelection,
  AnalysisSkillError,
} from '@/lib/analysis-skill'

export interface AnalysisSkillSelectorProps {
  requirementId: string
  availableSkills: ReadonlyArray<AnalysisSkillMeta>
  selectedSkillName: string
  /**
   * 写盘失败 / 写盘过程中 → 通知父组件(用于在「开始分析」按钮旁显示
   * "正在保存选择..." 提示;本期最小实现留接口,父组件可不传)
   */
  onSelectionChange?: (skillName: string) => void
  /**
   * 写盘失败时回调(用于 toast);不传 → 静默 console.warn
   */
  onError?: (message: string) => void
}

/**
 * 单选器外壳:无 Skill 时显示空态;有 Skill 时显示列表。
 */
export function AnalysisSkillSelector({
  requirementId,
  availableSkills,
  selectedSkillName,
  onSelectionChange,
  onError,
}: AnalysisSkillSelectorProps) {
  if (availableSkills.length === 0) {
    return <EmptyState />
  }
  return (
    <List
      requirementId={requirementId}
      availableSkills={availableSkills}
      selectedSkillName={selectedSkillName}
      onSelectionChange={onSelectionChange}
      onError={onError}
    />
  )
}

// ---------------------------------------------------------------------------
// 空态:无任何可用 Skill(issue 01 acceptance 8:不允许用非法 Skill 启动)
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div
      data-testid="analysis-skill-selector-empty"
      data-state="no_skills"
      className="bg-bg-elevated border border-border rounded-lg px-4 py-3 flex items-center gap-3"
    >
      <div
        data-testid="analysis-skill-selector-empty-icon"
        className="w-8 h-8 rounded-full bg-bg-subtle flex items-center justify-center text-base"
        aria-hidden
      >
        ⚠️
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="analysis-skill-selector-empty-title"
          className="text-sm font-semibold text-text-1"
        >
          暂无可用 Analysis Skill
        </div>
        <div className="text-text-2 text-[11px] leading-relaxed">
          Workspace 的 Analysis Skill 集合为空,无法发起分析。请检查
          <code className="mx-1 px-1 bg-bg-subtle rounded font-mono">
            ~/.aidevspace/analysis-skills/
          </code>
          目录或重启 Agent 让默认 Skill 重新落盘。
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 列表:有 Skill 时显示 radio 列表
// ---------------------------------------------------------------------------

interface ListProps {
  requirementId: string
  availableSkills: ReadonlyArray<AnalysisSkillMeta>
  selectedSkillName: string
  onSelectionChange?: (skillName: string) => void
  onError?: (message: string) => void
}

function List({
  requirementId,
  availableSkills,
  selectedSkillName,
  onSelectionChange,
  onError,
}: ListProps) {
  // 写盘中的乐观状态:把已选 Skill 立刻切到 UI 上(写盘失败回滚)
  // 与 server 注入的 selectedSkillName 区分,避免 SSR / client hydration 漂移
  // —— 初始值 = server 注入,后续用户操作才走乐观切
  const [optimistic, setOptimistic] = useState<string>(selectedSkillName)
  const [pending, setPending] = useState<boolean>(false)

  // 若 props 变化(SSE 推送 / SSR re-render / 路由切换)→ 重新同步
  // —— 切需求时 selectedSkillName 会变;此 effect 让乐观值也跟着变
  // (避免 useState 只在首次 mount 捕获旧值)。
  //
  // 不在 render 期间 setOptimistic:虽然 React 18 在值不变时会 bail out,但
  // 与父级 router.refresh() / SSEInvalidator 引发的连续 re-render 叠加时
  // 会触发 "Maximum update depth exceeded"(参考 analyzing-zone 同步 effect
  // 同类问题的修复)。Effect 里同步语义相同,行为更稳。
  //
  // 仅在不写盘时同步;写盘中的乐观值不被外部 props 覆盖(否则用户点选 →
  // 写盘期间 server 又推回旧值 → 乐观值被擦,写盘成功后 server 返回新值又
  // 同步,会出现一帧的"选中态消失"视觉抖跳)。
  useEffect(() => {
    if (!pending && optimistic !== selectedSkillName) {
      setOptimistic(selectedSkillName)
    }
  }, [selectedSkillName, pending, optimistic])

  const handleSelect = useCallback(
    (name: string) => {
      if (name === optimistic || pending) return
      const prev = optimistic
      setOptimistic(name)
      onSelectionChange?.(name)
      setPending(true)
      writeSelection(requirementId, { skill_name: name })
        .then((res) => {
          // 写盘成功 → 服务端确认(可能与乐观值一致;若不一致,取服务端)
          if (res.selected_skill_name !== name) {
            setOptimistic(res.selected_skill_name)
          }
        })
        .catch((err: unknown) => {
          // 写盘失败 → 回滚 + 提示
          setOptimistic(prev)
          const message =
            err instanceof AnalysisSkillError
              ? `保存 Analysis Skill 选择失败:${err.message}`
              : err instanceof Error
                ? `保存 Analysis Skill 选择失败:${err.message}`
                : '保存 Analysis Skill 选择失败'
          if (onError) onError(message)
          else console.warn(message, err)
        })
        .finally(() => {
          setPending(false)
        })
    },
    [requirementId, optimistic, pending, onSelectionChange, onError],
  )

  return (
    <div
      data-testid="analysis-skill-selector"
      data-requirement-id={requirementId}
      data-pending={pending ? 'true' : 'false'}
      className="bg-bg-elevated border border-border rounded-lg px-4 py-3"
    >
      <ul
        role="radiogroup"
        aria-label="选择 Analysis Skill"
        data-testid="analysis-skill-selector-list"
        className="flex flex-col gap-1.5"
      >
        {availableSkills.map((skill) => {
          const isSelected = optimistic === skill.name
          return (
            <li key={skill.name}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid="analysis-skill-option"
                data-skill-name={skill.name}
                data-selected={isSelected ? 'true' : 'false'}
                onClick={() => handleSelect(skill.name)}
                disabled={pending}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2 rounded-md border transition-colors ${
                  isSelected
                    ? 'border-brand bg-brand-50/40'
                    : 'border-border bg-bg-subtle hover:bg-bg-elevated'
                } ${pending ? 'cursor-wait opacity-80' : 'cursor-pointer'}`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    isSelected ? 'border-brand' : 'border-border-strong'
                  }`}
                >
                  {isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span
                      data-testid="analysis-skill-option-name"
                      className="text-sm font-semibold text-text-1 font-mono"
                    >
                      {skill.name}
                    </span>
                  </span>
                  <span
                    data-testid="analysis-skill-option-description"
                    className="block text-[12px] text-text-2 leading-snug mt-0.5"
                  >
                    {skill.description}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
