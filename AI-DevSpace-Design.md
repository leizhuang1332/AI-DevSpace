你的场景本质上不是一个普通的 IDE 插件，而是一个 **AI 原生的软件研发管理与执行平台（AI Software Engineering Workspace）**。

核心理念应该从传统的：

> 项目 → 代码 → Issue → 开发

转变为：

> **需求（Requirement） → AI 分析 → 设计 → 计划 → 任务 → 代码变更 → 测试 → 验收 → 知识沉淀**

你的工作单位应该是「需求」，而不是「代码仓库」。

下面我从产品架构、页面布局、交互流程、功能模块几个方面设计。

# 一、整体产品定位

产品名称可以叫：

> AI Development Workspace（AI DevSpace）

一句话定位：

> 一个以需求为中心，连接 AI Agent、代码仓库、研发流程、知识库的后端开发工作台。

核心对象：

```
Workspace
 ├── Requirement（需求）
 │
 ├── AI Agent
 │
 ├── Repository（代码仓库）
 │
 ├── Task（任务）
 │
 ├── Artifact（产物）
 │
 ├── Test Case（测试）
 │
 ├── Knowledge（知识）
 │
 └── Team Collaboration
```

---

# 二、整体信息架构

建议采用类似：

* Linear
* Jira
* GitLab
* Cursor
* Notion

混合模式。

一级导航：

```
------------------------------------------------
| Logo | Workspace                             |
------------------------------------------------
|
| 🏠 Dashboard
|
| 📌 Requirements
|
| 🤖 AI Agents
|
| 📚 Knowledge Base
|
| 📦 Repositories
|
| ⚙️ Settings
|
------------------------------------------------
```

---

# 三、首页 Dashboard

目标：

> 一眼知道所有需求状态。

布局：

```
+------------------------------------------------+
| 今日开发状态                                   |
+------------------------------------------------+

进行中的需求

┌──────────────┐ ┌──────────────┐
│ 用户中心改造 │ │ 支付系统升级 │
│ 75%          │ │ 35%          │
│ AI开发中     │ │ 等待确认     │
└──────────────┘


+------------------------------------------------+

AI Agent 状态

AI-Backend-Agent

当前任务：
生成订单服务接口

状态：
Coding


+------------------------------------------------+

待处理事项

☐ 确认数据库设计
☐ Review AI生成代码
☐ 补充测试场景


+------------------------------------------------+

最近活动

12:30
AI 修改 OrderService

11:20
生成数据库设计文档

10:00
完成接口测试

```

---

# 四、核心页面：需求管理

## Requirement List

类似 Linear。

```
需求列表


+------------------------------------------------+

搜索

状态:
[全部] [分析中] [开发中] [测试中] [完成]


-------------------------------------------------

订单退款优化

状态:
████████░░ 80%

阶段:
测试阶段

关联服务:
order-service
payment-service


-------------------------------------------------

会员系统升级

████░░░░░░ 40%

阶段:
开发阶段

```

每个需求是一个 AI 工作空间。

---

# 五、需求详情页（核心）

进入需求后：

采用 IDE + 项目管理混合布局。

## 页面布局

```
----------------------------------------------------
需求名称：
订单退款功能优化

状态:
开发中 65%

----------------------------------------------------

| 左侧导航 |       中间工作区       | AI助手 |
|          |                        |        |
|          |                        |        |
----------------------------------------------------

```

---

# 六、左侧需求 Workspace

类似 VSCode Explorer。

```
订单退款优化


📄 Requirement

📋 Analysis

🎨 Design

📝 Plan


Tasks

 ☑ 需求分析
 ☑ 数据库设计
 ▶ refund-service开发
 ☐ payment-service开发
 ☐ 自动化测试


Repositories

 📦 refund-service
 📦 payment-service


Artifacts

 📄 refund.sql
 📄 api.yaml
 📄 apollo.yaml

Tests

 🧪 Test Cases


Knowledge

 📚 退款流程说明

```

---

# 七、中间区域：开发主工作区

根据当前选择显示。

## 1. Requirement

展示：

* 原始PRD
* AI分析结果
* 澄清问题

例如：

```
AI需求理解


目标：

支持用户申请退款


涉及服务：

✔ order-service

✔ payment-service


风险：

⚠ 支付退款状态同步


待确认：

Q1:
退款失败是否自动重试？

[确认]

```

---

## 2. Design 页面

展示AI设计文档。

Tabs：

```
Database

API

Service

Sequence

Architecture

```

例如：

数据库设计：

```
refund_order

id
order_id
status
amount
created_at


Indexes:

idx_order_id

```

支持：

按钮：

```
[AI优化设计]

[生成SQL]

[提交Review]

```

---

## 3. Plan 页面

执行计划。

```
开发计划


Phase 1

☑ 创建数据库

☑ 修改order-service


Phase 2

▶ 开发refund-service


Phase 3

测试


```

AI执行时：

实时更新：

```
AI Agent:

正在执行 Task #12

状态:

Analyzing
 ↓
Coding
 ↓
Testing

```

---

# 八、AI Agent区域（右侧）

这是最重要的。

不是普通聊天窗口。

应该叫：

> AI Engineering Agent

布局：

```
--------------------------------
AI Backend Agent


Context:

需求:
订单退款

Repositories:

3


Knowledge:

退款领域知识


--------------------------------

聊天区域


用户：

退款失败怎么处理？


AI:

根据设计：

方案A...

建议修改：

...


--------------------------------

输入框

@repo
@task
@file
@knowledge

```

