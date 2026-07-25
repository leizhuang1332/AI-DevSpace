'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import type { RequirementSummary } from '@ai-devspace/shared';
import { agentFetch } from '@/lib/agent-client';
import { STATUS_DOT } from './status-badge';

interface Props {
  tabs: RequirementSummary[]; // 当前工作空间的需求集
  currentId: string | null;
}

/** StatusBar rollback dropdown 用的 snapshot 元数据(与 agent `SessionSnapshotEntry` 镜像)。
 *  镜像而非 import —— apps/web 不反向 import apps/agent(package 边界),靠两端测试守护一致。
 */
interface SnapshotEntry {
  id: 'before_admission' | 'before_brainstorm';
  sessionId: string | null;
  takenAt: string | null;
}

/** 从 `/requirements/<id>/<zone>/` pathname 抽出 req-id;非 requirements 路由返 null。 */
function parseReqId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = /^\/requirements\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

export function StatusBar({ tabs, currentId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reqId = parseReqId(pathname);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // ticket 06:从 agent 拉 snapshot 列表 —— 仅在 requirement 路由 + dropdown 打开时拉
  useEffect(() => {
    if (!reqId) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const json = await agentFetch<{ snapshots: SnapshotEntry[] }>(
          `/api/requirements/${reqId}/analysis/snapshots`,
        );
        if (!cancelled) setSnapshots(json.snapshots ?? []);
      } catch {
        if (!cancelled) setSnapshots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reqId]);

  async function handleRestore(snap: SnapshotEntry) {
    if (!reqId || restoring) return;
    setRestoring(true);
    try {
      await agentFetch(`/api/requirements/${reqId}/analysis/restore`, {
        method: 'POST',
        body: JSON.stringify({ snapshot_id: snap.id }),
      });
      setOpen(false);
      // restore 完成后让 server 重读 chunks.jsonl:router.refresh() 触发 RSC
      router.refresh();
    } catch (err) {
      // ADR-0009 第 3 层"出错绝不沉默":失败必须可见 —— StatusBar 是 shell,
      // 不能弹 toast(跨 zone 共用);走 console.error 让 devtools / log 平台可见
      // eslint-disable-next-line no-console
      console.error('[StatusBar rollback] restore failed', err);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-bg-elevated border-b border-border">
      <div className="flex items-center h-10 px-4 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <div key={t.id} className={`flex items-center gap-2 h-7 px-3 text-sm rounded-md cursor-pointer whitespace-nowrap
            ${t.id === currentId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-2 hover:bg-bg-subtle'}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[t.status] }} />
            {t.title} · {t.status}
          </div>
        ))}
        {reqId && snapshots.length > 0 ? (
          <div className="ml-auto relative" data-testid="statusbar-rollback">
            <button
              type="button"
              className="flex items-center gap-1 h-7 px-3 text-sm rounded-md text-text-2 hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={restoring}
              onClick={() => setOpen(o => !o)}
              aria-label="回滚"
              aria-expanded={open}
              data-testid="statusbar-rollback-btn"
            >
              ↶ 回滚
            </button>
            {open && (
              <ul
                className="absolute right-0 top-9 min-w-[14rem] bg-bg-elevated border border-border rounded-md shadow-lg py-1 z-50"
                data-testid="statusbar-rollback-menu"
                role="menu"
              >
                {snapshots.map(s => (
                  <li key={s.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-bg-subtle disabled:opacity-50"
                      disabled={restoring}
                      onClick={() => handleRestore(s)}
                      data-testid={`statusbar-rollback-item-${s.id}`}
                    >
                      <div className="font-mono text-text-1">{s.id}</div>
                      {s.takenAt ? (
                        <div className="text-xs text-text-3 mt-0.5">
                          {new Date(s.takenAt).toLocaleString()}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}