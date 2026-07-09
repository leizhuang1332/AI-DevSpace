'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/',         label: '概览',  icon: '\u{1F3E0}', key: '1' },
  { href: '/requirements', label: '需求', icon: '\u{1F4CC}', key: '2' },
  { href: '/repos',    label: '仓库',  icon: '\u{1F4E6}', key: '3' },
  { href: '/knowledge', label: '知识库', icon: '\u{1F4DA}', key: '4' },
  { href: '/skills',   label: 'Skill', icon: '\u{1F916}', key: '5' },
  { href: '/settings', label: '设置',  icon: '⚙️', key: '6' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col items-center py-3 gap-0.5 bg-bg-elevated border-r border-border w-14">
      <div className="w-8 h-8 rounded-md bg-brand text-white flex items-center justify-center font-semibold mb-3">A</div>
      {NAV.slice(0, 5).map(n => {
        const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
        return (
          <Link key={n.href} href={n.href}
            aria-label={n.label} title={`${n.label} (⌘${n.key})`}
            className={`w-10 h-10 flex items-center justify-center rounded-md text-lg relative
              ${active ? 'bg-brand-50 text-brand-700 before:absolute before:left-[-12px] before:top-2 before:bottom-2 before:w-0.5 before:bg-brand before:rounded-sm' : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'}`}>
            {n.icon}
          </Link>
        );
      })}
      <div className="flex-1" />
      <Link href="/settings" aria-label="设置" title="设置 (⌘6)"
        className={`w-10 h-10 flex items-center justify-center rounded-md text-lg ${pathname.startsWith('/settings') ? 'bg-brand-50 text-brand-700' : 'text-text-2 hover:bg-bg-subtle hover:text-text-1'}`}>
        ⚙️
      </Link>
    </nav>
  );
}
