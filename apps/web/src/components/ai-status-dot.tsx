import { clsx } from 'clsx';
import type { AIStatus } from '@/app/(workspace)/data/mock';

const LABEL: Record<AIStatus, string> = {
  idle: '空闲', thinking: '思考中', tool_calling: '工具调用中',
  writing: '正在写入', awaiting_user: '等待回答', error: '错误',
};

const DOT_CLASS: Record<AIStatus, string> = {
  idle:           'bg-text-3',
  thinking:       'bg-brand animate-bounce',
  tool_calling:   'bg-brand animate-spin rounded-none',
  writing:        'bg-success',
  awaiting_user:  'bg-warning animate-pulse',
  error:          'bg-error animate-pulse',
};

export function AIStatusDot({ status, showLabel }: { status: AIStatus; showLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={clsx('w-2 h-2 rounded-full', DOT_CLASS[status])} />
      {showLabel && <span>{LABEL[status]}</span>}
    </span>
  );
}