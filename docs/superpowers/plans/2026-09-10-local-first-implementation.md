# V1 本地优先实施计划

日期：2026-09-10 · PRD1.9 / 技术方案1.2同步修订 · 状态：设计基线已获方向同意，M0实施前仍需完成该阶段验证。下面列出完整计划，不表示每项功能已建成。最新M0-A进度见下方记录。

基准：[技术架构](../../architecture/ARCHITECTURE.md)、[PRD](../../../FINAL-PRD.md)。每个里程碑独立验收；不同时改两套原型与正式应用，不把仓库所有未提交内容视为本轮改动。

[需求到技术追踪](../../architecture/PRD-TECH-TRACEABILITY-V1.md)统一F/P/AC映射。原型主链按P05→P06→P07评审，技术地基不等待全部视觉页面定稿，但不得将技术文档通过当作Gate A完成。

最新：[M0-A已完成首个文件库验证切片](../../implementation/M0-A-2026-09-10.md)，包括依赖固定、迁移、内部事务/回执及CLI检查；Next/tRPC受保护接入、身份、实例租约和备份尚待后续切片。

最新补充：[M0-B内部剧本根CRUD验证](../../implementation/M0-B-STORY-CRUD-2026-09-10.md)已完成；不等于HTTP、宿主身份、备份或UI迁移完成。

## M0 · 版本、契约与 SQLite 地基（第一实施切片）

### 0.1 固定开发基线

涉及：根与 Web `package.json`、lockfile、Node 版本文件、CI 配置（新增时注明）。

- 保留当前已验证 UI 版本，逐项将 latest 改为精确版本，避免顺便全面升级。
- 对齐 Node/类型版本，验证 TS、Prisma ORM 7 候选、SQLite 驱动与Next/tRPC的组合；不使用 Prisma Next Early Access。
- 新依赖先最小安装/编译探针，再记录精确版本、peer dependency、SQLite 实际版本及 OS；原型保持可运行。
- 验证：原测试、typecheck、build；记录执行环境，不引用历史通过数替代。

### 0.2 内部用例与T3数据访问边界

契约基准：[T3裁决](../../architecture/T3-FRONTEND-MOCK-2026-09-10.md)与AppRouter/Zod；[旧API语义](../../api/CONTRACT.md)只作业务检查表，不再生成第二套REST客户端。每项tRPC先冻结输入/输出/权限/错误/CAS/幂等，再做真实HTTP测试和实现记录；不因接入tRPC而改旧OpenAPI标识。


新增最小文件面：

```text
apps/runtime/package.json
apps/runtime/src/main.ts
apps/web/server/api/routers/*
apps/runtime/src/infrastructure/db/client.ts
apps/runtime/src/infrastructure/db/repositories.ts
apps/runtime/prisma/schema.prisma
apps/runtime/prisma/migrations/*
apps/runtime/tests/db.integration.test.ts
packages/contracts/package.json
packages/contracts/src/common.ts
packages/contracts/src/authoring.ts
packages/contracts/src/experience.ts
```

- M0 建立 [数据规范](../../architecture/DATA-DESIGN.md) 的15个关系模型，包含显式人物/素材关联、ProviderBindingVersion 与 InteractionEvent 的 setup 身份，避免经历/回应草稿引用未建对象。M2再加任务/账本/outbox/媒体结构，不实现所有远期业务。
- 建立Next/tRPC组合入口、loopback/Host/Origin/会话验证、统一错误格式；前端不导出 Prisma 类型。
- 一个 DB owner，连接初始化断言；固定 app data 目录，数据不入 git。迁移命令显式运行，应用不执行开发性 schema reset。
- 核对 Prisma 生成SQL零外键、真实唯一登记一致；封口/引用/生命周期约束由WriteGate用例承担，直接SQL反例和实际Prisma驱动CRUD都通过；本轮评审样本不直接冒充正式迁移。UUIDv7/Clock及createdAt/updatedAt/deletedAt由仓库统一维护，关系、时序和数据字典同时维护。
- 错误路径：过旧驱动、只读目录、磁盘不足、迁移失败、第二 runtime 启动、无身份请求。
- 仓库测试在临时真实文件库运行：零外键断言、真实业务唯一、WriteGate关联校验、事务回滚、相同幂等键、不同 payload 冲突、双窗口 CAS；不只用内存 Mock 测试。

### 0.3 备份与版本升级

新增：`apps/runtime/src/infrastructure/backup/` 与集成测试。

