---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 01
Blocks: 02, 03, 06
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 04: WorkspaceService 改 yaml 真相源 + 一次性迁移 + .gitignore 补齐

## 目标

把 `apps/agent/src/services/WorkspaceService.ts` 的 `SUBDIRS` 移除 `'repos'`；新增 `readRepoRegistry` / `findRepoByName` / `addRepo` / `updateRepo` / `removeRepo` / `findCodebaseUsage` 6 个方法封装 yaml 读写；启动时一次性迁移旧 `repos/` 目录进 yaml；`.gitignore` 补 `requirements/*/codebase/`。

## 子项

### 4.1 SUBDIRS 移除 'repos'

```typescript
// 旧
const SUBDIRS = ['requirements', 'repos', 'knowledge', 'skills', 'analysis-skills', 'logs'] as const

// 新
const SUBDIRS = ['requirements', 'knowledge', 'skills', 'analysis-skills', 'logs'] as const
```

`initWorkspace()` 不再 mkdir `repos/`。

### 4.2 新增 yaml 路径

```typescript
function reposYamlPath(root: string): string {
  return join(root, 'repos.yaml')
}
```

### 4.3 新增 6 个方法

```typescript
export interface RepoRegistryPatch {
  name: string
  gitUrl: string
  description: string
}

class WorkspaceService {
  /** 读 yaml；文件不存在返 { version: 1, repos: [] }（合法空态） */
  readRepoRegistry(): RepoRegistry

  /** 按 name 找；找不到返 null */
  findRepoByName(name: string): RepoRegistryEntry | null

  /** 原子写入（读-改-写 + 200ms 退避轻量重试覆盖并发） */
  addRepo(entry: RepoRegistryPatch): void

  /** 部分字段更新；name 不能改（name 是标识） */
  updateRepo(name: string, patch: Partial<RepoRegistryPatch>): RepoRegistryEntry

  removeRepo(name: string): void

  /** 扫 requirements/*/codebase/<name>/ 派生使用列表 */
  findCodebaseUsage(name: string): Array<{ requirementId: string; branch: string; codebasePath: string }>
}
```

实现细节：
- `addRepo` / `updateRepo` / `removeRepo` 都用「读 → 改 → 写」模式，写失败 → 重试 1 次（200ms 后），再失败抛 `E_REGISTRY_WRITE_FAILED`
- 写用 `yaml.stringify` + 临时文件 + `rename`（POSIX 原子 / Windows 接近原子）
- `findCodebaseUsage` 用 `readdirSync(requirements/*/codebase/<name>)` + 读 `meta.yaml.branchName`

### 4.4 启动时一次性迁移

```typescript
async initWorkspace(): Promise<InitWorkspaceResult> {
  // ... 既有 mkdir + config 初始化 ...
  
  // 一次性迁移（旧 → 新）
  const oldReposDir = join(root, 'repos')
  if (existsSync(oldReposDir)) {
    const migrated = await this.migrateOldReposDir(oldReposDir)
    if (migrated.length > 0) {
      log.info(`migrated ${migrated.length} repos from repos/ to repos.yaml: ${migrated.join(', ')}`)
      // 提示 UI：「旧目录可手动删除 ~/.aidevspace/repos/」
    }
  }
}

private async migrateOldReposDir(dir: string): Promise<string[]> {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
  const migrated: string[] = []
  for (const entry of entries) {
    const subPath = join(dir, entry.name, '.git')
    if (!existsSync(subPath)) continue  // 跳过非 git 目录
    
    // 读 origin URL
    const configText = await readFile(join(subPath, 'config'), 'utf8').catch(() => '')
    const originMatch = configText.match(/\[remote "origin"\][^\[]*url = (.+)/)
    const gitUrl = originMatch?.[1]?.trim() ?? ''
    
    if (!gitUrl) continue
    
    // 写 yaml（跳过同名已存在）
    const existing = this.findRepoByName(entry.name)
    if (!existing) {
      try {
        this.addRepo({ name: entry.name, gitUrl, description: '' })
        migrated.push(entry.name)
      } catch (err) {
        log.warn(`failed to migrate ${entry.name}:`, err)
      }
    }
  }
  return migrated
}
```

不删旧目录（决策 Q3）——日志 + UI 提示。

### 4.5 `.gitignore` 补齐

```typescript
const GITIGNORE_CONTENT = [
  '# AI DevSpace workspace',
  'logs/',
  'snapshots/',
  'requirements/*/codebase/',      // ← 新增
  'requirements/*/codebase/**/.git/', // ← 新增（避免嵌套 git 仓库污染 workspace 自身的版本管理）
  '*/node_modules/',
  '.DS_Store',
  '*.log',
  '',
].join('\n')
```

**重要**：仅当 workspace 自身是 git 仓库时这条 gitignore 才生效——`initWorkspace` 检测 `.git` 存在才写，否则跳过（保留原内容）。

### 4.6 测试

- `apps/agent/src/__tests__/WorkspaceService-yaml.test.ts`：yaml 读写 6 方法
- `apps/agent/src/__tests__/WorkspaceService-migrate.test.ts`：tmp 目录建 fake git 仓库 → 调 `initWorkspace` → 验证迁移进 yaml
- `apps/agent/src/__tests__/WorkspaceService-gitignore.test.ts`：检测 `.git` → 写 gitignore；不检测 → 不写

## 验收清单

- [ ] `SUBDIRS` 不含 `'repos'`；`initWorkspace()` 不再 mkdir `repos/`
- [ ] `repos.yaml` 文件不存在 → `readRepoRegistry` 返 `{version:1, repos:[]}` 不抛
- [ ] `addRepo` / `updateRepo` / `removeRepo` 原子写入；并发测试 100 次不丢
- [ ] `findCodebaseUsage` 扫真实 `requirements/*/codebase/<name>/` 派生
- [ ] 启动迁移：fake `<root>/repos/<n>/.git/config` → yaml 自动出现 `<n>` 条目
- [ ] `.gitignore` 仅当 workspace 有 `.git` 时补齐新规则
- [ ] 迁移日志 + UI 提示文案落定

## 风险

- 启动迁移在用户已经有 50+ 仓库时跑得慢——`for of` 串行，每条 read `.git/config` < 5ms，总 < 250ms 可接受
- `findCodebaseUsage` 全扫 `requirements/*/codebase/`——需求多时慢（千级 × 子目录扫描）；本期先简单实现，P2 加缓存

## 引用

- [PRD FR-1.1 / FR-6](../PRD.md#fr-1-注册表读写)
- [ADR-0030 D1 / D2 / 负面第 3 条](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q3 / C6](../decisions.md)
