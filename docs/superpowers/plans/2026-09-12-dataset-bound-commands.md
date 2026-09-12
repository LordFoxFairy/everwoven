# M1-A2 · 数据库世代绑定命令 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧页面保留的未知命令在业务库重置后不得写进新库；同一库重新认证仍可安全确认原命令。

**Architecture:** manifest生成独立datasetId，凭据与可信上下文绑定同一世代；命令创建时固定datasetId，服务端进入业务Store/查回执前比对；前端重连只对相同dataset继续确认。没有旧manifest/旧命令兼容、没有自动补dataset。

**Tech Stack:** 现有TS/T3/LocalHost/SQLite/Vitest，复用UUIDv7及现有会话安全边界。

## Chunk 1: 宿主与认证

文件：runtime/src/host/storage.ts、sessions.ts、index.ts；runtime/tests/local-host.integration.test.ts及专属测试；web/server/local-session.ts及测试。

- [ ] 先写RED：新host manifest必须包含datasetId；两个独立host不同；缺字段/非法UUID拒绝而非补齐。
- [ ] Credential记录datasetId，认证验证manifest一致；authenticated server context包含ownerId/datasetId，不接收HTTP owner。
- [ ] 登录成功/认证GET只返回authenticated:true及datasetId（不是owner、token、路径），未认证仅false；所有旧会话测试同步新结构，原安全测试不删减。
- [ ] 宿主二次认证前后datasetId必须一致；以两个隔离host测试身份替换，不实际reset用户库。

## Chunk 2: 命令端到端

文件：runtime contracts/story-draft*.ts、application/story-drafts.ts、composition与ports中的可信上下文；web server/api、local-runtime、lib/authoring、现有临时面板；相关集成与单测。

- [ ] 所有create/update/delete/restore必填datasetId；严格校验，hash包含当前世代。读取cursor及缓存key绑定世代。
- [ ] 服务端比对datasetId在Store写入/回执读取之前。错误DATASET_CHANGED映射PRECONDITION_FAILED，零业务写/零回执。
- [ ] PendingCommand构造时冻结datasetId，重连不得改它。新dataset必须显示重置提示并停止确认；可复制原文本重新创作，但不能后台重发。
- [ ] 同dataset响应丢失→重连→原命令重放只一条实体；不同dataset→重连→旧命令0写入。覆盖4生命周期动作。
- [ ] 首次session未知/错误不伪装连接；更新现有adapter测试，不添加旧boolean成功响应兼容。

## Chunk 3: 验收与继续

- [ ] 主仓构建runtime、全量maxWorkers1、typecheck；独立复核。
- [ ] PROGRESS追加真实证据，精确提交。
- [ ] 下一步角色应用用例/tRPC与原CharacterLibrary，不继续扩大临时面板。最终原编辑器接入时删除临时面板。

本批不实现reset、上传、角色聚合或付费模型，不提前报告完整闭环；普通进度写文件，按用户要求静默推进。
