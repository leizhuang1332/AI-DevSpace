import type { ReactNode } from 'react';
import { ResourceTree } from '@/components/resource-tree';
import { InlineRail } from '@/components/inline-rail';

export default function RequirementLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  return (
    <div className="grid grid-cols-[240px_1fr_120px] min-h-[calc(100vh-72px)] bg-bg">
      <ResourceTree requirementId={params.id} />
      {children}
      <InlineRail requirementId={params.id} />
    </div>
  );
}