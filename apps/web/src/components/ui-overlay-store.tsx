'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Key = 'cmdK' | 'cmdSlash' | 'cmdN';

interface State {
  cmdK: boolean;
  cmdSlash: boolean;
  cmdN: boolean;
  open: (k: Key) => void;
  close: () => void;
}

const Ctx = createContext<State | null>(null);

export function UIOverlayProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Record<Key, boolean>>({ cmdK: false, cmdSlash: false, cmdN: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      // Esc closes overlays regardless of meta
      if (e.key === 'Escape') {
        setS({ cmdK: false, cmdSlash: false, cmdN: false });
        return;
      }
      if (!meta) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        setS((prev) => ({ ...prev, cmdK: true }));
      }
      if (e.key === '/') {
        e.preventDefault();
        setS((prev) => ({ ...prev, cmdSlash: true }));
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setS((prev) => ({ ...prev, cmdN: true }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value: State = {
    ...s,
    open: (k) => setS((prev) => ({ ...prev, [k]: true })),
    close: () => setS({ cmdK: false, cmdSlash: false, cmdN: false }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUIOverlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUIOverlay must be used inside UIOverlayProvider');
  return v;
}