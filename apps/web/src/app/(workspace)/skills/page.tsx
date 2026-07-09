import { skills, type Skill } from '@/app/(workspace)/data/mock';

// 默认 Skill 链（按需求状态）— 从 skills 中筛选出 builtIn=true 的 6 个内置 stage
const PIPELINE = skills.filter((s) => s.builtIn && s.name.endsWith('-stage')).slice(0, 6);

// 卡片样式
const CARD_LEFT_BORDER: Record<'built-in' | 'user', string> = {
  'built-in': 'border-l-[3px] border-l-brand-500',
  'user':     'border-l-[3px] border-l-warning',
};

const BADGE: Record<'built-in' | 'user', string> = {
  'built-in': 'text-brand-700 bg-brand-50',
  'user':     'text-[#92400e] bg-[#fff7ed]',
};

export default function SkillsPage() {
  const builtInCount = skills.filter((s) => s.builtIn).length;
  const userCount = skills.filter((s) => !s.builtIn).length;

  return (
    <main className="p-6 lg:p-8 overflow-auto">
      {/* Page head */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Skill 管理</h1>
          <div className="text-text-2 text-md mt-1">
            AI 在每个阶段如何工作 · 提示词模板 + 上下文装配规则 + 期望产物清单
          </div>
        </div>
        <div className="flex gap-2">
          <button className="h-8 px-3 rounded-md text-md font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle">
            📖 编辑文档
          </button>
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">
            + 新建 Skill
          </button>
        </div>
      </div>

      {/* Sub-nav tabs */}
      <div className="flex gap-0.5 p-1 bg-bg-subtle rounded-md w-fit mb-4">
        {[
          { key: 'all',      label: '所有', count: skills.length, active: true  },
          { key: 'built-in', label: '内置', count: builtInCount,   active: false },
          { key: 'user',     label: '用户', count: userCount,      active: false },
        ].map((t) => (
          <button
            key={t.key}
            className={`h-7 px-3 rounded-sm text-sm inline-flex items-center gap-1.5 ${
              t.active
                ? 'bg-bg-elevated text-text-1 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
                : 'text-text-2'
            }`}
          >
            <span>{t.label}</span>
            <span
              className={`text-xs px-1.5 rounded-md ${
                t.active ? 'bg-brand-50 text-brand-700' : 'bg-bg-subtle text-text-3'
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Pipeline visualization */}
      <div className="text-[11px] text-text-3 uppercase tracking-wider font-medium mb-2">
        默认 Skill 链（按需求状态）
      </div>
      <div className="flex items-center gap-2 p-5 bg-bg-elevated border border-border rounded-lg mb-5 overflow-x-auto">
        {PIPELINE.map((step, i) => {
          const active = i === 0;
          return (
            <div key={step.id} className="flex items-center gap-2">
              <div
                className={`flex flex-col items-center min-w-[120px] p-3 bg-bg-subtle rounded-md cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.06)] ${
                  active ? 'bg-brand-50 border border-brand-500' : ''
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold mb-2">
                  {step.name[0].toUpperCase()}
                </div>
                <div className="text-sm font-medium">{step.name}</div>
                <div className="text-xs text-text-3 mt-0.5">{step.stage}</div>
              </div>
              {i < PIPELINE.length - 1 && (
                <span className="text-text-3 text-lg">→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Skill cards grid */}
      <div className="grid grid-cols-3 gap-4">
        {skills.map((s: Skill) => {
          const variant: 'built-in' | 'user' = s.builtIn ? 'built-in' : 'user';
          return (
            <div
              key={s.id}
              className={`bg-bg-elevated border border-border rounded-lg p-5 relative ${CARD_LEFT_BORDER[variant]}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-lg font-semibold mb-1">{s.name}</div>
                  <div className="text-xs text-text-3 mb-3">
                    {s.version}
                    {s.builtIn ? ' · 内置' : ` · ${s.createdText ?? '用户自定义'}`}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-sm font-medium ${BADGE[variant]}`}>
                  {variant === 'built-in' ? 'BUILT-IN' : 'USER'}
                </span>
              </div>

              <p className="text-md text-text-2 leading-relaxed mb-4">{s.description}</p>

              <div className="flex justify-between pt-3 border-t border-border text-xs text-text-3">
                <span>📥 注入：{s.injects}</span>
                <span>
                  📤 产物：<code className="font-mono bg-bg-subtle px-1.5 py-0.5 rounded-sm text-text-2">
                    {s.outputs}
                  </code>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
        <strong>设计说明：</strong>Skill = 「AI 在某阶段如何工作」的可加载单元。MVP 内置 6 个（对应 Vibecoding 7 步流程的核心），用户可自定义扩展。
        <b>每个 Skill = 一个目录</b>，含 <code className="font-mono">SKILL.md</code>（提示词模板）+
        <code className="font-mono">context.yml</code>（上下文装配规则）+
        <code className="font-mono">artifacts.yml</code>（期望产物清单）。
        点击 Skill 卡片 → 打开完整编辑器（YAML + Markdown 双 tab）。空态：「🤖 加载 Skill · 6 个内置 Skill 已就绪」。
      </div>
    </main>
  );
}