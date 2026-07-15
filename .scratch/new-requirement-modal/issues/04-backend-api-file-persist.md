---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 04 — 后端 POST /api/requirements + 文件落盘

**What to build:**

Agent 端提供 `POST /api/requirements` endpoint,接收 `{ title: string }`,返回 `{ id: string }`,并按决策 2 把需求目录 / `meta.yaml` / `requirement.md` 落到 `~/.aidevspace/requirements/<id>/`。

```
~/.aidevspace/requirements/
  req-<NNN>-<slug>/
    meta.yaml       # id / title / createdAt(决策 2)
    requirement.md  # 空模板(只有 # <title> + 留白)
```

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `POST /api/requirements` 接收 JSON `{ title: string }`,trim 后 1-50 字
- [ ] 服务端再校验一次 title(决策 b2 + 长度限制),前端已被过滤,后端兜底
- [ ] slug 派生:按 PRD §8.3 `slugify()` 规则(kebab-case + 去路径非法字符 + 50 字截断)
- [ ] ID 生成:扫 `requirements/` 目录现有 `req-NNN-*` 最大编号 + 1;空目录从 001 开始
- [ ] ID 冲突(罕见但可能)→ 自动 +1 重试,3 次仍冲突报错 `E_ID_COLLISION`
- [ ] 创建目录 `requirements/req-NNN-slug/`(mkdir recursive,0700 权限)
- [ ] 写 `meta.yaml`:
  ```yaml
  id: req-<NNN>-<slug>
  title: <trim 后原值>
  createdAt: <ISO 时间戳>
  ```
- [ ] 写 `requirement.md` 空模板:`# <title>\n\n<!-- 在 DRAFTING 工位编写需求背景、目标、AC -->\n`
- [ ] 返回 `{ id }`,HTTP 201
- [ ] 鉴权:校验 `X-AIDevSpace-Token`(决策 34)+ Origin 白名单 `localhost:3333`
- [ ] 错误码 E6-E9 映射:网络错 / 鉴权错 / 磁盘满 → 红色 banner(由 ticket 01 前端消费)
- [ ] SSE 推送(决策 31):创建成功 / 失败时通过 `@fastify/sse` 推事件,前端 DRAFTING 骨架屏切正常 / 红色 banner
- [ ] 单元测试覆盖:slug 派生 / ID 生成 / 鉴权 / 错误码映射
- [ ] e2e 测试:真实调 API → 验证文件落盘 + meta.yaml 字段
