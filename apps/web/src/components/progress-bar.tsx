interface Props { percent: number; color?: 'brand' | 'warning' | 'planning'; }
const COLOR_CLASS: Record<NonNullable<Props['color']>, string> = {
  brand: 'bg-brand', warning: 'bg-warning', planning: 'bg-[#a5b4fc]',
};

export function ProgressBar({ percent, color = 'brand' }: Props) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1 bg-bg-subtle rounded-sm overflow-hidden">
        <div className={`h-full ${COLOR_CLASS[color]} rounded-sm`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <span className="text-xs text-text-3 font-variant-numeric tabular-nums">{percent}%</span>
    </div>
  );
}