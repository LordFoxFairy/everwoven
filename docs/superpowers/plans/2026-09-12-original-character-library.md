# M1-B · 正式角色用例与原角色库 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同一原角色库完成真正create/read/update/delete/restore及重启读回，不增加数据库专属角色页面。

**Architecture:** CharacterLibrary保留表现层，通过异步CharacterPort调用tRPC；正式模式不得读写浏览器角色库。服务使用scope=library的owner+datasetId边界、CAS及幂等回执。剧本作用域模板只能由后续剧本聚合用例维护。

**Tech Stack:** T3、Prisma/SQLite、现有组件与Vitest，复用已实现的命令世代和宿主会话。

## 依赖门槛

M1-A2 datasetId贯通及复核通过后开始。角色图片上传服务尚未落地前，正式模式图片入口明确待接入，不允许把IndexedDB图片ID送给后端；演练仍保留前端图片功能。M1-C补齐真实图片后此门槛删除。

## Chunk 1: 正式角色服务

文件拟增：runtime/contracts/character-template.ts、character-template-validation.ts；application/characters.ts；ports/character-store.ts；infrastructure/db/prisma-character-store.ts；composition/character-service.ts；tests/characters.integration.test.ts。

- [ ] TDD契约：name1–120；personality≤8000/appearance≤4000/speakingStyle≤2000/boundaries≤4000均必填可空；portraitAssetId为null或正式UUIDv7；严格未知字段拒绝，不接受scope/owner/client timestamps。
- [ ] DTO顶层name，settings四项、portraitAssetId、id/schemaVersion/revision/四生命周期字段。禁止把姓名再存进settings。
- [ ] create/get/list/update/delete/restore，scope限定library；同owner但story作用域的ID也返回NOT_FOUND。输入稳定datasetId/commandId，所有写前比对世代。
- [ ] 事务先WriteGate，再回执/幂等、CAS、引用验证。头像非null必须同owner且ready/未deleted；重复姓名合法，错误和回执不泄漏路径。
- [ ] 人物图片/角色模板软删除不更改CharacterVersion；不存在/跨owner/内部scope都不可绕过。未来version冻结由聚合用例完成，不在一般update中改历史。
- [ ] keyset分页+q查询和同过滤totalMatching；恢复不被同名冲突，溢出revision拒绝。
- [ ] 服务依赖Store端口，不通过PrismaClient绕过用例。复用纯校验辅助函数，不抽万能BaseService。

## Chunk 2: 宿主与tRPC

修改：runtime/host导出组合（不要扩写Story名称的万能服务）；Web server/api新增characters router；runtime/package exports；lib/authoring远程character adapter。

- [ ] 新router复用当前会话/Origin/body边界；禁止第二REST CRUD、客户端owner、按客户端提供的路径开库。
- [ ] 真实HTTP临时宿主验证六操作及401/跨owner/同名/CAS/同命令不同payload/跨dataset零写入。
- [ ] 请求失败含糊时不自动mutation retry，向控制器保留结构化领域错误。

## Chunk 3: 原角色库接入

修改：components/character-library.tsx、platform.tsx、story-editor.tsx中的另存角色调用点、lib/authoring组合/角色控制器；增加组件组合测试。

- [ ] 从同步onSave:boolean改明确异步Promise接口。按钮ref锁防同帧重复，成功前不显示保存成功。
- [ ] 编辑副本与已确认DTO分开；等待期间的新输入不被成功回执覆盖。未知命令稳定重放，跨dataset停止重放。
- [ ] 保留当前角色卡片/编辑布局，添加加载、读取失败重试、冲突、回收/恢复状态；不得把网络失败显示成空库。
- [ ] 正式未连接时使用共享连接引导，不能要求用户先跳到“数据库剧本”页；导航dirty/busy/unknown上报到外层保护。
- [ ] 未完成人物允许保存草稿，name为唯一必填，生成准备的完整性另验。提示文字区分正式SQLite与demo浏览器。
- [ ] “用TA创作”携带冻结来源信息到后续编辑器，不把活模板当已生成快照；未接聚合版本前不得宣称正式剧本已保存。

## Chunk 4: 验收

- [ ] 原角色库创建→编辑→刷新→结束宿主→重启→读回全部字段；删除/恢复重启正确。
- [ ] 丢弃已提交create响应，confirm后库中只有一条；冲突保留当前输入；dataset重置后旧命令零重放。
- [ ] demo网络观察零正式写入；正式模式localStorage失败不影响数据库角色链路。
- [ ] 主仓完整回归/typecheck、真实浏览器、独立复核、PROGRESS/接口文档同步。只完成B时不发总体闭环完成通知，继续C图片/剧本聚合。

## 计划复核补充

Dewey只读复核后的实施约束：onSave返回已确认DTO/回执、结构化失败，不用Promise<boolean>；共享saveCharacter同时被Editor另存模板调用，必须一并改async调用/草稿保护，避免Promise被旧if当成功。共享session gate位于页面切换上方，明确demo/正式未配置/未连接/已连接，不回退浏览器。提交A等待时输入B，确认只重放A并保留B dirty；异库显式新建清旧id/revision/command。角色姓名上限统一120，性格不再强制必填；用TA创作只带入编辑资料与来源，不宣称固定版本或正式剧本已保存。正式头像渲染也经正式AssetPort，不偷走IndexedDB；已有正式引用保留，M1-C上传/读取接通后撤掉临时提示。
