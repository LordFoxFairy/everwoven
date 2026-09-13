# M2-A 正式开局 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户显式开始时固定完整剧本、角色/素材、供应商连接和预算，为同一经历的真实生成建立不可变输入。

**Architecture:** 沿已批准DATA-DESIGN与PROVIDER-DESIGN：应用用例依赖事务端口，Prisma适配持同一WriteGate事务；供应商调用始终在事务外。先完成可组合的版本封存原语，再与Experience、固定Binding及后续Quote/任务用例在同一事务中组合；不添加单独“发布版本”用户入口、不因阶段拆分提前收费。

**Tech Stack:** TypeScript、Prisma SQLite、UUIDv7、现有tRPC/TanStack、Vitest真实SQLite、原页面Chrome验收。

## Chunk 1: 不可变剧本封存（主会话实现，Cicero只读复核）

**Files:**
- Create: `apps/runtime/src/contracts/story-version.ts`、`story-version-validation.ts`：严格输入和冻结输出；无Prisma/Web依赖。
- Create: `apps/runtime/src/ports/story-version-store.ts`：源聚合只读及版本插入/封口，禁止普通更新。
- Create: `apps/runtime/src/application/story-versions.ts`：同源修订复用、素材ready、角色/覆盖/三槽、规范摘要与封口检查。
- Create: `apps/runtime/src/infrastructure/db/prisma-story-version-store.ts`：单一WriteGate、显式孩子表写入、封口CAS；导出事务scope供后续Experience事务组合。
- Modify: `apps/runtime/src/infrastructure/db/prisma-story-draft-store.ts`：仅导出既有只读scope工厂供同事务复用，不增加第二份聚合读取实现。
- Test: `apps/runtime/tests/story-versions.integration.test.ts`、`story-version-validation.test.ts`。

- [x] 先写契约/真实SQLite反例并运行RED：错误revision、跨owner/dataset、源已删、缺失/不可用素材；第一次完整封存与同修订复用。
- [x] 实现严格parser、规范化快照hash、header→角色/图片引用→封口CAS，任何异常回滚；已有封口必须校验自身hash与同修订源内容，未封口残留不是可复用版本。
- [x] 添加故障注入（孩子、封口、外层后续操作失败）、模板/草稿后来修改、旧版本只读、无network、不同revision版本号、真正唯一而非标题唯一。
- [x] 聚焦GREEN、runtime类型、既有聚合回归；独立规格/质量审查及主仓全量。用户数据库不seed、不改schema、不开放假开始按钮。

具体函数：`freezeStoryInScope(scope, owner, {protocolVersion:1,datasetId,storyDraftId,expectedRevision}, services)`；返回不可变StoryVersionDTO。调用者必须已持owner WriteGate；函数自身不提交事务、不创建经历、不授权费用。`readStoryVersionInScope`校验封口/孩子/摘要，不读取当前草稿或当前角色模板。

冻结正文包含title、全部StorySettings、固定MainCharacter版本/覆盖/有效值、全部素材槽；摘要绑定owner/dataset/sourceDraft/sourceRevision/version身份，不包含可变素材状态或凭据。原图文件状态在新封存/新开局时另验，历史阅读不因当前素材失效伪改旧正文。封存不递增草稿revision。Version唯一键沿现有`(storyDraftId,sourceRevision)`和`(storyDraftId,versionNo)`，不增加伪唯一。

Run: `PATH=/Users/nako/.nvm/versions/node/v22.22.2/bin:$PATH pnpm exec vitest run apps/runtime/tests/story-version-validation.test.ts apps/runtime/tests/story-versions.integration.test.ts`；RED记录具体失败，GREEN应无失败。随后`pnpm --filter runtime typecheck`及`pnpm test --maxWorkers=1`。

## Chunk 2: 开局契约、绑定和经历（后续实现，不勾选为已完成）

- [ ] 固定服务器Connection与Binding的版本化JSON：connectionId/region/endpointProfileId/providerAccountScopeId、精确model、capability/adapter版本、有效参数，credentialRef只指向秘密。
- [ ] 明确CreateExperience严格契约：owner仅来自会话，dataset/commandId/revision防重复；服务器预检内容与模型能力、客户端明确预算上限/币种，与immutable结果回执原子创建。恢复不重复创建。
- [ ] 在同一WriteGate调用Chunk1封存、验证/写Binding、Experience及回执；回执失败版本/绑定/经历一并回滚。存入零调用preparing不是已生成。
- [ ] 原准备页面对接单一tRPC命令，真实异步pending/unknown/epoch；正式任务链尚未完备时不显示已开始生成。
- [ ] 真实SQLite/HTTP/Chrome完整开局、丢响应与进程重启；再接持久Quote、Operation/worker、媒体与后续回合。

## 不变的整体验收

M2-A内部原语或创建经历通过≠两幕视频通过。最终仍需预算授权→官方提交/查询→私有视频→播完情境建议/自由回应→下一幕→重启续玩→合格节点分支。任务派发未知结果保持责任，不自动重试付费POST；不自动切fal、不断章删除播后建议。必要新表按已批准规范评审baseline，不绕过DDL检查。
