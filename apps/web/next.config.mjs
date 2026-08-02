/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ai-devspace/shared'],
  webpack(config) {
    // ESM-style 写法:`./foo.js` 实际指 `./foo.ts`。Next.js 的 webpack resolver
    // 默认不做 `.js` → `.ts` 别名,而 tsx / vitest 默认支持 —— 显式声明
    // 后,shared 包内(以及任何使用 `.js` 后缀 import `.ts` 源文件的包)
    // 都能在 Next build 里被正确解析。
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;