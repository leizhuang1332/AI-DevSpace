---
Status: ready-for-agent
Type: task
Stage: 2
---

# 03 - DRAFTING "上传新版本" + Dialog 预填(C + W4)

## 目标

把"上传 PRD 文件"做成两处可点的 UI 入口,共用 ticket 01 的 `validateUpload` 与上游管道。两处**不**共享覆盖逻辑 —— Dialog 是"预填",DRAFTING 是"覆盖"(强度差见 ADR-0015 D8)。

## 范围

- [ ] apps/web:`components/drafting-prd-pane.tsx`
  - [ ] 在现有"预览切换"按钮(见 `previewToggle.buttonProps`)旁加"上传新版本"按钮
  - [ ] 点击 → 触发 `<input type="file" accept=".md,.txt,.docx" />`(隐藏)
  - [ ] 用户选文件 → 调 `validateUpload(file)`
    - [ ] `{ok: false}` → 显示顶部红条(文案见 ADR-0015 D6)+ 保留现有 `prdMarkdown`
    - [ ] `{ok: true}` → 调服务端 `parseUpload()` + `landAssets()` + `replaceDataUriWithAssetPath()` + 写盘 `requirement.md`
  - [ ] 写盘成功后**调用 PR/UI 刷新机制**(具体走项目既有"DRAFTING 数据 reload"接口,参考 [drafting-zone.tsx 行 220](../../apps/web/src/components/drafting-zone.tsx) 的 `setPrdMarkdown(data.prdMarkdown)` 模式)
  - [ ] **不要在覆盖前弹 modal / 显示 diff / 输入确认**(ADR-0015 D8 W4 显式禁止)
- [ ] apps/web:Dialog `RequirementCreateDialog`(`apps/web/src/components/requirement-create-dialog.tsx` 或同等位置,实际路径以仓库为准)
  - [ ] 在 textarea 旁加"上传文件"小按钮(图标:`Upload` from lucide-react,与现有 UI 风格一致)
  - [ ] 点击 → `validateUpload` 闸门后 → 调 `parseUpload()` 拿到 markdown → **仅填充本地 component state**(dialog 内维护的 `prdMarkdown`),**不**调 `landAssets`、**不**调"创建"接口
  - [ ] 预填后 textarea 内容 = 解析后 markdown;用户继续走现有"创建"流程(填 title / 选 repo / 点创建 → 走 ticket 02 的服务端接管 → 写盘)
- [ ] apps/web:重构 `lib/requirement-upload.ts` 暴露两组函数
  - [ ] `validateUpload(file)`:闸门(本 ticket 不做,但确认 ticket 01 已暴露)
  - [ ] `uploadAndReplace(reqId, file)`:闸门 + `parseUpload` + `landAssets` + 写盘 `requirement.md`(DRAFTING 覆盖用)
  - [ ] `parseForDialog(file)`:闸门 + `parseUpload` 返回 markdown(Dialog 预填用,**不写盘**)
- [ ] apps/web:共用 toast / 红条组件(沿用既有,无需新增)
- [ ] 单测:
  - [ ] Dialog 选 .docx → 不写盘 → 关闭 dialog 后磁盘无新文件
  - [ ] DRAFTING 选 .docx → 覆盖 → textarea 渲染新版本 markdown → 含图片相对路径
  - [ ] Dialog / DRAFTING 闸门失败各显示顶部红条
  - [ ] DRAFTING 覆盖成功但不弹 modal(以 `screen.getByRole('dialog')` 不出现为断言)

## 验收

- **痛点 A(创建时上传)**:在 Dialog 选 .docx → 解析结果预填 textarea → 填 title / 选 repo / 点创建 → 新 Requirement 创建成功 → DRAFTING 打开看到完整 PRD(含图片)
- **痛点 B(回头改 PRD)**:在 DRAFTING 选新版本 .docx → 立即覆盖 → 刷新看到新内容 → 旧版本在 git log 可找
- **闸门**:上传 .rar / .exe / 加密 docx / 11 MB docx / 含 5 MB PNG docx,任意一条触发顶部红条,**不写盘**
- **回归**:粘贴纯 markdown 创建需求流程不变;现有 textarea 编辑 → autosave 流程不变
- **W4 边界**:DRAFTING 覆盖全程无 modal / 无 diff / 无输入"覆盖"步骤(录屏验证或 e2e 断言)

## 依赖

- [ticket 01 - PRD 上传通道](./01-prd-upload-pipeline.md)(`validateUpload` + `parseUpload` 服务端)
- [ticket 02 - assets/ 落地](./02-requirements-assets-landing.md)(`landAssets` 服务端 + `assets[]` 列表接口)

> ticket 03 严格依赖 ticket 01 的闸门 + 服务端 `parseUpload`;ticket 02 提供的 `landAssets` 用于 DRAFTING 覆盖路径。Dialog 预填不调 `landAssets`(在创建时才落盘,与 ticket 02 自然衔接)。

## 关联文档

- [ADR-0015 D3 / D8](../../docs/adr/0015-prd-file-upload-and-editing.md)

## 非目标(明确不做)

- 添加 modal / diff 预览 / 输入"覆盖"确认 / 历史快照(ADR-0015 D8 W4 锁)
- `_history/` 子目录(W4 不需要)
- 拖拽上传(留作 UI 优化)
- Dialog 选 repo 阶段预填 docx 图片
- 修改 `meta.yaml.title` / `tags` / `repos`(ADR-0015 D4 锁 B1)
- 富文本 / WYSIWYG 编辑器(继续用现有 `<textarea>`)
