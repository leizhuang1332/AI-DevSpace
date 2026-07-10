'use client'

import type { Config, ConfigPatch } from '@ai-devspace/shared'
import { RadioPillGroup } from '@/components/radio-pill-group'

export interface AppearanceSectionProps {
  config: Config
  onPatch: (patch: ConfigPatch) => Promise<void> | void
  busy: boolean
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
] as const

type ThemeValue = (typeof THEME_OPTIONS)[number]['value']

export function AppearanceSection({ config, onPatch, busy }: AppearanceSectionProps) {
  const theme = (config.theme as ThemeValue | undefined) ?? 'system'
  return (
    <section
      data-testid="section-appearance"
      className="bg-bg-elevated border border-border rounded-lg p-5 mb-4"
    >
      <h2 className="text-md font-semibold mb-1">主题</h2>
      <div className="text-sm text-text-3 mb-4">
        跟随系统 / 暗色 / 亮色（用户偏好：亮色为心智模型）
      </div>
      <RadioPillGroup<ThemeValue>
        options={THEME_OPTIONS}
        value={theme}
        onChange={(v) => onPatch({ theme: v })}
        busy={busy}
        ariaLabel="主题"
      />

      <div className="mt-6">
        <h2 className="text-md font-semibold mb-1">信息密度</h2>
        <div className="text-sm text-text-3 mb-4">全局行高与元素间距（Linear 紧凑型为默认）</div>
        <div className="grid grid-cols-[180px_1fr] gap-4 items-center py-3 border-t border-border">
          <div className="text-sm font-medium text-text-1">列表行高</div>
          <div className="text-sm text-text-3">紧凑 / 默认 / 宽松（UI 占位，本期不存 config）</div>
        </div>
      </div>
    </section>
  )
}
