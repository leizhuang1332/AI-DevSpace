import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { UIOverlayProvider } from '@/components/ui-overlay-store';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsCheatsheet } from '@/components/shortcuts-cheatsheet';
import { NewRequirementModal } from '@/components/new-requirement-modal';
import { ZoneBar } from '@/components/zone-bar';
import { ThinkBarSlot } from '@/components/think-bar-slot';
import { requirements } from '@/app/(workspace)/data/mock';
import { QueryProvider } from './providers';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Task 9: UIOverlayProvider wraps the entire shell + 3 overlays mounted alongside (ADR-0007).
  // /dev/* 不在 (workspace) 路由组下,因此 dev 页面不会响应键盘监听。
  // issue 02: QueryProvider (client) 上移到 layout，让 settings 等子路由共享缓存
  // issue 13: ZoneBar 在 /requirements/[id]/[zone]/ 路由下渲染(7 Tab · ADR-0012 §6)
  // issue 16: ThinkBar 在 shell 层 1 底部 — 内容由 useZone() 注入;
  //   - 工位路由 → zone.thinking_bar + 工位级 AI 状态
  //   - Overview 路由 → 'required' + 需求级 AI 状态
  //   - 其他路由   → 'required' + ambient(决策 24 "AI 始终在场")
  return (
    <QueryProvider>
      <UIOverlayProvider>
        <div className="min-h-screen flex flex-col">
          <StatusBar tabs={requirements} currentId="req-001" aiStatus="thinking" />
          <ZoneBar />
          <div className="flex-1 grid grid-cols-[56px_1fr]">
            <Sidebar />
            <main className="overflow-auto">{children}</main>
          </div>
          {/* Shell 层 1 · 底部全局 AI 思考条(issue 16 · ADR-0012 §3) */}
          <ThinkBarSlot />
        </div>
        <CommandPalette />
        <ShortcutsCheatsheet />
        <NewRequirementModal />
      </UIOverlayProvider>
    </QueryProvider>
  );
}