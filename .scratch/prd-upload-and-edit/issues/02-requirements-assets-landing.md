---
Status: ready-for-agent
Type: task
Stage: 2
---

# 02 - `requirements/<id>/assets/` 落地(X2)

## 目标

把 [ticket 01](./01-prd-upload-pipeline.md) `parseUpload()` 返回的图片列表抽到 `requirements/<req-id>/assets/prd-<N>.<ext>`,markdown 中 `data:` URI 替换为相对路径;`RequirementService.get()` 捎带 `assets[]`。

## 范围

- [ ] apps/agent:`RequirementService.landAssets(reqId: string, images: [{name, base64, mime}])`
  - [ ] 按 images 顺序,从 1 起编号:第 i 张图片 → `requirements/<id>/assets/prd-<i>.<ext>`,`ext` 从 mime 推导(`image/png` → `png`、`image/jpeg` → `jpg` 等)
  - [ ] base64 解码 + 写盘(用项目既有 `fs/promises`,与其他 product 文件落地统一)
  - [ ] 返回 `landed: [{name: 'prd-1.png', path: 'requirements/<id>/assets/prd-1.png', size: number, mime: 'image/png'}]`
  - [ ] 写盘前确保 `requirements/<id>/assets/` 存在(`mkdir -p`)
  - [ ] **失败语义**:写盘失败 → 抛出(由上游覆盖流程决定回滚,本函数不写回补偿)
- [ ] apps/agent:`RequirementService.replaceDataUriWithAssetPath(reqId, markdown)`(纯函数)
  - [ ] 扫描 markdown 字符串中的 `data:image/...;base64,...` 段
  - [ ] 按出现顺序替换为相对路径 `assets/prd-<N>.<ext>`,N 与 `landAssets` 命名一致
  - [ ] 返回新 markdown 字符串(不入参 mutation)
- [ ] apps/agent:`RequirementService.get(reqId)` 返回值补充字段
  - [ ] `assets: [{name, url, size, mime}]`(url 形式:`/api/requirements/<reqId>/assets/prd-<N>.<ext>` 或同等形态,**具体走项目既有 fetch pattern**)
- [ ] apps/agent:`RequirementService.list()` 资源树扫描忽略 `_` 前缀目录
  - [ ] 沿用既有 `_archived/` 处理;`assets/` 不带下划线,因此**纳入**资源树扫描
  - [ ] 资源树节点命名:`assets/`,子节点仅含文件名(不带路径前缀)
- [ ] apps/web:`MarkdownPreview` 渲染时把 `assets/prd-1.png` 解析为正确 src
  - [ ] 现有 markdown 渲染走 `next/image` 或 `<img>`,需要补相对路径解析
  - [ ] 解析规则:`./assets/prd-N.<ext>` 或 `assets/prd-N.<ext>` → 由当前 Requirement 的 `assets[]` 拼出绝对路径或 URL
  - [ ] 单测:fixture markdown 嵌入 `![](assets/prd-1.png)`,渲染时输出正确 src(`/api/requirements/req-123/assets/prd-1.png`)
- [ ] apps/agent:API 路由 `GET /api/requirements/:id/assets/:filename`
  - [ ] 文件流式返回,Content-Type 正确
  - [ ] 路径穿越防护:拒绝 `../`、绝对路径、null bytes

## 验收

- 端到端 fixture:用 ticket 01 的 `test/fixtures/sample-prd.docx`(含 1 张 PNG)
  - `parseUpload()` → markdown 含 `data:image/png;base64,...`
  - `landAssets()` → `assets/prd-1.png` 落盘,文件字节数匹配
  - `replaceDataUriWithAssetPath()` → markdown 替换为 `![](assets/prd-1.png)`
  - `get(reqId).assets` 返回 `[{name: 'prd-1.png', ...}]`
  - `MarkdownPreview` 渲染输出正确 src
- 资源树扫描:fixture 创建后 `list()` 返回的 `assets/` 节点下能看到 `prd-1.png`
- 安全测:尝试 `GET /api/requirements/req-123/assets/../meta.yaml` → 404 或 400,不泄漏 meta.yaml
- ticket 01 happy path 仍通过(本 ticket 不回归上传管道)

## 依赖

- [ticket 01 - PRD 上传通道](./01-prd-upload-pipeline.md)(图片数据源)

## 关联文档

- [ADR-0015 D5](../../docs/adr/0015-prd-file-upload-and-editing.md)
- [CONTEXT.md § Asset](../../CONTEXT.md#asset附件素材)

## 非目标(明确不做)

- docx 的视频 / 音频 / shape 抽取(mammoth 不输出,本 ticket 不新增)
- 图片尺寸优化(thumbnail / webp 转码)(P1 候选)
- `assets/` 进 gitignore(本 ADR 不忽略,让 git 跟踪这些图)
- `_history/` 子目录(与 ADR-0015 D8 W4 互斥)
- 修改 `meta.yaml`(ADR-0015 D4 锁 B1)
