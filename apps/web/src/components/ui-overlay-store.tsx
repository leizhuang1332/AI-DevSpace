'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Key = 'cmdK' | 'cmdSlash' | 'cmdN';

interface State {
  cmdK: boolean;
  cmdSlash: boolean;
  cmdN: boolean;
  open: (k: Key) => void;
  close: () => void;
  /**
   * 关闭单个 overlay —— 用于「Cmd+K「新建需求」 → 打开 cmdN」等场景:
   * `open('cmdN')` 和 `closeKey('cmdK')` 在同一事件 handler 中
   * 会被 React 18 batch,而 `close()` 会全量重置三者,把 `open` 覆盖掉。
   * 用 `closeKey` 即可避免。
   */
  closeKey: (k: Key) => void;
  /**
   * 焦点回触发 — 在弹窗关闭时由 NewRequirementModal 等调用,
   * 把焦点还原到打开弹窗前的元素(决策 24 / 30 a11y)。
   *
   * 采集发生在 `open()` / 快捷键 keydown 阶段,确保在 React 把
   * autoFocus 抢走焦点之前采到 trigger。
   */
  restoreFocus: () => void;
}

const Ctx = createContext<State | null>(null);

export function UIOverlayProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Record<Key, boolean>>({ cmdK: false, cmdSlash: false, cmdN: false });
  // 记录弹窗打开前的 activeElement,关闭后由各 overlay 调 restoreFocus 还原
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const captureTrigger = () => {
    lastFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
  };
  const restoreFocus = () => {
    const el = lastFocusedRef.current;
    if (el && typeof el.focus === 'function' && el.isConnected) {
      el.focus({ preventScroll: true });
    }
  };

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
        captureTrigger();
        setS((prev) => ({ ...prev, cmdK: true }));
      }
      if (e.key === '/') {
        e.preventDefault();
        captureTrigger();
        setS((prev) => ({ ...prev, cmdSlash: true }));
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        captureTrigger();
        setS((prev) => ({ ...prev, cmdN: true }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value: State = {
    ...s,
    open: (k) => {
      captureTrigger();
      setS((prev) => ({ ...prev, [k]: true }));
    },
    close: () => setS({ cmdK: false, cmdSlash: false, cmdN: false }),
    closeKey: (k) => setS((prev) => ({ ...prev, [k]: false })),
    restoreFocus,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUIOverlay() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUIOverlay must be used inside UIOverlayProvider');
  return v;
}