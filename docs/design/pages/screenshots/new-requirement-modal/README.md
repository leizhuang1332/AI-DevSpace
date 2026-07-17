# 新建需求弹窗 · 视觉归档

ticket 05 (PRD §12 验收清单收尾) 要求截 4 张图归档。本目录是占位,实际截图通过本地 `pnpm dev` 浏览器手动截取后放到本目录。

## 命名约定

| 文件名 | 内容 | 触发位置 |
|---|---|---|
| `01-modal-empty.png` | 弹窗初始状态(空 input + 占位 slug 预览) | `⌘N` 触发后 |
| `02-modal-typing.png` | 输入"退款功能优化" + slug 实时预览 + 字数计数 | 弹窗 input 失焦前 |
| `03-drafting-banner.png` | DRAFTING 顶部淡黄 banner"未关联任何仓库" + 骨架屏消失后 | 提交后 1.5s |
| `04-attach-repos-dialog.png` | 首次关联 480px 弹层(checkbox + 统一分支名 input) | banner [+] 触发 |
| `05-append-repos-dialog.png` | 追加场景 480px 弹层(顶部紫色 banner + 无分支名 input) | RepoBar [+] (N≥1) 触发 |

## 视觉回归基线

这些截图作为后续视觉回归(regression)的 baseline。任何后续 PR 修改弹窗 / DRAFTING banner / 关联仓库弹层前,先对比 baseline 确认无意外漂移。

## mvp 阶段决策

- 不强制进 git(避免 binary 文件膨胀);本地参考用
- 工位级 e2e 截图(如 DRAFTING / ANALYZING 状态)单独目录:`docs/design/pages/screenshots/<zone>/`
- 后续 mvp+ 阶段考虑接入 Playwright 截图回归