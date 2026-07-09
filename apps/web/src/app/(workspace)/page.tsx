export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">概览</h1>
      <p className="text-sm text-text-2 mb-6">
        当前 5 个进行中需求，2 个 AI 会话活跃。完整页面由 Task 5 实现。
      </p>
      <div className="border border-dashed border-border-strong rounded-lg p-12 text-center text-text-3">
        Step 2 · workspace shell 已就位 · 主页待 Task 5 翻译 docs/design/pages/01-dashboard.html
      </div>
    </div>
  );
}
