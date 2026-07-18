---
Status: ready-for-agent
Type: ticket
Parent: ../PRD.md
Related-ADRs: [ADR-0002]
Blocked-by: []
---

# 05 — fs 路径一致性:前端 loader 对齐后端 `~/.aidevspace/requirements/`

**What to build:** ticket 01-04 落地后,用户复盘发现三个 bug 仍未修复 —— 因为 ticket 01-04 假定的 `cwd + ../../requirements` 路径在用户环境里**根本不存在**。后端 `RequirementService.root` 在 dev/production 都是 `~/.aidevspace`,真实需求目录是 `~/.aidevspace/requirements/{id}/`,而 `<repo-root>/requirements/` 目录不存在(`ls: No such file or directory`)。本 ticket 把前端 3 个 server-only loader 切到读 `~/.aidevspace/config.yaml.workspaceRoot`,与后端完全对齐;同时把 `designing.server.ts` 里的手写 yaml parser 抽到共享模块,让 `getDraftingDataFromFs` 能读取 `meta.yaml` 填充 `title` 字段。本 ticket 完成后,bug 1 / 2 / 3 才真正消失。

**Blocked by:** None — 独立 ticket,但建议在 ticket 04 提交之后再合入(避免同一文件多次变动干扰 review)。

## Root Cause(用户环境里实测的事实)

| 路径 | 来源 | 实际存在? |
| --- | --- | --- |
| `~/.aidevspace/requirements/{id}/requirement.md` | 后端 `apps/agent/src/services/RequirementService.ts:129` `<root>/requirements/<reqId>`,`root = process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')` (`apps/agent/src/server.ts:44`) | **存在**(7 个 req 实例,含 `req-007-test托尔斯泰/{meta.yaml, requirement.md}`) |
| `<repo-root>/requirements/{id}/requirement.md` | 前端 `drafting.server.ts:88` `defaultRequirementsRoot() = resolve(process.cwd(), '../..')`,dev 时即 `<repo-root>` | **不存在**(`ls: No such file or directory`) |

配置侧的事实验证: `~/.aidevspace/config.yaml` 显式声明 `workspaceRoot: /Users/Ray/.aidevspace`,后端落盘路径由它决定。前端 loader 没有读这个 config,默认 `cwd + ../../requirements` 是凭空假设。

下游表现链:
1. `getDraftingDataFromFs('req-007-test托尔斯泰')` 找不到 requirement.md → 返 `emptyDrafting`(`empty: true`, `title: ''`)
2. 切到 ANALYZING / DESIGNING 时,`getAnalyzingDataFromFs` / `getDesigningDataFromFs` 同样找不到 `analysis/` / `design/` → 返 `emptyAnalyzing` / `emptyDesigning`,组件显示空态文案"请回 DRAFTING" → **bug 1**
3. `getDraftingDataFromFs` 只读 `requirement.md`,不读 `meta.yaml` → `DraftingData.title === ''`,只读 hero 显示 reqId 兜底 → **bug 2**
4. `empty: true` 触发 `drafting-zone.tsx:151-164` `mountSkeletonDone` setTimeout(1.5s),渲染 `DraftingSkeleton`("正在创建需求…") → **bug 3**

## Acceptance Criteria

### 新文件

- [ ] `apps/web/src/lib/yaml.server.ts`(新建,server-only):
  - 从 `designing.server.ts` 抽出 `parseFlatYamlMap` / `parseNestedBlock` / `stripQuotes` 三个函数
  - 导出 `parseFlatMap(raw: string, topKey: string): Record<string, string> | null`(仅标量字段,够 config.yaml / meta.yaml 用)
  - 导出 `parseNestedBlock(raw: string, topKey: string): Record<string, unknown> | null`(完整版本,供 designing 现有 yaml 解析继续使用)
  - 文件顶部加 JSDoc:说明 server-only(`.server.ts` 后缀);被 `designing.server.ts` / `requirements-root.server.ts` / `drafting.server.ts` 三个 server-only loader 引用;client component 不得 import

- [ ] `apps/web/src/lib/requirements-root.server.ts`(新建,server-only):
  - 导出 `resolveRequirementsRoot(): string`
  - Fallback 链(顺序):
    1. `~/.aidevspace/config.yaml` 存在 + 含 `workspaceRoot:` 标量 → 返回 `expandHome(workspaceRoot)`
    2. `process.env.AIDEVSPACE_HOME` 存在 → 返回其值
    3. fallback `resolve(process.cwd(), '../..')`(保留 dev 默认行为)
  - config.yaml 不存在 / 解析失败 / 无 workspaceRoot → 静默降级,不抛错
  - `expandHome` helper:`~` 开头 → `join(homedir(), tail)`;否则原样返回
  - 导出类型 `ResolveRequirementsRootOptions { configPath?: string }`(为测试注入 config 路径,默认 `~/.aidevspace/config.yaml`)

