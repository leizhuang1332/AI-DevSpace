import { CenterTabs } from '@/components/center-tabs';
import { requirements } from '@/app/(workspace)/data/mock';

interface Props { params: { id: string }; }

export default function RequirementPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <CenterTabs defaultTab="markdown" />

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-3">{req.title}</span>
          <span className="text-text-3">/</span>
          <span className="text-text-3">设计</span>
          <span className="text-text-3">/</span>
          <span className="text-text-1">01-database.md</span>
        </div>
        <div className="flex gap-2">
          <button className="h-7 px-2 text-text-2 text-sm hover:text-text-1">↻ 重新生成</button>
          <button className="h-7 px-3 bg-bg-subtle border border-border-strong rounded-md text-sm text-text-1 hover:bg-bg-elevated">⌘⇧E 打开 IDEA</button>
          <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">▶ 运行 code-stage</button>
        </div>
      </div>

      <article className="p-8 px-12 max-w-[880px] mx-auto overflow-auto h-[calc(100vh-152px)]">
        <h1 className="text-2xl font-semibold tracking-tight mb-2 flex items-center gap-3">
          01-database <span className="inline-flex items-center gap-1 px-1.5 bg-[#fff7ed] border border-dashed border-warning rounded text-sm text-[#92400e]">✨</span>
        </h1>
        <div className="text-text-3 text-sm mb-6 flex gap-3 items-center">
          <span>由 <strong className="text-text-2 font-medium">design-stage</strong> 生成 · 2026-07-08</span>
          <span>·</span>
          <span>14 次修订</span>
          <span>·</span>
          <span className="text-success">✓ 已采纳</span>
        </div>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">1. 退款表 <code className="font-mono text-brand-600">refund_order</code></h2>
        <p className="text-md leading-relaxed text-text-1 mb-3">主表,记录每笔退款订单的状态、金额、退款渠道等信息。</p>

        <table className="w-full text-sm my-3 border-collapse">
          <thead>
            <tr><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">字段</th><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">类型</th><th className="text-left py-2 px-3 bg-bg-subtle font-medium text-text-2 border-b border-border">说明</th></tr>
          </thead>
          <tbody>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">id</code></td><td className="py-2 px-3 border-b border-border">BIGINT PK</td><td className="py-2 px-3 border-b border-border">主键,雪花算法</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">order_id</code></td><td className="py-2 px-3 border-b border-border">BIGINT</td><td className="py-2 px-3 border-b border-border">原订单 ID</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">amount</code></td><td className="py-2 px-3 border-b border-border">DECIMAL(10,2)</td><td className="py-2 px-3 border-b border-border">退款金额(元)</td></tr>
            <tr><td className="py-2 px-3 border-b border-border"><code className="font-mono text-brand-600">status</code></td><td className="py-2 px-3 border-b border-border">TINYINT</td><td className="py-2 px-3 border-b border-border">1-待审核 2-退款中 3-成功 4-失败</td></tr>
          </tbody>
        </table>

        <blockquote className="border-l-[3px] border-brand bg-brand-50 px-4 py-3 rounded-r-md my-3 text-text-2">
          <strong className="text-text-1">💡 AI 建议:</strong>高频查询场景 <code className="font-mono text-brand-600">WHERE user_id=? AND status=? ORDER BY created_at DESC</code>,建议加联合索引 <code className="font-mono text-brand-600">idx_user_status_created (user_id, status, created_at)</code>。
        </blockquote>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">2. 退款流水表 <code className="font-mono text-brand-600">refund_flow</code></h2>
        <p className="text-md leading-relaxed text-text-1 mb-3">记录退款链路上的每一步状态变更(异步、回调、重试)。</p>

        <h2 className="text-lg font-semibold mt-6 mb-3 pb-2 border-b border-border">3. 索引设计</h2>
        <ul className="list-disc pl-6 text-md leading-relaxed text-text-1 mb-3">
          <li><code className="font-mono text-brand-600">idx_user_status_created (user_id, status, created_at)</code> — 用户维度查询</li>
          <li><code className="font-mono text-brand-600">idx_order (order_id)</code> — 原订单维度</li>
          <li><code className="font-mono text-brand-600">idx_status_updated (status, updated_at)</code> — 后台扫描任务</li>
        </ul>

        <div className="my-4 mx-8 mb-3 p-3 px-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明:</strong>Markdown 视图(Task 7 基础版);diff / 文件树 / 对话切 tab 见 [CenterTabs](#);Markdown 实时语法高亮接 react-markdown 在 P1+。
        </div>
      </article>
    </section>
  );
}
