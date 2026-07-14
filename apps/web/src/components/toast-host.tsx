'use client'

import { Toast, type ToastItem } from './toast'

export function ToastHost({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: string) => void
}): JSX.Element {
  return (
    <div
      data-testid="toast-host"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <Toast item={item} onDismiss={() => onDismiss(item.id)} />
        </div>
      ))}
    </div>
  )
}
