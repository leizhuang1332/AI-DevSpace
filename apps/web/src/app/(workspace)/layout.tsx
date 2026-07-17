import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { UIOverlayProvider } from '@/components/ui-overlay-store';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsCheatsheet } from '@/components/shortcuts-cheatsheet';
import { NewRequirementModal } from '@/components/new-requirement-modal';
import { ZoneBar } from '@/components/zone-bar';
import { SSEInvalidator } from '@/components/sse-invalidator';
import { fetchRequirementsServer } from '@/lib/requirement-list.server';
import { QueryProvider } from './providers';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  // ticket 07b:RSC 内直接 fetch agent(decision D1,cookie 透传)
  // SSE 推送 → router.refresh() → 重新执行本 layout 的 server fetch
  const tabs = await fetchRequirementsServer()

  return (
    <QueryProvider>
      <UIOverlayProvider>
        <div className="min-h-screen flex flex-col">
          {/* StatusBar + ZoneBar 共享一个 sticky 容器(issue: sticky zone-bar):
              两者在主区滚动时始终钉在 viewport 顶部。容器只挂 sticky 骨架,
              内部 StatusBar/ZoneBar 各自的 bg / border 保留,视觉与改动前一致。
              总高度 84px(h-10 + h-11),与 ZoneShell 的 WORKSPACE_SHELL_OFFSET_PX 对齐。 */}
          <div className="sticky top-0 z-50 flex flex-col">
            <StatusBar tabs={tabs} currentId={null} />
            <ZoneBar />
          </div>
          <div className="flex-1 grid grid-cols-[56px_1fr]">
            <Sidebar />
            <main className="overflow-auto">{children}</main>
          </div>
        </div>
        <CommandPalette />
        <ShortcutsCheatsheet />
        <NewRequirementModal />
        <SSEInvalidator />
      </UIOverlayProvider>
    </QueryProvider>
  );
}