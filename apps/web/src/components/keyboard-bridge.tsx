'use client';
import { useEffect } from 'react';

// Task 9 起接入真实 CommandPalette / NewRequirementModal / ShortcutsCheatsheet
// 本 task 仅注册键盘监听 + 写 console.log 占位
export function KeyboardBridge() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+K -> CommandPalette (Task 9)');
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+N -> NewRequirementModal (Task 9)');
      }
      if (e.key === '/') {
        e.preventDefault();
        console.log('[KeyboardBridge] Cmd+/ -> ShortcutsCheatsheet (Task 9)');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
