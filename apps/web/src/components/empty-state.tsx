interface Cta { label: string; href?: string; onClick?: () => void; }
interface Props { icon: string; title: string; subtitle?: string; cta?: Cta; }

export function EmptyState({ icon, title, subtitle, cta }: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-text-3 border border-dashed border-border-strong rounded-lg">
      <div className="text-5xl mb-3 opacity-50">{icon}</div>
      <div className="text-text-2 mb-1">{title}</div>
      {subtitle && <div className="text-sm mb-4">{subtitle}</div>}
      {cta && (
        <a href={cta.href} onClick={cta.onClick}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md font-medium text-sm bg-brand text-white hover:bg-brand-600">
          {cta.label}
        </a>
      )}
    </div>
  );
}