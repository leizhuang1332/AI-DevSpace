---
Status: ready-for-agent
Type: task
Stage: 2
---

# 01 - PRD 上传通道(α + Z3 + Y3)

## 目标

为 `.md` / `.txt` / `.docx` 三种格式文件打通"上传 → 校验 → 解析"的纯函数管道。**解析出 markdown + 图片列表(若 .docx),但不写盘**。图片落盘在 [ticket 02](./02-requirements-assets-landing.md) 处理。

## 范围

- [ ] apps/agent:`RequirementService.parseUpload(buffer: Buffer, filename: string)`
  - [ ] 根据 `filename` 判定格式
    - [ ] `.md` / `.txt`:返 `(Buffer).toString('utf-8')` 作为 markdown,`images = []`
    - [ ] `.docx`:用 `mammoth.convertRaw(...)` 解出 `{value: markdown, messages: []}`,扫描 markdown 字符串中的 `data:image/<mime>;base64,<...>` 用正则抽出为 `images: [{name: 'prd-N', base64, mime}]`,N 为出现顺序从 1 起
  - [ ] 错误处理:mammoth 抛错 → 返回 `{ok: false, reason: 'parse-error', message: '<mammoth error>'}`(不要 throw 给上层)
- [ ] apps/agent:`RequirementService.validateUpload(buffer, filename, declaredMime)`(服务端兜底,前端闸门之外再加一道)
  - [ ] 同 Z3 闸门规则,见 ADR-0015 D6
  - [ ] **额外**:扫描解析后图片列表,**任一图解 base64 后字节数 > 2 MB** 则整体拒绝 `{ok: false, reason: 'image-too-large'}`
- [ ] apps/web:`lib/requirement-upload.ts`
  - [ ] 导出 `validateUpload(file: File): Promise<{ok: true} | {ok: false, reason: 'ext' | 'mime' | 'magic' | 'size' | 'image-too-large', message?: string}>`
  - [ ] 闸门规则:Z3 = ext 校验 ∩ MIME 校验 ∩ magic bytes(.docx = `PK\x03\x04` 开头;`.md/.txt` 不查 magic)∩ size ≤ 10 MB
  - [ ] **图片字节检查不进前端**(前端看不到 base64),由 `parseUpload()` 服务端兜
  - [ ] 单测:覆盖 6 种拒绝路径(`.rar`、错误 MIME、错 magic、>10MB、加密 docx、内嵌超大图)
- [ ] 装依赖:
  - [ ] apps/agent:`pnpm add mammoth`(纯 JS,无 native binding,Edge-friendly)
  - [ ] apps/web:无新依赖

## 验收

- 单测:`validateUpload()` 对 8 种 fixture 各返回正确 `{ok|reason}`
  - happy path:.md / .txt / 标准 docx(1 张 1×1 PNG)/ 标准 docx(无图) → `{ok: true}`
  - reject path:`.rar` / `.exe` / `.docx` 实为 `.zip` 改后缀 / `.docx` magic 不对 / >10 MB / 加密 docx(mammoth 抛错)/ 内嵌 5 MB PNG
- 端到端 fixture:写一份最小 `test/fixtures/sample-prd.docx`(纯文本 + 1 张 ≤ 2 MB PNG),走 `parseUpload()` 验证返回 markdown 含 `# 标题`,`images.length === 1`,且 `images[0].base64` 解码后字节数符合预期
- 现有 PRD 创建流程未回归(粘贴纯 markdown 创建功能不变)

## 依赖

- 无前置 ticket

## 关联文档

- [ADR-0015 D2 / D6 / D7](../../docs/adr/0015-prd-file-upload-and-editing.md)

## 非目标(明确不做)

- 抽取图片到 `assets/`(属 ticket 02)
- Dialog / DRAFTING UI 入口(属 ticket 03)
- PDF / HTML 等其他格式(ADR-0015 D2 锁 P0)
- docx 修订批注 / 注释 / 脚注无损转换(ADR-0015 § 后果 已知代价,接受)