### 改 `designing.server.ts`

- [ ] 删除文件内部的 `parseFlatYamlMap` / `parseNestedBlock` / `stripQuotes` 三个函数定义
- [ ] 改为 `import { parseNestedBlock, parseListYaml, stripQuotes } from './yaml.server'`(其他 helper 如 `parseCandidateEntry` 保留在 designing.server.ts,因为它含业务字段映射)
- [ ] `defaultRequirementsRoot()` 函数体替换为:
  ```ts
  import { resolveRequirementsRoot } from './requirements-root.server'
  function defaultRequirementsRoot(): string {
    return resolveRequirementsRoot()
  }
  ```
- [ ] 文件 header 注释更新:删除"路径解析(对照 PRD N-2 · TODO):dev 时 `path.resolve(process.cwd(), '../../requirements/{reqId}/design/')`"段;改为引用 PRD D-6 + 新文件 `requirements-root.server.ts`

### 改 `analyzing.server.ts`

- [ ] `defaultRequirementsRoot()` 函数体替换为 `return resolveRequirementsRoot()`(同样 import 自 `./requirements-root.server`)
- [ ] 文件 header 注释更新,同上

### 改 `drafting.server.ts`

- [ ] `defaultRequirementsRoot()` 同样改为 `return resolveRequirementsRoot()`
- [ ] **`getDraftingDataFromFs` 新增 meta.yaml 读取**:在读 `requirement.md` 的同时,读同目录的 `meta.yaml`,用 `parseFlatMap(raw, 'id' | 'title' | ...)` 提取 `title` 字段(实际只需 `title`)
  - `meta.yaml` 缺失 / 解析失败 / 无 `title` 字段 → `DraftingData.title === ''`(向后兼容,与 `emptyDrafting` 默认行为一致)
  - `requirement.md` 也缺失 → `emptyDrafting(reqId)`,**不**读 meta.yaml(空态无 title 字段语义)
  - **唯一**满足条件时:文件存在 + `requirement.md` 字节数 > 10 + `meta.yaml` 解析成功 → `DraftingData.title = metaYaml.title`
- [ ] header 注释更新:删除"dev 时 `path.resolve(process.cwd(), '../../requirements/{reqId}/requirement.md')` 正确"段;引用 D-6

### 改 `PRD.md`

- [ ] 删除原 `### N-2:dev / production 路径处理` 整段(已被 D-6 取代)
- [ ] 已在父 PRD 新增 `### D-6:路径一致性` 决策章节,本 ticket 不重复编辑,只确认 D-6 内容完整

### 测试

- [ ] `apps/web/src/__tests__/yaml.server.test.ts`(新建):覆盖抽出的 parser
  - `parseFlatMap('workspaceRoot: /tmp/x', 'workspaceRoot')` → `{ workspaceRoot: '/tmp/x' }`
  - `parseFlatMap('title: foo\ncreatedAt: 2026-01-01', 'title')` → `{ title: 'foo', createdAt: '2026-01-01' }`
  - topKey 缺失 → null(不抛)
  - 多顶层 key 时只返回指定 topKey 下的字段

- [ ] `apps/web/src/__tests__/requirements-root.server.test.ts`(新建):覆盖 fallback 链
  - fixture 临时目录写入 `config.yaml` 含 `workspaceRoot: /tmp/fake-root` + `AIDEVSPACE_HOME=/env-root`(临时清空)
  - 注入 `configPath` 选项指向 fixture → 返回 `/tmp/fake-root`
  - fixture config 无 workspaceRoot 字段 → fallback AIDEVSPACE_HOME
  - fixture config 文件不存在 + AIDEVSPACE_HOME 不存在 → fallback `cwd + ../..`
  - 测试结束后清理 fixture 目录

- [ ] `apps/web/src/__tests__/drafting.server.test.ts`(追加用例,不破坏现有):
  - fixture 一个临时目录,内含 `req-test/{meta.yaml, requirement.md}`,其中:
    - `meta.yaml`: `id: req-test\ntitle: 测试需求\ncreatedAt: 2026-07-18T00:00:00Z`
    - `requirement.md`: `# foo\nbar` (>10 字节)
  - 注入 `requirementsRoot` 选项指向 fixture 父目录 + 注入 `configPath` 指向含 `workspaceRoot: <fixture>` 的临时 config
  - 断言:
    - `getDraftingDataFromFs('req-test')` 返回 `empty === false`
    - `prdMarkdown === '# foo\nbar'`
    - `title === '测试需求'`(**bug 2 修复的关键断言**)
  - 同时跑现有"文件不存在 → emptyDrafting" / "req-001 走硬编码"用例,确认向后兼容

