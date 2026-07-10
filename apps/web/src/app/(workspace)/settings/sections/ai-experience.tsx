'use client'

import type { Config, ConfigPatch } from '@ai-devspace/shared'
import { RadioPillGroup } from '@/components/radio-pill-group'

export interface AiExperienceSectionProps {
  config: Config
  onPatch: (patch: ConfigPatch) => Promise<void> | void
  busy: boolean
}

const TYPEWRITER_OPTIONS = [
  { value: 'off', label: '关（即时）' },
  { value: 'fast', label: '快 10ms' },
  { value: 'medium', label: '中 20ms' },
  { value: 'slow', label: '慢 30ms' },
] as const

type TypewriterValue = (typeof TYPEWRITER_OPTIONS)[number]['value']

export function AiExperienceSection({ config, onPatch, busy }: AiExperienceSectionProps) {
  const speed = (config.typewriterSpeed as TypewriterValue | undefined) ?? 'medium'
  const silentWindow = Number(config.silentWindowSeconds ?? 30)

  return (
    <section
      data-testid="section-ai-experience"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">AI 体验</h2>
      <div className="text-sm text-text-3 mb-4">AI 输出、推送、行为</div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div>
          <div className="text-sm font-medium text-text-1">打字机速度</div>
          <div className="text-xs text-text-3 mt-0.5">AI 流式文本的打字速度</div>
        </div>
        <RadioPillGroup<TypewriterValue>
          options={TYPEWRITER_OPTIONS}
          value={speed}
          onChange={(v) => onPatch({ typewriterSpeed: v })}
          busy={busy}
          ariaLabel="打字机速度"
        />
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
        <div>
          <div className="text-sm font-medium text-text-1">静默窗口</div>
          <div className="text-xs text-text-3 mt-0.5">同类型事件 N 秒内不重复推</div>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={5}
            max={300}
            defaultValue={silentWindow}
            disabled={busy}
            data-testid="silent-window-input"
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 5 && v <= 300 && v !== silentWindow) {
                onPatch({ silentWindowSeconds: v })
              } else {
                e.target.value = String(silentWindow)
              }
            }}
            className="w-20 px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none focus:border-brand-500 focus:bg-bg-elevated"
          />
          <span className="text-text-3 text-sm ml-1.5">秒</span>
        </div>
      </div>
    </section>
  )
}
