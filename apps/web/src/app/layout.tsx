import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import '@/styles/globals.css';

export const metadata = {
  title: 'AI-DevSpace',
  description: 'AI-DevSpace — Web Workbench',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}