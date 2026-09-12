# 当前技术选择：SQLite 本地优先 + 单一编排

> **2026-09-12 实施更新：** M0-C2/C3 已接入显式本机初始化、会话和同一页面的 SQLite 世界设定 CRUD；当前契约/验收以[实施记录](docs/implementation/M0-C2-C3-LOCAL-AUTHORING-2026-09-12.md)为准。下方此前状态保留为阶段记录，不代表新增能力仍未接入，也不代表角色、素材、模型和分支已完成。

> **2026-09-10 最新实施裁决：** 最新确认：采用[T3全栈与前端Mock](docs/architecture/T3-FRONTEND-MOCK-2026-09-10.md)。以下与新裁决冲突的独立HTTP runtime/BFF及双入口描述仅供历史追溯，不指导新增实现。

更新：2026-09-10。状态：技术评审稿；前期SQLite已选择，M0-A已安装Prisma适配并在临时真实文件库验证；尚未迁移用户数据/接通正式HTTP。与旧研究冲突时以 [PRD](FINAL-PRD.md) 和 [当前架构方案](docs/architecture/ARCHITECTURE.md) 为准。

```text
Next.js Web / 后续 Tauri 共享 Player
            ↕ HTTP 命令 + SSE 领域事件
一个本机 Node runtime（Fastify 候选）
  ├─ 业务用例 / 版本 / 授权 / 预算
  ├─ Prisma + SQLite（设定、经历、任务、事实、账本）
  ├─ AssetStore → 本地图片/视频文件
  ├─ Job / Outbox / 恢复调度
  └─ LangChain / LangGraph 唯一执行层
       ├─ 文本供应商 → 精确模型
       └─ 视频任务供应商 → 精确模型 → 适配/能力版本
AI SDK UI + 官方 LangChain adapter：交互适配，不另跑 Agent
```

## 决策摘要

数据约定V1.2：禁止数据库外键；Prisma使用标量关联ID与显式应用校验，保留真实业务唯一、删除伪/冗余唯一。见 [唯一约束登记](docs/architecture/UNIQUE-KEY-REGISTER.md) 与 [ADR-0008](docs/architecture/adr/0008-no-fk-true-uniqueness.md)。

1. **SQLite 是首期正式存储，不是随手的演示存档。** runtime 是唯一数据拥有者；浏览器存储退为草稿/缓存。图片/视频不放数据库二进制字段。
2. **模块化单体，不先上微服务。** 不必装 Redis、向量数据库或 Kubernetes；任务表/outbox 先解决恢复。
3. **只有 LangChain/LangGraph 一条编排链。** AI SDK 提供 UI/流适配；DeepAgents 后续离线创作按需用。
4. **分段任务是一期骨架。** 生成→检查→播放→结束后回应；不拿实时 send/close 接口假装任务可自由介入。
5. **供应商和模型分开。** 官方 MiniMax 优先验证，不自动切 fal；源码已有适配器不等于精确接口/能力/费用已实测。
6. **事实晚于提案。** 有效播放及语义核对后幂等提交，不把计划写成已发生剧情。
7. **数据库迁移留边界，不承诺魔法换库。** PostgreSQL 是后续迁移项目，需要专用迁移、转换与核对。
8. **Vercel 可保留。** Web 托管与持久 runtime 分开；Functions 的临时文件不承担 SQLite 主库。[官方约束](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
9. **Web 与桌面复用组件/契约。** Tauri sidecar、安全存储、原生 SQLite 驱动需真机验证；不把完整 Next SSR 当桌面前提。
10. **精确版本在 M0 验证锁定。** 候选 Prisma ORM 7；Prisma Next Early Access 不作当前生产基线。M0-A已固定现有Web依赖、Node类型22.19.21与Prisma7.10.0，真实SQLite3.53.2通过本轮切片测试；更大框架组合继续分阶段验证。[Prisma 官方状态](https://github.com/prisma/orm)

## 评审入口

- [技术方案V1统一交接稿](docs/architecture/TECHNICAL-SOLUTION-V1.md)
- [API1.0语义与OpenAPI机器契约](docs/api/CONTRACT.md)

- [数据规范与 Prisma/SQL 审核样本](docs/architecture/DATA-DESIGN.md)
- [架构图、数据关系图与四组关键时序图](docs/architecture/DIAGRAMS.md)

- [完整技术方案：模块、数据、状态、API、恢复、安全、扩展](docs/architecture/ARCHITECTURE.md)
- [ADR-0006：SQLite 与 runtime 所有权](docs/architecture/adr/0006-sqlite-local-first.md)
- [ADR-0007：分段任务与单编排](docs/architecture/adr/0007-segmented-runtime-boundaries.md)
- [M0–M4 实施与验收计划](docs/superpowers/plans/2026-09-10-local-first-implementation.md)
- [供应商—模型现有记录](docs/PROVIDER-MODEL-BINDING.md)

旧比较已移至 [2026-09-08 历史技术研究](docs/archive/TECH-STACK-DECISIONS-2026-09-08.md)，只作追溯，不指导一期实施。

实际工程证据：[M0-A实施记录](docs/implementation/M0-A-2026-09-10.md)。
