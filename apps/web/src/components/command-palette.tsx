'use client';
import { useUIOverlay } from './ui-overlay-store';
import { ZONE_META, ZONE_STATUS_COLOR_CLASS, type ZoneMeta } from '@/lib/zones';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type Mode = 'command' | 'ai' | 'history';

interface Item {
  icon: string;
  label: string;
  desc?: string;
  shortcut?: string[];
  section?: string;
}

/**
 * Overview 是第 7 产品形态但**不是工位**(ADR-0012 §1)。
 * 在 Cmd+K 里作为"切回仪表板"项,route 为 `/requirements/<id>/`。
 */
interface OverviewJump {
  kind: 'overview';
  id: 'overview';
  label: string;
  icon: string;
  route: string;
}

interface ZoneJump {
  kind: 'zone';
  id: string;
  label: string;
  icon: string;
  status_color: ZoneMeta['status_color'];
  route: string;
}

type Jump = OverviewJump | ZoneJump;

const ALL: Item[] = [
  { icon: '▶', label: '运行 code-stage Skill', desc: '继续执行下一个 Task（当前 #12 退款接口开发）', shortcut: ['⌘', 'R'], section: '需求操作' },
  { icon: '⏸', label: '暂停当前 Skill', desc: '保存 AI 会话上下文到 conversations/', section: '需求操作' },
  { icon: '⟳', label: '重新运行 code-stage', desc: '丢弃当前进度，重新执行', section: '需求操作' },
  { icon: '📄', label: '打开 design/02-api.md', desc: '当前需求 · 设计阶段 · API 定义', section: '导航' },
  { icon: '📦', label: '打开 artifacts/refund.sql', desc: '产物 · 5 分钟前由 design-stage 生成', section: '导航' },
  { icon: '⌘⇧E', label: '在 IDEA 打开 refund-service worktree', desc: '~/.aidevspace/requirements/req-2024-007/refund-service', shortcut: ['⌘', '⇧', 'E'], section: '导航' },
  { icon: '📚', label: '添加知识：refund-idempotency', desc: '从历史需求沉淀 · 已存在于知识库', section: '仓库 / 知识库' },
];

const HISTORY: Item[] = [
  { icon: '⚡', label: 'code-stage 启动', desc: '5 分钟前 · req-001', section: '今天' },
  { icon: '✨', label: 'AI: "退款幂等性怎么保证"', desc: '12 分钟前 · 引用 3 个文件', section: '今天' },
  { icon: '⚡', label: '打开 requirements 列表', desc: '1 小时前', section: '今天' },
  { icon: '⚡', label: '运行 analyze-stage', desc: '昨天 18:42 · req-002', section: '昨天' },
  { icon: '✨', label: 'AI: "会员成长值并发更新 Bug"', desc: '昨天 17:30', section: '昨天' },
];

const CMD_FILTERED = (q: string) => ALL.filter((i) => i.label.includes(q));
const AI_SUGGEST = (q: string) => [{ icon: '✨', label: `AI: "${q}"` }];

/**
 * 从 `/requirements/<id>/<zone?>/` 解析 currentReqId。
 * 严格要求两段(Overview 或具体 zone);更深路径(未知子路由)→ null,
 * 避免误把 `drafting/foo` 中的 `foo` 当 id。
 */
function parseRequirementId(pathname: string): string | null {
  const m = pathname.match(/^\/requirements\/([^/]+)(?:\/(?:[^/]+))?\/?$/)
  return m ? m[1] : null
}

/**
 * 工位 Cmd+K 匹配(ADR-0012 §7 · issue 14):
 * - 匹配字段:id / name(大写)/ display_name(中文)/ route_segment
 * - 大小写不敏感
 * - 包含匹配(query 是字段子串)
 * - 支持 `@zone` 前缀(ADR §7 表格):内部剥掉 `@` 再匹配
 * - 空 query / 无 requirementId → []
 * - 同时支持两种匹配风格:
 *   1) 直接 includes("执行中" 匹配 display_name、"executing" 匹配 id)
 *   2) 去元音 + includes("wrp" 匹配 "wrap-up"、"ana" 匹配 "analyzing")
 *
 * Overview 不是工位,但在 Cmd+K 里也作为"回仪表板"项匹配,便于用户在工位页快速回 Overview。
 */
