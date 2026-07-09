const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;
const FONT_SIZES = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
const RADII = ['sm', 'md', 'lg', 'xl'] as const;
const SHADOWS = ['sm', 'md', 'lg', 'xl'] as const;
const SEMANTIC_COLORS = [
  { name: 'success', token: '--success-500' },
  { name: 'warning', token: '--warning-500' },
  { name: 'error', token: '--error-500' },
  { name: 'info', token: '--info-500' },
] as const;

// 静态 class 映射（Tailwind JIT 扫描不到动态拼接的 class 名，必须显式列出）
const FONT_SIZE_CLASS: Record<(typeof FONT_SIZES)[number], string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
};
const RADIUS_CLASS: Record<(typeof RADII)[number], string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};
const THEME_COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
] as const;

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="mb-2 text-3xl font-bold">Design Tokens</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Dev-only 页：<code>pnpm dev</code> 下访问，prod 构建被 layout 排除
      </p>

      <Section title="Spacing（4 倍数）">
        <div className="space-y-2">
          {SPACING.map((n) => (
            <div key={n} className="flex items-center gap-4 text-sm">
              <span className="w-12 font-mono text-muted-foreground">--space-{n}</span>
              <div
                className="bg-primary"
                style={{ width: `var(--space-${n})`, height: 16 }}
              />
              <span className="font-mono text-xs text-muted-foreground">
                var(--space-{n})
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Font Size（9 档）">
        <div className="space-y-2">
          {FONT_SIZES.map((s) => (
            <div key={s} className="flex items-baseline gap-4">
              <span className="w-12 font-mono text-xs text-muted-foreground">text-{s}</span>
              <span className={FONT_SIZE_CLASS[s]}>AI-DevSpace 字体样本</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Border Radius（4 档）">
        <div className="flex gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div
                className={`h-16 w-16 border-2 border-primary bg-accent ${RADIUS_CLASS[r]}`}
              />
              <span className="font-mono text-xs text-muted-foreground">rounded-{r}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shadow（4 档）">
        <div className="flex gap-6">
          {SHADOWS.map((s) => (
            <div key={s} className="flex flex-col items-center gap-2">
              <div
                className="h-16 w-16 rounded-md bg-card"
                style={{ boxShadow: `var(--shadow-${s})` }}
              />
              <span className="font-mono text-xs text-muted-foreground">shadow-{s}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="主题色（light 当前显示）">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {THEME_COLOR_TOKENS.map((k) => (
            <div key={k} className="overflow-hidden rounded-md border border-border">
              <div
                className="h-12"
                style={{ backgroundColor: `hsl(var(--${k}))` }}
              />
              <div className="p-2 text-xs">
                <div className="font-mono">{k}</div>
                <div className="font-mono text-muted-foreground">--{k}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="语义色">
        <div className="flex gap-3">
          {SEMANTIC_COLORS.map((c) => (
            <div key={c.name} className="flex flex-col items-center gap-1">
              <div
                className="h-12 w-12 rounded-md"
                style={{ backgroundColor: `hsl(var(${c.token}))` }}
              />
              <span className="font-mono text-xs text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Font Family">
        <p className="font-sans text-base">font-sans：Inter / PingFang SC / Microsoft YaHei</p>
        <p className="mt-2 font-mono text-sm">font-mono：JetBrains Mono / ui-monospace</p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
