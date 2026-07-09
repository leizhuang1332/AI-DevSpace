'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 避免 hydration mismatch：next-themes 在 SSR 时不知道客户端主题
  useEffect(() => setMounted(true), []);

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-sm">
      {OPTIONS.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={
              'px-3 py-1 transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-foreground hover:bg-accent')
            }
            aria-pressed={active}
            title={`当前：${mounted ? resolvedTheme : 'loading'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