- 初次空库迁移、旧版本有数据迁移，均不丢草稿/引用；升级前一致性备份。
- 备份 manifest + DB + 素材 hash；无完成标记的备份视为未完成。
- 恢复到隔离目录，禁止 worker/付费网络先运行；旧实例停止后切换。
- 拒绝缺文件、损坏、未来 schema 版本；报告可修复项，不覆盖原目录。
- 验收：关闭/重启后保存结果一致（包括未发送回应草稿）；从备份恢复后对象/引用一致，且不会自动提交任何模型请求。

**M0 Done：** 独立 runtime 可启动、连接配置和实际引擎版本已验证，读写/冲突/迁移/备份恢复测试通过；Web 尚不接真实视频也可接受。PRD/状态记录同步更新实际结果。

## M1 · 正式创作与保存闭环

涉及：内部authoring/asset用例与Next/tRPC路由、Web 创作/角色/图片页面、旧 storage 适配、导入工具。

1. API 保存剧本/角色草稿；UI 只有服务器确认后显示“已保存”。断网/冲突保留编辑内容。
2. 开局创建不可变 StoryVersion 与人物引用，再建立独立 Experience；不打开列表就生成视频。
3. 图片通过 runtime 受控上传到本机文件；用途、预览、替换、引用及删除策略统一；开始生成前才进入模型素材发送流程。
4. 导入旧 3100/3103 数据：用户在各自 origin 导出；新应用预览、校验包/图片、幂等导入；模拟经历保持模拟，不转换为真实事实。
5. 迁移正式创作页使用已认可的视觉规则；先不重写 Player 的媒体传输。

测试：自定义图片失败不覆盖旧图；连续上传/切页面不串图；角色模板修改不改旧经历；双窗口覆盖被拦截；重复导入不重复对象；设置保存→服务重启→打开原经历。

**M1 Done：** 剧本/角色/图片/经历真值在 SQLite，localStorage 只留显式草稿或缓存；一期原型导入与保留/清理范围有说明。

## M2 · 可恢复任务链，先隔离故障测试再官方验证

新增专项门槛：[Provider规范§7](../../architecture/PROVIDER-DESIGN.md)。Connection地区/账户、ExecutionProfile、最终请求与授权包络、完整计量及任务查询期限必须落地；现有minimax-jobs只有单次CN创建/查询，不直接作为完成状态。恢复快照必须暴露失败turn目标，初始budgetLimit在M1持久化并由M2沿用。

新增：BudgetScope、Quote、ControlLease、GenerationJob、ProviderOperation、TurnRun、BudgetReservation、UsageEntry、DomainEvent、Outbox；应用任务用例、worker、ProviderBinding 能力校验。

- 后台只在隔离测试中注入确定性Provider替身，验证延迟、超时、重复返回、taskId不匹配、损坏媒体、租约过期。不注册产品MockProvider、不提供后端演示路由；产品Mock仍归前端管理。
- 首个真实预算迁移即建BudgetScope：根树总限额与单路线新增消费子限额，同一账本记录两个作用域；并发接受Quote原子检查，unknown与删除不释放责任。既有经历回填scope要保持余额守恒，见分支专项§6。
- Turn输入记录来源Savepoint/Interaction；Media记录生成Turn，不建伪唯一parent或多套next指针。M3再建立已确认快照与存档点；M2正式开场输入可空，必须有明确setup来源。
- 迁移已有官方适配器及测试；检查打包隔离，旧 fal 实验不参与一期路由。
- 复核官方文档的精确模型、端点、请求/查询/错误、素材输入、时长/尺寸、音频、取消/幂等、输出有效期和计费；将来源/日期写入 capability 验证记录。
- 实现 ProviderAssetTransport：官方上传/内联输入优先；仅 HTTPS 输入的部署需另行确认临时私有对象存储与限时 URL。验证上传回执、有效期、重启核对、清理及费用；localhost 图片地址不传给远端模型。
- 实现 SaveAndPause/Resume、调度 epoch 与短请求门锁、前台续租到期；测试退出与新付费请求的竞争。断开页面不等于服务端已暂停。
- P05创建零调用经历后再取得控制/报价；固定配置变化显式准备新经历，不能调用不存在的Experience PATCH。有效建议可分别取得确定性报价，只接受所选一份，不预生成分支视频。
- 验证报价动作/费用/素材绑定、到期/一次消费、幂等历史回执与当前快照分离；备份恢复轮换宿主世代/经历流身份并废止旧会话/许可/未接受报价。
- 验证 ResponseDraft 的独立版本与 SaveAndPause 原子保存；生成失败 RetryTurn 恢复原回合，未知提交仅核对。
- 验证scope→Experience→WriteGate锁序、unknown落库与另一分支开始发送的交错、热更新/唯一调度拥有者和重启屏障；不以进程内各自mutex当跨进程保证。
- 官方测试需要本地配置凭证和单独确认费用上限；未知提交不盲重提。先验证供应商创建/查询，再接 Player，失败不由 fal 代替。
- 测试在发出请求前/后、taskId 写入前/后、结算前/后强制终止进程；验证恢复不重复提交、费用不重复记账。
- 预算上界未知或原生音频要求未满足时，明确阻断相应能力准入。

