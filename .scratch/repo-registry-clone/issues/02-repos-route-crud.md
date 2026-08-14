---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 01
Blocks: 04, 06, 07
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 02: `routes/repos.ts` 重写 + GET/POST/PUT/DELETE

## 目标

把 `apps/agent/src/routes/repos.ts` 从「物理目录 readdir」改成「yaml 文件 CRUD」。**所有端点都通过 `WorkspaceService` 访问 yaml**（避免直接 fs + 重复读-改-写逻辑），见 issue 04 把 yaml 读写封装到 service 层。

## 子项

### 2.1 GET /api/repos（重写）

```typescript
async () => {
  try {
    const registry = workspaceService.readRepoRegistry()
    return reply.code(200).send({ repos: registry.repos })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return reply.code(200).send({ repos: [] })
    }
    _req.log.error({ err }, 'read repos.yaml failed')
    return reply.code(500).send({
      error: 'E_REPO_REGISTRY_READ_FAILED',
      message: err instanceof Error ? err.message : 'unknown',
    })
  }
}
```

行为：
- 文件不存在 → 200 `{repos: []}`（保留 v1.0.6 D6 的「空目录合法态」语义）
- 读失败 → 500 `E_REPO_REGISTRY_READ_FAILED`
- 不缓存（仓库数 <100，yaml 读 <1ms）

### 2.2 POST /api/repos（新增）

```typescript
{
  body: PostRepoRegistryRequestSchema,  // { name, gitUrl, description }
  handler: async (req, reply) => {
    const { name, gitUrl, description } = req.body
    
    // 1. name 唯一性
    const existing = workspaceService.findRepoByName(name)
    if (existing) {
      return reply.code(409).send({
        error: 'E_REPO_NAME_EXISTS',
        message: `仓库名 ${name} 已存在`,
      })
    }
    
    // 2. git ls-remote 验证可达 + 凭据可用
    const lsResult = await git(['ls-remote', '--heads', gitUrl], {
      timeoutMs: 10_000,
    })
    if (lsResult.code !== 0) {
      const code = mapLsRemoteError(lsResult.stderr)
      return reply.code(code === 'E_AUTH' ? 401 : 502).send({
        error: code,
        message: lsResult.stderr.trim(),
      })
    }
    
    // 3. 原子写入 yaml
    try {
      workspaceService.addRepo({ name, gitUrl, description })
    } catch (err) {
      return reply.code(500).send({
        error: 'E_REGISTRY_WRITE_FAILED',
        message: err instanceof Error ? err.message : 'unknown',
      })
    }
    
    return reply.code(201).send({ name, gitUrl, description })
  },
}
```

错误码：
- 409 `E_REPO_NAME_EXISTS`
- 401 `E_AUTH`（ls-remote 报认证错）
- 502 `E_NETWORK` / 408 `E_TIMEOUT`（网络不可达 / 超时）
- 500 `E_REGISTRY_WRITE_FAILED`

### 2.3 PUT /api/repos/:name（新增）

```typescript
{
  body: PutRepoRegistryRequestSchema,  // { gitUrl?, description? }
  handler: async (req, reply) => {
    const { name } = req.params
    const existing = workspaceService.findRepoByName(name)
    if (!existing) return reply.code(404).send({ error: 'E_REPO_NOT_FOUND' })
    
    // 不允许改 name（name 是标识）
    const patch = { ...existing, ...req.body }
    if (patch.gitUrl && patch.gitUrl !== existing.gitUrl) {
      // 改了 gitUrl 跑一次 ls-remote 验证
      const lsResult = await git(['ls-remote', '--heads', patch.gitUrl], { timeoutMs: 10_000 })
      if (lsResult.code !== 0) {
        return reply.code(401).send({ error: mapLsRemoteError(lsResult.stderr) })
      }
    }
    
    workspaceService.updateRepo(name, patch)
    return reply.code(200).send(patch)
  },
}
```

### 2.4 DELETE /api/repos/:name（新增）

```typescript
handler: async (req, reply) => {
  const { name } = req.params
  const { force } = req.query  // '?force=true' 跳过被使用警告（仍不 rm codebase）
  
  const existing = workspaceService.findRepoByName(name)
  if (!existing) return reply.code(404).send({ error: 'E_REPO_NOT_FOUND' })
  
  // 检查被多少需求使用
  const usage = workspaceService.findCodebaseUsage(name)
  
  if (usage.length > 0 && force !== 'true') {
    return reply.code(409).send({
      error: 'E_REPO_IN_USE',
      message: `该仓库被 ${usage.length} 个需求使用`,
      usage,  // [{ requirementId, branch, codebasePath }]
    })
  }
  
  workspaceService.removeRepo(name)
  return reply.code(204).send()
}
```

行为：
- 不被使用 → 直接删
- 被使用 + 未带 `?force=true` → 409 `E_REPO_IN_USE` + usage 列表（前端二次确认）
- 被使用 + 带 `?force=true` → 删；**绝不 rm** 任何 `codebase/<name>/`
- `findCodebaseUsage` 扫 `requirements/*/codebase/<name>/`，从读目录派生

### 2.5 测试

- `apps/agent/src/__tests__/repos-route.test.ts` 新增：每个端点的正常路径 + 错误码 + 边界
- `apps/agent/src/__tests__/repos-route-yaml.test.ts`：真实 yaml 写入 + 并发写测试（用 200ms 退避重试覆盖）
- 集成测试：用真 `ls-remote` 跑两个 fake git 服务器（一个可访问、一个认证错）

## 验收清单

- [ ] GET /api/repos 返回 `{repos: [{name, gitUrl, description}]}`，无 `id` 字段
- [ ] POST /api/repos 必跑 ls-remote；网络错返 401/502/408（不写 yaml）；name 重复返 409
- [ ] PUT /api/repos/:name 改 gitUrl 必跑 ls-remote；不改 gitUrl 不跑
- [ ] DELETE /api/repos/:name 被使用未带 force 返 409；带 force 删除；**不** rm 任何 codebase/
- [ ] yaml 并发写测试：10 路并发同字段写，最终一致性（200ms 退避）
- [ ] 既有 `apps/agent/src/__tests__/repos-route.test.ts` 全 RED 后被新测试替换

## 风险

- `ls-remote` 在缺凭据时**交互挂死**——必须在 issue 05 的 env 注入之后才能跑这条测试；建议先 issue 02 单测不调 git（mock gitExec），issue 05 落地后再补 e2e
- yaml 并发写在 macOS / Windows 文件锁语义差异——200ms 退避重试是妥协；写测试要跨平台跑

## 引用

- [PRD FR-1 / FR-2](../PRD.md#fr-1-注册表读写) + [FR-2 API 端点](../PRD.md#fr-2-api-端点)
- [ADR-0030 D6 / D8](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q5 / Q7 / Q9 / C5](../decisions.md)
