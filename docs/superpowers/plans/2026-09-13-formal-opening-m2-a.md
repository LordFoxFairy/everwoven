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

## Chunk 2: 开局契约、绑定和经历（内部事务完成，原入口/任务链待接）

- [x] 固定Binding的版本化JSON及本地resolver端口：connectionId/region/endpointProfileId/providerAccountScopeId、精确model、capability/adapter版本、有效参数，credentialRef仅引用。实际宿主Connection/Deployment登记与矩阵Policy后续接入。
- [x] 实现内部CreateExperience严格契约：owner来自受信调用上下文，dataset/commandId/revision防重复；固定内容、预算上限/币种及Binding快照，与immutable结果回执原子创建。回放不重新读取source/registry；完整模型能力组合预检属于Quote前的下一切片，不将opaque capabilities作为准入。
- [x] 在同一WriteGate调用Chunk1封存、验证/写Binding、Experience/setup/空ResponseDraft及回执；任一点失败新写全体回滚，既有版本保留。孩子端口也校验父归属和节点关系，防止无FK环境的跨owner影子孩子。存入零调用preparing不是已生成。
- [x] 原准备页面对接单一tRPC命令，真实异步pending/unknown/epoch；正式任务链尚未完备时不显示已开始生成。
- [ ] 真实SQLite/HTTP/Chrome完整开局、丢响应与进程重启；再接持久Quote、Operation/worker、媒体与后续回合。

## 不变的整体验收

M2-A内部原语或创建经历通过≠两幕视频通过。最终仍需预算授权→官方提交/查询→私有视频→播完情境建议/自由回应→下一幕→重启续玩→合格节点分支。任务派发未知结果保持责任，不自动重试付费POST；不自动切fal、不断章删除播后建议。必要新表按已批准规范评审baseline，不绕过DDL检查。

### Chunk2-A 内部事务落地边界（2026-09-13）

先实现`createExperience`与`getPreparingExperience`，不把历史创建回执称为当前播放快照。新增`contracts/{provider-binding,experience-opening}.ts`及对应validation、`ports/experience-opening-store.ts`、`application/experience-openings.ts`、Prisma适配和composition工厂；不增加表。ProviderBinding resolver为同步、本地、有界端口，零网络/零读秘密，严格返回owner/key/version与部署参数。parameters固定schema/connection/region/endpoint/account/catalog/operation/protocol/generation；capabilities为带schema的有界规范JSON，在这一零调用切片不作准入依据，后续policy必须解码对应能力版本。

Create输入：协议/dataset/commandId/storyDraftId/expectedStoryRevision/bindingKey/expectedBindingVersion/budget(limitMicros规范字符串,currency CNY或USD)。同一Gate先回执，再封存、绑定、经历、setup、空草稿、回执。回执ID=经历ID（不是commandId）；回放核对真实经历固定引用/预算、封存来源、绑定版本、setup及草稿身份，不重新读当前草稿/默认registry。公开binding仅白名单summary和摘要，不返回credentialRef/账户scope/原始参数。创建返回历史初始快照；getPreparing仅允许仍保持初始preparing的聚合，否则明确状态错误，后续另增完整状态查询。

RED重点：max预算精度、任意额外URL/owner字段、resolver错绑/同版本漂移、历史回执整体互换/预算/绑定替换、各写点故障回滚、同配置新command可独立创建、并发同command只一次、真实SQLite重新连接恢复；回放时当前draft/registry零访问。保存上限不构成任何付费授权，setup不显示假选项或响应入口。

### Chunk2-B 统一部署登记与输入能力策略

- [x] 将现有Web的纯部署数组/供应商型号身份迁入runtime唯一`contracts/video-deployments.ts`；Web只消费公开目录，live构造器仍独立，不拿live available判定正式job。
- [x] 将纯MiniMax请求构造迁入runtime providers，消除后端未来复制Web协议。既有调用方直接新import，删除旧实现；共用模型/规格约束。
- [x] `createVideoBindingRegistry(config)`有界解码非秘密connection/bindings，显式CN/international由代码endpointProfile映射；拒绝重复真实身份、伪型号/地区/账号错配、任意URL、原始key字段。冻结配置，resolver只同步内存解析，返回按受信owner组装的BindingSpec；当前未知account证据如实unknown，不读取秘密。
- [x] 固定capability版本/文档来源/日期/组合矩阵，检查t2v/i2v、时长/分辨率/比例、图片用途/个数/元信息和body边界；H3参考输入文档支持但本adapter未实现，不能仅凭image=true放行。结果只表示输入兼容，绝不自动授予Quote/派发。
- [x] RED→GREEN：地区映射、重复/错绑、JSON漂移、无配置、配置对象后改不影响、返值后改不污染、能力opaque/伪造/未知版本、组合/素材边界、零网络。原已封存Experience仍不读当前registry恢复。
- [x] 主仓全量/types、独立review及原页面production回归后提交（最终证据以PROGRESS为准）；下一接Host startup固定加载与原tRPC/准备入口，不在每个HTTP内反复重读变动配置。

新文件以`apps/runtime/src/{contracts/video-deployments.ts,providers/minimax-request.ts,providers/minimax-constraints.ts,providers/minimax-capabilities.ts,application/video-binding-registry.ts,contracts/video-binding-registry.ts}`为边界；tests按纯registry/能力/request分组。本片无schema变更、无账户API/报价费用调用。

### Chunk2-C 原Host/tRPC/准备入口（Host/HTTP与原准备UI已实施，真实任务链待接）

- [x] 增加浏览器纯`parseExperienceOpeningDTO/Result`及binding选择目录契约，严格字段/UUID/时间/来源关系；不给原始binding私密字段进入wire。
- [x] 复用Host认证/目录身份及DB生命周期，固定startup加载非秘密provider配置，缺失为空、坏配置只阻断新provider选择而不阻断角色/剧本或历史经历读回；resolver在新开局才解析，回执仍优先。
- [x] 增加窄`withLocalExperienceOpenings`和公开错误白名单，不由Web打开Prisma。统一服务端binding列表、create、getPreparing，runtime包新增纯契约出口。
- [x] 同步tRPC router/context/http的来源、标记、非batch、大小和错误脱敏；真实HTTP未认证/跨源/未知字段/混batch/超限/数据库断开重启验证。不是仅root挂三个函数。
- [x] 原保存后的准备浮层消费目录与explicit预算，明确零调用固定确认；unknown保留原command/payload、dataset/epoch挡迟到，目录/弹窗/自动会话不创建经历。公开API实际验证后再接UI，最后原3100Chrome。

固定启动对象必须跨Node launcher与Next route模块可见并绑定directory/environment/owner/dataset，热加载不重复重读可变配置；实际同进程桥接以production+dev HTTP验证，不仅单元测试假设。私密配置字段不返回前端、不建密钥输入框；缺密钥只在后续真实付费测试阶段由用户本地提供，当前代码仍可实施。