const STRIP_VOWELS_RE = /[aeiou\-_\s]/g

export function matchZoneJumps(query: string, requirementId: string | null): Jump[] {
  if (!query || !requirementId) return []
  // 剥掉 @zone / /zone 等前缀,只对核心搜索词做匹配
  const stripped = query.replace(/^[@/]\s*/, '')
  if (!stripped) return []
  const q = stripped.toLowerCase()
  const qStripped = q.replace(STRIP_VOWELS_RE, '')
  const matchesZone = (z: ZoneMeta) => {
    const targets = [
      z.id.toLowerCase(),
      z.name.toLowerCase(),
      z.display_name.toLowerCase(),
      z.route_segment.toLowerCase(),
    ]
    if (targets.some((t) => t.includes(q))) return true
    // 缩写前缀场景:只对 ASCII 字段生效,避免破坏中文匹配
    const asciiTargets = targets.filter((t) => /[a-z]/.test(t)).map((t) => t.replace(STRIP_VOWELS_RE, ''))
    return asciiTargets.some((t) => t.includes(qStripped))
  }

  const zoneJumps: ZoneJump[] = ZONE_META.filter(matchesZone).map((z) => ({
    kind: 'zone' as const,
    id: z.id,
    label: `切到 ${z.name} 工位`,
    icon: z.icon,
    status_color: z.status_color,
    route: `/requirements/${requirementId}/${z.route_segment}/`,
  }))

  const overviewMatches = 'overview'.includes(q) || '概览'.includes(q)
  const overview: OverviewJump[] = overviewMatches
    ? [
        {
          kind: 'overview' as const,
          id: 'overview' as const,
          label: '回 Overview 概览页',
          icon: '📊',
          route: `/requirements/${requirementId}/`,
        },
      ]
    : []

  return [...overview, ...zoneJumps]
}

