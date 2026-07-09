import { CenterTabs } from '@/components/center-tabs';

interface Props {
  params: { id: string };
}

export default function RequirementPage({ params }: Props) {
  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <CenterTabs defaultTab="markdown" />
      <div className="flex-1 grid place-items-center text-text-3 text-sm">
        Requirement{' '}
        <code className="font-mono text-text-1 ml-1">{params.id}</code> · 待 Task 7 翻译
        docs/design/pages/03-requirement-workspace.html
      </div>
    </section>
  );
}