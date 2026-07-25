import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    /**
     * ticket 07 (ADR-0020 D11):Playwright e2e 走独立 `pnpm e2e` 入口,
     * vitest 只跑单元 / 组件测试。e2e/ 目录下的 *.spec.ts 不能进入
     * vitest 收集(否则 import "@playwright/test" 直接 transform 失败)。
     */
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.next/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
})