支持：

```
@requirement
@repository
@file
@task
@test
```

例如：

```
@payment-service

分析退款接口风险
```

---

# 九、多仓库管理

解决你的第一个痛点。

Requirement关联多个repo。

模型：

```
Requirement


Repositories:

order-service

payment-service

user-service


```

页面：

```
Repositories


order-service


branch:
feature/refund


Latest Commit:

abc123


Changed Files:

+ RefundController.java
+ RefundService.java


[Open IDEA]

[View Diff]

```

支持：

* Git clone
* branch管理
* commit查看
* diff查看
* AI code review

---

# 十、Artifact 管理（解决产物丢失）

非常重要。

所有AI产物统一管理。

Artifact类型：

```
Requirement.md

Design.md

Plan.md

schema.sql

api.yaml

apollo.yaml

docker-compose.yaml

test-case.yaml

```

结构：

```
Artifacts


Database

 └ refund.sql


Config

 └ apollo.yaml


API

 └ openapi.yaml


Test

 └ refund-test.yaml

```

每个artifact：

版本化：

```
v1

v2

v3

```

类似 Git。

---

# 十一、任务系统

Task 是 AI 执行单位。

模型：

```
Task


id

requirement_id

title

type

status

agent

repository


```

状态：

```
TODO

ANALYZING

DESIGNING

CODING

TESTING

REVIEW

DONE

```

页面：

```
Task Board


TODO

| 数据库设计


CODING

| refund-service接口开发


TESTING

| 自动化测试

```

---

# 十二、代码规范中心

解决痛点3。

建立：

## Coding Standard

```
Java Backend Rules


Controller规范

Service规范

Exception规范

日志规范

数据库规范


```

AI Coding时自动加载：

```
AI Context:

+
Requirement

+
Repository

+
Coding Standard

+
Knowledge

```

---

# 十三、测试规范中心

Test Standard。

例如：

```
API测试要求


每个接口必须包含：

✔ 正常流程

✔ 参数异常

✔ 权限异常

✔ 并发测试


```

AI生成测试：

自动遵循。

---

# 十四、验收标准模块

Acceptance Criteria。

需求创建时：

AI生成：

```
验收标准


1.

用户可以提交退款


2.

退款成功后订单状态更新


3.

支付状态同步


```

开发完成：

AI自动检查：

```
Acceptance


✔ API完成

✔ Test通过

✔ 文档更新


缺失:

Apollo配置未提交

```

---

# 十五、知识库

解决重复问题。

类似：

Notion + RAG。

结构：

```
Knowledge


业务知识

  退款流程


技术方案

  分布式事务


Bug经验

  支付超时处理


最佳实践

  Spring规范

```

AI自动学习：

```
历史需求

+
代码

+
Bug

+
Review记录

```

---

# 十六、技术架构（TypeScript）

推荐：

## 前端

```
Next.js

TypeScript

React

Tailwind

shadcn/ui

Monaco Editor

```

## 后端

Node.js:

```
NestJS

TypeScript

```

服务：

```
workspace-service

requirement-service

agent-service

repository-service

knowledge-service

artifact-service

task-service

```

---

## AI层

Agent Orchestrator:

```
Agent Manager


|
|
+ Requirement Agent

+ Design Agent

+ Coding Agent

+ Testing Agent

+ Review Agent

```

采用：

* LangGraph
* MCP
* Function Calling

---

# 十七、数据库核心模型

简化：

```
requirement

 id
 title
 status


task

 id
 requirement_id
 status


repository

 id
 url


requirement_repository


artifact

 id
 requirement_id
 type


conversation

 id
 requirement_id


knowledge

 id


test_case

 id
 requirement_id

```

---

# 十八、最重要的交互原则

## 原则1

AI不是聊天工具，是执行者。

错误：

```
用户问
AI答
```

正确：

```
用户目标

↓

AI计划

↓

AI执行

↓

AI反馈

↓

用户确认

```

---

## 原则2

所有AI行为必须产生Artifact。

例如：

AI分析：

生成：

```
analysis.md
```

AI设计：

生成：

```
design.md
```

AI开发：

生成：

```
commit
```

---

## 原则3

上下文永远绑定Requirement。

不要：

```
打开order-service
聊天
```

而是：

```
打开退款需求

AI自动知道:

- 3个repo
- 历史讨论
- 设计
- 代码
- 测试
```

---

# 十九、MVP版本建议

不要一次做完整平台。

第一阶段：

## AI Requirement Workspace

包含：

✅ 需求管理

✅ AI聊天上下文

✅ 文档产物管理

✅ Task管理

✅ 多repo关联

第二阶段：

加入：

✅ Git集成

✅ Diff查看

✅ IDEA打开

✅ AI Coding

第三阶段：

加入：

✅ 自动测试

✅ 知识库

✅ 团队协作

---

# 最终产品形态

可以理解为：

```
        Requirement
             |
             |
    -------------------
    |        |        |
  AI分析   AI设计   AI执行
    |        |        |
 Document  Task    Code
                    |
                  Test
                    |
                Knowledge


```

这个产品如果做出来，本质上是一个 **面向微服务团队的 AI 软件工程操作系统**。

你的使用方式（vibecoding 后端开发流程）其实已经接近未来 AI Agent 软件开发的标准形态，所以产品设计重点不是“提供一个聊天窗口”，而是**把需求、上下文、任务、代码、测试、知识形成一个持续演进的工程闭环**。
