# M1-A1 · 单一创作结构与新数据库基线 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 直接替换M0剧本settings与Prisma初始结构，不实现旧格式兼容；隔离库验证新结构，原用户资料暂不删除。

**Architecture:** StorySettings统一world/opening/genre/playerRole/worldRules/tone；所有当前传输/编辑器/fixture同步采用新契约。数据库baseline一次替换，结构门禁保留并增强；角色scope、完整图片元数据、上传意图为下一批真实用例提供结构，不把建表说成角色/上传功能已实现。

**Tech Stack:** 现有T3、Prisma、SQLite、Vitest，无新增框架。

## Chunk 1: StorySettings单契约

写入：runtime contracts/story-draft*.ts、application/story-drafts.ts、相关runtime测试（不含db.integration.test.ts）；现有Web DTO/路由/临时面板及相关测试、scripts/smoke/local-authoring.mjs内旧字段。禁止改Prisma/schema/client.ts和db.integration.test.ts。

- [x] 对parseSettings添加严格测试：6字段必须齐全，world≤12000/opening≤12000/genre≤80/playerRole≤4000/worldRules≤30×1000/tone≤500；旧premise拒绝，不做自动补齐。空字段作为未完成草稿合法。
- [x] 在旧实现跑RED。
- [x] 修改唯一契约与parser，命令namespace统一authoring.story.*.v1；字段顺序规范化，保留同命令幂等与CAS。
- [x] 同步全部消费方并展示opening/genre，保存/重载完整返回；不保留旧字段别名或旧parser。
- [x] 聚焦测试与类型检查，独立复核。

## Chunk 2: 新Prisma baseline与严格门禁

写入：apps/runtime/prisma、src/infrastructure/db/client.ts、schema-baseline.ts（新）、tests/db.integration.test.ts内baseline专属用例、相关架构数据文档。与Chunk1不共享写入文件。

- [x] schema新增CharacterTemplate.scope/sourceStoryDraftId；Asset.originalName/width/height为必填；AssetUpload按详细方案结构；零@relation/零FK。
- [x] 用Prisma从空结构生成全量单个baseline，删除旧未保留数据的M0迁移；新迁移名固定202609120001_authoring_baseline。
- [x] 增加真实SQLite门禁失败测试：正确表数但替换表名/缺列/缺索引/迁移checksum篡改均拒绝；测试先RED。
- [x] 结构清单从审查过的baseline固定登记；开库核对迁移checksum、实际表/列/索引（含唯一）、零FK/trigger；保持现有WAL/引擎要求。
- [x] 真实临时库验证新字段、默认scope、必填图片元数据、upload记录、同名/同hash允许，更新原DB测试；不操作用户数据库。

## Chunk 3: 集成与静默推进

- [x] 主仓runtime构建、全量低并发测试、typecheck；失败先诊断，不放宽安全/业务断言。
- [x] 更新PROGRESS与数据结构登记；注明datasetId、角色HTTP/图片服务/原编辑器尚待实施，不称完整闭环。
- [x] 精确提交，不推tag、不调用付费模型、不清用户数据。
- [ ] 继续后续datasetId→角色原页面→素材聚合→原页面验收；正常中途进度只写文件，不通知用户。

最终：主仓38文件549/549和typecheck通过；真实临时库DDL26项通过（含同名触发器先RED后GREEN）。Story及schema各自规格审核、最终代码质量审核通过。下一计划dataset-bound-commands继续，不发送本批完成通知。
