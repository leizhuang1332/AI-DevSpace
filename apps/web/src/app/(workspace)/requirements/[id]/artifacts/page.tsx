import { requirements, artifactsFor, type ArtifactV2 } from '@/app/(workspace)/data/mock';

interface Props { params: { id: string }; }

const TYPE_LABEL: Record<ArtifactV2['type'], string> = {
  database: 'SQL',
  api: 'OpenAPI',
  config: '配置',
  doc: '序列图',
  test: '测试用例',
  other: '其他',
};

export default function RequirementArtifactsPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];
  const arts = artifactsFor(params.id);

  const countByType = arts.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <div className="flex items-center h-10 px-4 border-b border-border bg-bg-subtle text-xs text-text-3 gap-2">
        <span className="font-mono">📄 {req.title}</span>
        <span>/</span>
        <span className="text-text-1 font-medium">📦 产物</span>
      </div>

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm text-text-3">
          <span>{arts.length} 个产物 · {arts.filter(a => a.footStatusTone !== 'warning').length} 个被 Skill 引用</span>
        </div>
        <div className="flex gap-2">
          <button className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm text-text-1 hover:bg-bg-subtle">⌘⇧D Diff 全量</button>
          <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">+ 新增产物</button>
        </div>
      </div>

      <main className="p-6 px-8 overflow-auto h-[calc(100vh-120px)]">
        <div className="flex gap-2 mb-4">
          <button className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm text-text-2">全部 {arts.length}</button>
          {(Object.keys(TYPE_LABEL) as Array<keyof typeof TYPE_LABEL>).map((t) => (
            <button
              key={t}
              className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm text-text-2"
            >
              {TYPE_LABEL[t]} {countByType[t] ?? 0}
            </button>
          ))}
          <span className="flex-1" />
          <button className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm text-text-2">排序:生成时间 ↓</button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {arts.map((a) => (
            <div
              key={a.id}
              className="bg-bg-elevated border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-md hover:-translate-y-px transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-9 h-9 rounded-md flex items-center justify-center text-lg text-white font-semibold ${a.iconBg}`}>
                  {a.iconText}
                </div>
                <div>
                  <div className="font-mono text-md font-medium">{a.name}</div>
                  <div className="text-xs text-text-3 mt-0.5">{a.meta}</div>
                </div>
              </div>
              <div className="bg-bg-subtle rounded-sm p-2 font-mono text-xs text-text-2 leading-relaxed mt-2 max-h-16 overflow-hidden whitespace-pre">
                {a.snippet}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-text-3">
                <span
                  className={
                    a.footStatusTone === 'warning' ? 'text-warning' : 'inline-flex items-center gap-1'
                  }
                >
                  <span
                    className={`w-[5px] h-[5px] rounded-full ${
                      a.footStatusTone === 'warning' ? 'bg-warning' : 'bg-success'
                    }`}
                  />
                  {a.footStatus}
                </span>
                <span>{a.footTime}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明:</strong>产物 = AI 在开发过程中产生的「可保存、可复用」中间或最终结果。MVP 包含 7 类:SQL、OpenAPI、Apollo、序列图、测试用例、配置、文档。
          点击产物 → 打开详情(预览 + Diff + 下载 + 「@引用」按钮 — 注入到下次 AI 上下文)。
          右上角 ⚠ 标记 = AI 已生成但需人工审核(apollo.yaml 这种带业务规则的产物)。
        </div>
      </main>
    </section>
  );
}
