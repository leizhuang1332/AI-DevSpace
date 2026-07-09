import { requirements, settingsFor } from '@/app/(workspace)/data/mock';

interface Props { params: { id: string }; }

function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={`inline-flex items-center gap-2 cursor-pointer ${on ? 'toggle on' : 'toggle'}`}>
      <span
        className={`relative w-8 h-[18px] rounded-full transition-colors ${
          on ? 'bg-brand-500' : 'bg-border-strong'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 w-[14px] h-[14px] bg-white rounded-full transition-transform ${
            on ? 'translate-x-[14px]' : ''
          }`}
        />
      </span>
      <span className="text-sm text-text-1">{label}</span>
    </div>
  );
}

export default function RequirementSettingsPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];
  const s = settingsFor(params.id);

  if (!s) {
    return (
      <section className="flex flex-col bg-bg-elevated overflow-hidden">
        <div className="flex items-center h-10 px-4 border-b border-border bg-bg-subtle text-xs text-text-3 gap-2">
          <span className="font-mono">📄 {req.title}</span>
          <span>/</span>
          <span className="text-text-1 font-medium">⚙️ 需求设置</span>
        </div>
        <div className="flex-1 grid place-items-center text-text-3 text-sm">
          需求 <code className="font-mono text-text-1 ml-1">{params.id}</code> 无设置项
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <div className="flex items-center h-10 px-4 border-b border-border bg-bg-subtle text-xs text-text-3 gap-2">
        <span className="font-mono">📄 {req.title}</span>
        <span>/</span>
        <span className="text-text-1 font-medium">⚙️ 需求设置</span>
      </div>

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm text-text-3">
          <span>仅作用于「{req.title}」这个需求</span>
        </div>
        <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">保存更改</button>
      </div>

      <main className="p-6 px-8 overflow-auto max-w-[920px] h-[calc(100vh-120px)]">
        <h1 className="text-2xl font-semibold tracking-tight">需求设置</h1>
        <p className="text-text-2 text-md mt-1 mb-5">仅作用于「{req.title}」这个需求</p>

        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">基本信息</h2>
          <p className="text-sm text-text-3 mb-4">需求名称、负责人、目标分支</p>

          <Field label="需求名称">
            <input defaultValue={s.name} className={inputCls} />
          </Field>
          <Field label="Slug" desc="目录名 / 标识符">
            <input defaultValue={s.slug} className={`${inputCls} font-mono text-sm`} />
          </Field>
          <Field label="负责人">
            <input defaultValue={s.owner} className={inputCls} />
          </Field>
          <Field label="目标分支" desc="submit-stage 完成后合并到">
            <input defaultValue={s.targetBranch} className={`${inputCls} font-mono`} />
          </Field>
        </section>

        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">AI 上下文</h2>
          <p className="text-sm text-text-3 mb-4">控制 AI 在该需求下的 Skill 选择、上下文装配、自动提交等行为</p>

          <Field label="默认 Skill 链" desc="analyze → clarify → design → plan → code → test → submit">
            <div className="text-sm text-text-2">{s.skillChain}</div>
          </Field>
          <Field label="加载的知识库" desc="每次 Skill 运行前自动注入上下文">
            <div className="flex gap-1.5 flex-wrap">
              {s.knowledgeRefs.map((k) => (
                <span
                  key={k.id}
                  className="h-6 px-2 bg-bg-subtle rounded-sm text-xs text-text-2 inline-flex items-center gap-1"
                >
                  {k.label}
                  <span className="cursor-pointer text-text-3 ml-1">×</span>
                </span>
              ))}
              <span className="h-6 px-2 bg-brand-50 text-brand-600 rounded-sm text-xs inline-flex items-center gap-1 cursor-pointer border border-dashed border-brand-500">
                + 添加
              </span>
            </div>
          </Field>
          <Field label="提交时自动推送">
            <Toggle on={s.autoPush} label={s.autoPush ? '开启' : '关闭'} />
          </Field>
          <Field label="提交时需用户授权">
            <Toggle on={s.requireApproval} label={s.requireApproval ? '开启(推荐)' : '关闭'} />
          </Field>
        </section>

        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">原始 PRD</h2>
          <p className="text-sm text-text-3 mb-4">创建需求时粘贴的原文,AI 分析的源头</p>
          <Field label="PRD 内容">
            <textarea defaultValue={s.prdText} rows={10} className={`${inputCls} font-mono text-sm resize-y min-h-[120px]`} />
          </Field>
        </section>

        <section className="bg-bg-elevated border border-border rounded-lg p-5 mb-4">
          <h2 className="text-md font-semibold mb-1">危险操作</h2>
          <p className="text-sm text-text-3 mb-4">归档、删除、强制推送</p>
          <Field label="归档需求" desc="移动到归档 Tab,停止 AI 监听">
            <button className="h-7 px-3 bg-error text-white rounded-md text-sm font-medium">归档此需求</button>
          </Field>
          <Field label="删除需求" desc={<>删除 requirement 目录(含 worktree),<strong className="text-error">不可恢复</strong></>}>
            <button className="h-7 px-3 bg-error text-white rounded-md text-sm font-medium">永久删除</button>
          </Field>
        </section>

        <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明:</strong>需求设置仅作用于单个需求(区别于全局设置 12)。
          <strong>加载的知识库</strong> 是关键 — 用户可手动挑选本需求相关的知识条目,每次 Skill 运行前 Agent 自动注入到 SDK 上下文。
        </div>
      </main>
    </section>
  );
}

const inputCls =
  'w-full px-3 py-2 bg-bg-subtle border border-border-strong rounded-md text-md text-text-1 outline-none focus:border-brand-500 focus:bg-bg-elevated focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]';

function Field({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 items-center py-3 border-t border-border first:border-t-0">
      <div>
        <div className="text-sm font-medium text-text-1">{label}</div>
        {desc && <div className="text-xs text-text-3 mt-0.5">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
