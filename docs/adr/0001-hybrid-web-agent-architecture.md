# ADR-0001: 混合形态 — Web 工作台 + 本地 Agent 守护进程

**Status:** Accepted  
**Date:** 2026-07-08  
**Deciders:** 项目负责人

## Context

产品定位需要解决"多项目切换 + AI 上下文管理 + 产物归档"。需要决定产品的物理形态：

- **A. 独立 Web 工作台**（纯浏览器，云端或本机）
- **B. IDE 插件**（JetBrains / VSCode 插件）
- **C. 桌面应用**（Electron / Tauri）
- **D. 混合形态**（Web 工作台 + 轻量本地 Agent 守护进程）

关键约束：
1. 用户**不希望替代 IDEA**（明确提到"支持使用 idea 打开"）→ 不能强绑 IDE
2. 必须能**集中管理多个微服务仓库** → 需要 Web 形态的聚合视图
3. 必须**直连本地 git / 文件系统** → 不能纯云端
4. 团队协作**MVP 不做** → 暂时不需要云端

## Decision

**采用 D 方案：混合形态**。

- **Web 工作台**（Next.js，端口 3333）：UI 展示、用户交互、状态镜像
- **本地 Agent 守护进程**（Node.js，端口 7777）：调度 SDK、文件操作、git worktree、Skill 加载
- 二者通过 localhost 上的 HTTP REST + WebSocket 通信

## Consequences

### 正面
- Web 与 Agent 进程解耦，未来上云端只需替换通信层
- 直连本机资源，git/文件/LLM 全部走本地
- 团队协作 P1+ 时，把 Web 部署到云端即可，业务代码不动
- 单进程故障隔离（Agent 挂了 Web 重启就行；SDK 崩了只影响一个需求）

### 负面 / 代价
- 两套部署、单端口暴露给本机、需要鉴权
- Web 端不能直接 `fs.readFile`（要经 Agent 代理）
- 进程管理复杂度（Agent 守护进程需要常驻）

### 拒绝方案的理由
- **A 纯 Web**：无法直连本地 git 与 LLM
- **B IDE 插件**：绑死 IDE，跨 IDE 不灵活
- **C 桌面应用**：移动端/跨设备访问困难，团队协作难做

## Alternatives Considered

详见 PRD §3。
