'use client'

export interface RadioPillOption<T extends string> {
  value: T
  label: string
}

export interface RadioPillGroupProps<T extends string> {
  options: ReadonlyArray<RadioPillOption<T>>
  value: T | undefined
  onChange: (value: T) => void
  busy?: boolean
  ariaLabel: string
}

export function RadioPillGroup<T extends string>({
  options,
  value,
  onChange,
  busy,
  ariaLabel,
}: RadioPillGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex bg-bg-subtle rounded-md p-0.5 gap-0.5"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={busy}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-sm text-sm ${
              active
                ? 'bg-bg-elevated text-text-1 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                : 'text-text-2'
            } ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