**M2 Done：** 隔离故障矩阵及scope并发/迁移测试通过；真实官方任务有独立证据与预算记录（缺证据只算测试基础完成，不称官方接通）。

## M3 · 单编排与正式单舞台 Player

新增/迁移：runtime 编排与语义校验模块；`packages/player`；Web 经历页面与 SSE/API adapter。

- LangChain 结构化提案 + 确定性规则 + 有界修复；LangGraph 阶段恢复引用既有 operation 回执。
- AI SDK UI adapter 只映射 UI 数据/工具状态，不产生第二套回合、任务和世界状态。
- Player 接快照、media、actions，宿主注入导航/认证；不直接创建供应商任务。
- 真实片段检查通过才播放；结束后出现 2–4 建议与自由回应；输入法、安全焦点、草稿保存、设置/全屏不重启生成。
- 断流读取快照+cursor 恢复；重复事件忽略；旧节点提交不自动改成新节点。
- 完成Gate B至少30例独立语义评测，其中至少3例来自同一非恋爱情境，分别覆盖接受/拒绝/非选项表达；冻结等待/成本/连续性指标，不把M2供应商冒烟当作完成。
- 检查事实合并证据、未看完退出、两轮后果、一致人物、已消费节点、预算耗尽与坏媒体状态。
- 有效完整播放＋确认事实＋不可变StateSnapshot/Savepoint＋新互动节点同事务提交；技术暂停恢复点不自动可fork，当前状态不能由聊天数组或Agent checkpoint代替。

**M3 Done：** 至少两轮真实生成与保存/重开可复现，满足 PRD Gate B 与 Gate C 的 Web 子集；此时仅称 Web 闭环验收，完整可玩 Alpha 要等 M4 双端 Gate C。两轮冒烟不代替完整质量样本。

## B1/B2 · 分支扩展切片（M3之后，排期单独确认）

- B1：稳定点预览、只读前缀/媒体、fork新Experience、fork_base独立decision/空稿、保存暂停与恢复、引用/GC、两级费用与幂等。完成[BR01–12](../../architecture/BRANCH-SAVEPOINTS-DESIGN.md)才开放入口；不先做一棵可点但会串记忆/预算的树。
- B2：懒加载故事树、分支命名/整理和对比；游玩时入口可收纳，不常驻编辑画布，不预生成未选路线。
- 候选[tRPC契约](../../api/BRANCH-CONTRACT-DRAFT.md)按实现冻结；不直接执行设计DDL，不改M0历史迁移。二期创作Chat/画布独立排期，共用创作Service但不改已发生存档真值。

## M4 · 桌面封装与发布准备

- 先限定已实测 OS/架构；Tauri 薄壳复用 Player，sidecar 包含所需运行环境与原生驱动。
- 验证系统安全存储、最小权限、视频格式/Range、全屏、后台/关闭/重启、数据目录、更新/回滚。
- 桌面退出明确说明已受理任务可能继续生成/收费；下次启动核对旧 taskId。
- 正式分发前做权限、日志脱敏、依赖检查、恢复演练与真实用户体验验收。

## 主仓验证纪律

每个切片先失败用例再实现，执行对应单元/集成测试及整体 `pnpm test`、`pnpm typecheck`、`pnpm build`；新增 runtime 的构建/类型/测试须加入根脚本，避免只验证旧 Web。UI 切片补 Playwright；桌面补真机。测试通过、模型能力验证、产品体验验收分别记录，不混为“全部闭环”。

不要在 M0 同时做 PostgreSQL/对象存储适配、多人同步、物体点击或 DeepAgents。目录与接口有真实消费者时再创建，保持首期可维护规模。