- [ ] `apps/web/src/__tests__/designing.server.test.ts` 追加用例:fixture `design/candidates.yaml` + config 指向 fixture,断言读到非空 candidates 时 `empty === false`(路径确实找到了)

- [ ] `pnpm --filter web typecheck && pnpm --filter web test` 全套绿。

### 手测(dev server)

- [ ] 重启 `pnpm dev`(只跑 typecheck 不重启的话,前端 loader 仍在用旧代码)
- [ ] 浏览器打开 `req-007-test托尔斯泰` 的 DRAFTING → 只读 hero 显示 "test托尔斯泰"(取自 meta.yaml.title),**不**闪"正在创建需求…"骨架 overlay
- [ ] 切到 ANALYZING → 若 `analysis/` 目录无产物,显示 "还没分析" 空态(不再是 "请回 DRAFTING");若有产物则展示内容
- [ ] 切到 DESIGNING → 同上,若无 `design/candidates.yaml` 则 "还没设计" 空态;若有则展示候选方案

### 验证三 bug 消失

- [ ] **bug 1**: `req-007` 进 ANALYZING / DESIGNING 不再提示"回 DRAFTING"(若 analysis / design 产物未生成,显示"还没分析"/"还没设计"中性空态)
- [ ] **bug 2**: `req-007` 进 DRAFTING,只读 hero 标题 = "test托尔斯泰"(取自 meta.yaml)
- [ ] **bug 3**: `req-007` 进 DRAFTING 不再闪"正在创建需求…"骨架 overlay

## Out of Scope(本期不处理)

- 后端写入 `analysis/` / `design/` 产物(本期仍假定 mock 阶段这三个目录为空;ticket 01-04 已经把"读到非空就展示"的链路接好)
- production 部署时 `~/.aidevspace/config.yaml` 路径在不同 user / OS 上的适配(本期假设 dev = macOS + 当前 user)
- 自动保存 drafting 编辑到 `requirement.md`(沿用 ticket 04 O-5)
- 把 `DraftingData.title` 字段彻底删除(列表页 / 面包屑 / 只读 hero 都依赖)

## Effort Estimate

- 抽出 yaml parser: 0.5h(纯迁移,行为不变)
- 新建 requirements-root.server.ts: 1h(含 3 层 fallback + 单元测试)
- 改 3 个 server loader + header 注释: 1h
- drafting.server.ts 加 meta.yaml 读取: 1h(含 fixture 测试)
- PRD N-2 删除 + D-6 补充: 0.5h(已在父 PRD 完成,本 ticket 只核对)
- dev 手测 + 验证三 bug 消失: 0.5h
- **合计: ~4.5h**

## Files Reference

| 文件 | 改动类型 |
| --- | --- |
| `apps/web/src/lib/yaml.server.ts` | 新建(server-only) |
| `apps/web/src/lib/requirements-root.server.ts` | 新建(server-only) |
| `apps/web/src/lib/drafting.server.ts` | 改:`defaultRequirementsRoot` + 加 `meta.yaml` 读取 + 更新 header |
| `apps/web/src/lib/designing.server.ts` | 改:抽出 yaml parser 引用 + `defaultRequirementsRoot` + 更新 header |
| `apps/web/src/lib/analyzing.server.ts` | 改:`defaultRequirementsRoot` + 更新 header |
| `apps/web/src/__tests__/yaml.server.test.ts` | 新建 |
| `apps/web/src/__tests__/requirements-root.server.test.ts` | 新建 |
| `apps/web/src/__tests__/drafting.server.test.ts` | 追加 meta.yaml 用例 |
| `apps/web/src/__tests__/designing.server.test.ts` | 追加路径一致性用例 |
| `.scratch/zone-data-fidelity-fixes/PRD.md` | 已更新(D-6 新增、N-2 删除) |

## Rollback Plan

回滚到 ticket 04 提交后的状态: `git revert <ticket 05 commit>`。三个 server-only loader 恢复 `cwd + ../../requirements` 默认,行为回到 ticket 01-04 现状(bug 1/2/3 仍存在,但不引入新问题)。`yaml.server.ts` 与 `requirements-root.server.ts` 整文件删除即可,无外部依赖残留。