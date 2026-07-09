interface Props {
  label: string;
  value: number | string;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
}

const DELTA_COLOR = { up: 'text-success', down: 'text-error', neutral: 'text-text-3' };

export function StatCard({ label, value, delta, deltaTone = 'neutral' }: Props) {
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-5">
      <div className="text-text-3 text-sm mb-2">{label}</div>
      <div className="text-[32px] font-semibold tracking-tight leading-none">{value}</div>
      {delta && <div className={`text-xs mt-2 ${DELTA_COLOR[deltaTone]}`}>{delta}</div>}
    </div>
  );
}