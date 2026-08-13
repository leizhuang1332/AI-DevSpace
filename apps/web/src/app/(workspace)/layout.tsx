import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { UIOverlayProvider } from '@/components/ui-overlay-store';
import { AnalyzingHistoryFabControllerProvider } from '@/components/analyzing-history-fab-controller';
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
        {/* analyzing-fab ticket 04 · ADR-0022 D5.2:
            让 `<CommandPalette>`(workspace 顶层)与 `<AnalyzingZone>`(需求页深
            层)共享 controller context,Cmd+K 「🗂️ 历史分析」命令可调起浮动
            面板。AnalyzingZone 通过 setController 注册/清空。 */}
        <AnalyzingHistoryFabControllerProvider>
          {/* h-screen(definite 100vh)而非 min-h-screen:
              flex 容器主轴尺寸必须 definite,flex-1 子项才能按 available space 分配。
              min-h-screen 是 indefinite → flex 子项按 content size 撑大,长 chat 等
              场景会让 body 跟着滚(违反 workspace「body 不滚、outer main 接管滚动」契约)。 */}
          <div className="h-screen flex flex-col">
            {/* StatusBar + ZoneBar 共享一个 sticky 容器(issue: sticky zone-bar):
                两者在主区滚动时始终钉在 viewport 顶部。容器只挂 sticky 骨架,
                内部 StatusBar/ZoneBar 各自的 bg / border 保留,视觉与改动前一致。
                总高度 84px(h-10 + h-11),与 ZoneShell 的 WORKSPACE_SHELL_OFFSET_PX 对齐。 */}
            <div className="sticky top-0 z-50 flex flex-col">
              <StatusBar tabs={tabs} currentId={null} />
              <ZoneBar />
            </div>
            {/* flex-1 min-h-0:跟下方各 zone 的 h-full + flex + overflow 契约配套
                —— 缺 min-h-0 时 flex item 默认 min-height: auto,grid 拒绝收缩
                到比 content 更小,board-chat 长消息等场景会把 body 撑出 viewport,
                出现"最外层滚动条"。加 min-h-0 后 grid 锁在 (100vh - 84px),
                grid 内的 overflow-auto 子项接管滚动。 */}
            <div className="flex-1 min-h-0 grid grid-cols-[56px_1fr]">
              <Sidebar />
              <main className="overflow-auto">{children}</main>
            </div>
          </div>
          <CommandPalette />
          <ShortcutsCheatsheet />
          <NewRequirementModal />
          <SSEInvalidator />
        </AnalyzingHistoryFabControllerProvider>
      </UIOverlayProvider>
    </QueryProvider>
  );
}