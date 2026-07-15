import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { UIOverlayProvider } from '@/components/ui-overlay-store';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsCheatsheet } from '@/components/shortcuts-cheatsheet';
import { NewRequirementModal } from '@/components/new-requirement-modal';
import { ZoneBar } from '@/components/zone-bar';
import { requirements } from '@/app/(workspace)/data/mock';
import { QueryProvider } from './providers';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Task 9: UIOverlayProvider wraps the entire shell + 3 overlays mounted alongside (ADR-0007).
  // /dev/* 不在 (workspace) 路由组下,因此 dev 页面不会响应键盘监听。
  // issue 02: QueryProvider (client) 上移到 layout，让 settings 等子路由共享缓存
  // issue 13: ZoneBar 在 /requirements/[id]/[zone]/ 路由下渲染(7 Tab · ADR-0012 §6)
  // issue 16(wontfix 2026-07): 全局 ThinkBar 已下线(无实际作用、挡视线),
  //   shell 层 1 底部不再渲染 AI 思考条。详见 issue 16 wontfix。
  return (
    <QueryProvider>
      <UIOverlayProvider>
        <div className="min-h-screen flex flex-col">
          {/* StatusBar + ZoneBar 共享一个 sticky 容器(issue: sticky zone-bar):
              两者在主区滚动时始终钉在 viewport 顶部。容器只挂 sticky 骨架,
              内部 StatusBar/ZoneBar 各自的 bg / border 保留,视觉与改动前一致。
              总高度 84px(h-10 + h-11),与 ZoneShell 的 WORKSPACE_SHELL_OFFSET_PX 对齐。 */}
          <div className="sticky top-0 z-50 flex flex-col">
            <StatusBar tabs={requirements} currentId="req-001" />
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
      </UIOverlayProvider>
    </QueryProvider>
  );
}