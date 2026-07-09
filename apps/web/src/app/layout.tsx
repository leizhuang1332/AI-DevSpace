import type { ReactNode } from 'react';
import '@/styles/globals.css';

export const metadata = {
  title: 'AI-DevSpace',
  description: 'AI-DevSpace — Web Workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}