export function CommandPalette() {
  const { cmdK, close } = useUIOverlay();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('command');
  const pathname = usePathname();
  const router = useRouter();
  const requirementId = useMemo(() => parseRequirementId(pathname), [pathname]);

  // Reset query when palette opens; ⌘I toggles AI mode
  useEffect(() => {
    if (cmdK) setQuery('');
  }, [cmdK]);

  useEffect(() => {
    if (!cmdK) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setMode((m) => (m === 'ai' ? 'command' : 'ai'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdK]);

  if (!cmdK) return null;

  // 命令模式 + 非命令前缀 + 非空 query → 工位搜索项(ADR-0012 §7)
  const showZoneSearch =
    mode === 'command' && !query.startsWith('>') && !query.startsWith('✨') && query.length > 0
  const zoneJumps = showZoneSearch ? matchZoneJumps(query, requirementId) : []

  const handleJump = (jump: Jump) => {
    router.push(jump.route)
    close()
  }

  let items: Item[];
  if (mode === 'history') items = HISTORY;
  else if (query.startsWith('>')) items = CMD_FILTERED(query.slice(1));
  else if (query.startsWith('✨')) items = AI_SUGGEST(query.slice(1));
  else if (mode === 'ai') items = query ? AI_SUGGEST(query) : [];
  else items = CMD_FILTERED(query);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 bg-slate-900/40 backdrop-blur-sm">
      <div
        className={`relative z-[101] w-[680px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden ${
          mode === 'ai' ? 'border-t-2 border-t-brand-500' : ''
        }`}
      >
        {/* Context header */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-b border-border text-xs text-text-3">
          <div className="inline-flex items-center gap-1.5">
            <span className="bg-bg-elevated border border-border px-1.5 py-0.5 rounded font-mono">
              退款功能优化
            </span>
            <span>· 绑当前需求（⌘⇧K 切全局）</span>
          </div>
          <div className="flex gap-1">
            {(['command', 'ai', 'history'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-xs ${
                  mode === m ? 'bg-bg-elevated text-brand-600 font-medium shadow-sm' : 'text-text-2'
                }`}
              >
                {m === 'command' ? '命令' : m === 'ai' ? 'AI 提问' : '历史'}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <span className={`text-lg ${mode === 'ai' ? 'text-brand-600' : 'text-text-3'}`}>⌘K</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令、AI 提问、文件…"
            className="flex-1 border-none outline-none bg-transparent text-lg text-text-1 placeholder-text-3"
          />
          <span className="font-mono text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded">ESC</span>
        </div>

        {/* AI result card (AI mode, when query exists) */}
        {mode === 'ai' && query && !query.startsWith('✨') && (
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm text-text-2">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                AI 已就绪
              </div>
              <button className="text-xs text-text-2 hover:text-text-1" onClick={close}>
                ✕
              </button>
            </div>
            <div className="bg-bg-subtle rounded-md p-4 text-md text-text-1 leading-relaxed">
              <div className="font-medium mb-2 flex items-center gap-2">✨ 可执行结果</div>
              <ul className="pl-5 text-sm text-text-2 list-disc">
                <li>扫描 12 个代码位置 · 已生成建议</li>
                <li>草拟 add-idempotency-check Skill · 待 review</li>
              </ul>
              <div className="mt-3 pt-3 border-t border-border flex gap-2">
                <button className="h-6 px-2.5 text-xs rounded bg-brand-500 text-white font-medium">
                  ▶ 让 code-stage 修复
                </button>
                <button className="h-6 px-2.5 text-xs rounded bg-bg-elevated border border-border text-text-2">
                  📌 加入知识库
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results list */}
        <div className="max-h-[420px] overflow-y-auto py-1">
          {items.length === 0 && zoneJumps.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-text-3">
              {mode === 'ai' ? '输入自然语言提问 · AI 给出可执行结果卡片' : '无匹配命令'}
            </div>
          )}
          {/* 工位搜索(ADR-0012 §7 · issue 14) */}
          {zoneJumps.map((j) => (
            <button
              key={j.id}
              type="button"
              data-testid={`cmd-zone-${j.id}`}
              data-zone-kind={j.kind}
              onClick={() => handleJump(j)}
              className="w-full flex items-center gap-3 px-5 py-2 text-left hover:bg-bg-subtle"
            >
              <div className="w-7 h-7 rounded-md bg-bg-subtle flex items-center justify-center text-sm text-text-2">
                {j.icon}
              </div>
              <div className="flex-1">
                <div className="text-text-1 text-md">{j.label}</div>
                <div className="text-xs text-text-3">工位导航 · {j.route}</div>
              </div>
              {j.kind === 'zone' && (
                <span
                  aria-hidden="true"
                  data-testid={`cmd-zone-dot-${j.id}`}
                  className={`w-1.5 h-1.5 rounded-full ${ZONE_STATUS_COLOR_CLASS[j.status_color]}`}
                />
              )}
            </button>
          ))}
          {items.map((it, i) => (
            <Item key={i} item={it} />
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 py-2 bg-bg-subtle border-t border-border text-xs text-text-3">
          <div className="flex gap-3">
            <span><kbd className="kbd">↑↓</kbd> 选择</span>
            <span><kbd className="kbd">↵</kbd> 执行</span>
            <span><kbd className="kbd">⌘I</kbd> AI 模式</span>
            <span><kbd className="kbd">/</kbd> 全局搜索</span>
          </div>
          <div>绑当前需求 · ⌘⇧K 切全局</div>
        </div>
      </div>
    </div>
  );
}

function Item({ item }: { item: Item }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 cursor-pointer text-md hover:bg-bg-subtle">
      <div className="w-7 h-7 rounded-md bg-bg-subtle flex items-center justify-center text-sm text-text-2">
        {item.icon}
      </div>
      <div className="flex-1">
        <div className="text-text-1">{item.label}</div>
        {item.desc && <div className="text-xs text-text-3">{item.desc}</div>}
      </div>
      {item.shortcut && (
        <span className="inline-flex gap-0.5">
          {item.shortcut.map((k) => (
            <kbd key={k} className="kbd">{k}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}