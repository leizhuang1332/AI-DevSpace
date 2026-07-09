import type { ReactNode } from 'react';
import { StatusBar } from '@/components/statusbar';
import { Sidebar } from '@/components/sidebar';
import { KeyboardBridge } from '@/components/keyboard-bridge';
import { requirements } from '@/app/(workspace)/data/mock';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Task 5 接真实数据；Task 2 mock：以 req-001 为 current
  return (
    <div className="min-h-screen flex flex-col">
      <KeyboardBridge />
      <StatusBar tabs={requirements} currentId="req-001" aiStatus="thinking" />
      <div className="flex-1 grid grid-cols-[56px_1fr]">
        <Sidebar />
        <main className="overflow-auto">{children}</main>
      </div>
    </div>
  );
}
