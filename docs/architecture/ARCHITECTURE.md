# 未完 · V1 技术架构评审稿

> **2026-09-10 最新实施裁决：** 后续传输与进程组织以[T3最新裁决](T3-FRONTEND-MOCK-2026-09-10.md)为准：单Next全栈入口、tRPC调用业务Service、前端独立管理Mock。本文原独立HTTP runtime/BFF拓扑已进入迁移，不再并行实现两套内部CRUD。数据与安全语义保留。

版本：1.4 · 2026-09-10 · 状态：技术设计修订，实施进度按技术总稿区分。T3为唯一应用HTTP入口；分支专项尚未实施。

产品范围以 [PRD 1.9](../../FINAL-PRD.md) 为准。本文取代早期 PostgreSQL 首发、默认 fal Director、先写剧情事实再生成画面等假设；不把原型通过或适配器存在视为真实模型闭环通过。

PRD1.9对齐修订：模块边界不变；[功能到技术追踪](PRD-TECH-TRACEABILITY-V1.md)规定页面/API/数据映射及缺口。经历固定设定与绑定，修改开局配置采用新建未开始经历而非隐式PATCH；玩家本轮回应修改只重新报价。AI创作辅助、字幕与原地换模型未获契约支持时不开放正式入口。

## 1. 结论与系统边界

**本地优先、模块化单体、分段生成、单一编排、供应商能力显式分型。**

首发运行：本机 Next.js全栈应用（唯一HTTP入口）＋Prisma/SQLite＋本地素材目录；生成阶段增设内部常驻任务worker，复用应用Service，不另建HTTP runtime或第二网站。用户打开浏览器即可使用；无需先启动 PostgreSQL、Redis 或容器集群。关闭页面不销毁后台任务；关闭本机服务会暂停本机处理，供应商已受理的任务可能继续计费，下次启动先核对，不自动重提。

“本地优先”指设定、存档和素材本机持久化，不指离线生成：模型仍需联网，发送给供应商的提示与参考图必须在使用前明确告知。本机单用户、多窗口是 V1 的并发边界；公网多人平台、跨设备同步、多人同局是后续部署/产品能力，不随 SQLite 安装自动获得。

第一条交付链路：创建设定/人物/图片 → 固定开局版本 → 创建独立经历 → 生成开场 → 检查 → 播放 → 片段结束出现建议/自由表达 → 生成下一段 → 保存退出 → 重启继续。

### 现在确定 / 开工验证 / 暂不做

| 分类 | 内容 |
|---|---|
| 架构基线 | TypeScript、Next/React/T3、SQLite + Prisma、内部任务worker、文件素材、LangChain/LangGraph 单编排 |
| 适配验证 | Prisma ORM 7 候选 patch/驱动、嵌入式 SQLite 版本、官方供应商精确 API/能力、AI SDK 流映射 |
| 后续复用 | Tauri 薄壳、PostgreSQL/S3、原生实时 provider、物体点击 |
| 一期排除 | 微服务、Redis、向量库、开放插件执行、每轮多 Agent、跨设备自动同步、生成中自由打断 |

## 2. 技术选择与运行形态

| 层 | 选择 | 为什么 / 边界 |
|---|---|---|
| 前端 | Next.js + React + TypeScript | 保留当前栈；Web 页面壳与可复用 Player 分开 |
| 界面 | 自有设计 tokens、可访问组件、类型化动态卡片 | 迁移已认可的单舞台交互，不搬回聊天布局；渲染白名单数据，不运行模型代码 |
| API / 内部执行 | Next服务端 + tRPC / Node任务worker | Router调用Service；持久任务不占用长HTTP请求，不另建同义REST CRUD |
| 编排 | LangChain；用 LangGraph 表达有界回合阶段 | 一条模型执行路径；最多有限结构修复，不开放无限工具循环 |
| 交互适配 | AI SDK UI + `@ai-sdk/langchain`，按需接入 | 只适配消息/工具/结构化内容；领域状态与媒体不依附聊天消息数组 |
| 数据 | Prisma ORM 7 候选 + SQLite | 本地免数据库服务；ORM 隔离映射，领域层不暴露 Prisma 类型 |
| 素材 | 本地文件 + SQLite 引用 | 图片/视频不塞数据库；以后实现同一 AssetStore 的对象存储适配 |
| 后台任务 | SQLite Job + Outbox + 租约 | 一个受控调度器先满足恢复需求，不先加独立消息中间件 |
| 桌面 | 后续 Tauri 2 + 静态 React 壳 + runtime sidecar | 复用组件/契约，不直接把整个 Next SSR 打包为桌面依赖 |
| 测试 | Vitest、实际文件 SQLite 集成测试、Playwright | Mock 是故障注入工具，不是模型质量证据 |

**版本卫生（M0-A更新）：** Node22.22.2；Next16.3.4、React19.2.8、TS7.0.2保持原版本并移除latest，Node类型对齐22.19.21。Prisma7.10.0 + better-sqlite3适配已安装，本机SQLite3.53.2/WAL与文件库事务切片通过；LangChain、AI SDK、Tauri仍未安装到正式runtime；Fastify不再是当前HTTP接入计划。完整M0/HTTP/备份未完成，见[真实验证记录](../implementation/M0-A-2026-09-10.md)。

Prisma 官方仓库将 ORM 7 放在 v7 分支继续发布 npm 包，而 Prisma Next 是 Early Access。本项目不为了“下一代”采用未验证的新架构分支，先评估 ORM 7，精确 patch 在 M0 锁定。[官方仓库状态](https://github.com/prisma/orm)

AI SDK 有官方 LangChain 适配入口，但业务的取消、断线恢复、幂等与动态卡片仍需自己的契约测试。[官方适配文档](https://ai-sdk.dev/providers/adapters/langchain)

### 部署切换不是只换一项配置

- **本机 Web（先做）：** Next服务端tRPC直接调用应用Service，经唯一受控DB owner访问Prisma；长任务交给内部worker。开发热更新的连接复用、单实例与worker所有权必须在M0-C实际验证，不靠模块全局变量声称已保证。
- **桌面（后做）：** Tauri 负责窗口、权限、安全存储和 sidecar 生命周期。共享 Player 通过宿主注入 API、素材 URL、导航、认证，不导入 Next Server Actions。
- **托管 Web（后做）：** Vercel 可托管 Web；runtime 放常驻服务与持久卷，或迁移到托管数据库/对象存储。Vercel Functions 的本地文件不作为共享持久 SQLite 真值。这不否定远程 SQLite 兼容服务，但它们是另一个需验证的存储适配。[Vercel 官方说明](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- 远程页面连接本机 runtime 涉及配对、私网访问限制、HTTPS/跨域与安全；一期不采用这个混合形态，也不默认把 localhost 暴露到公网。
- Tauri sidecar 需要按 OS/架构分发可执行文件。Node 和原生 SQLite 驱动也必须随包可运行，不能假定用户机器装了开发环境；M4 以真机打包结果定支持范围。[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)

## 3. 模块与依赖方向

```text
apps/web                       页面壳、创作页、Next/tRPC传输与组合入口
apps/runtime                   内部用例与数据基础；后续供Service/worker复用
  src/application              authoring、experience、turn、asset 用例
  src/domain                   暂不适合共享的纯业务规则
  src/ports                    仓库、素材、凭证、模型、时钟接口
  src/infrastructure           Prisma、文件、供应商、LangGraph 实现
  src/transport                内部诊断CLI；HTTP边界在apps/web/server
  src/worker                   有界调度、查询、恢复、outbox
  prisma                       schema 与 SQLite 迁移
packages/domain                既有纯规则，逐步补经历/事实规则
packages/contracts             版本化请求/响应/事件校验（新增）
packages/ui                    现有 tokens/组件
packages/player                M3 提取共享 Player，不提前建空包
apps/desktop                   M4 薄壳，不在 M0 创建
```

依赖方向：传输/基础设施 → 应用用例 → 领域规则；组合入口注入各 port。前端只用 contracts、UI 与 API client。Provider SDK、Prisma、文件系统和凭证不进前端产物；domain 不反向引用 Web。接口只抽象真实变化点，不造万能 BaseRepository、动态插件容器或十几个空 workspace。

完整 [架构、ER 与时序图册](DIAGRAMS.md)；兼容入口 [diagram.mmd](diagram.mmd) 与系统图源保持一致。

## 4. 业务数据模型与所有权

V1.3数据规范遵守用户基线：禁止数据库外键；保留真实业务唯一，删除伪唯一与冗余唯一。可变根对象采用createdAt/updatedAt/deletedAt，冻结版本、回执、账本另按生命周期处理。

字段、ID、应用层所有者/引用校验、封口、索引、Prisma 与 SQL 的权威细化见 [数据规范](DATA-DESIGN.md)。M0 先建 15 个关系模型，任务/账本/媒体按 M2/M3 独立迁移；提前建立供应商绑定版本与 setup 节点身份，避免空悬引用。

所有新业务主键采用应用 IdFactory 生成的 UUIDv7 小写字符串；时间统一 UTC，API 用 ISO8601；状态通过 schema 校验，禁止数据库外键；关联存在、同域和生命周期由WriteGate应用事务校验，真实业务唯一由索引约束。金额使用整数最小计费单位和 currency，不使用浮点累加。模型参数、卡片 payload、事实内容可为带 schemaVersion 的 JSON，但所有者、状态、关联、版本和检索键列化，不把整份存档塞进一个巨型 JSON。

| 聚合 / 表组 | 关键关系与约束 |
|---|---|
| LocalProfile / CommandReceipt | 一期本机身份；资源有 ownerId；命令回执含 commandId、payloadHash、结果引用与状态，和业务写入同事务 |
| StoryDraft / StoryVersion | draft 可改且有 revision；发布/开局生成不可变版本；修改不覆盖旧经历 |
| CharacterTemplate / CharacterVersion | 模板可改；剧本版本固定人物版本与故事内覆盖，不随模板漂移 |
| Asset / AssetUse | hash、类型、大小、存储键、来源、使用声明；原图/衍生图与各用途分别引用 |
| Experience / Savepoint | 固定 storyVersionId、providerBindingVersion；currentRevision、当前节点/片段、播放位置、恢复状态 |
| ResponseDraft | 经历/回应节点绑定的未发送草稿；独立 draftRevision、更新时间与作者，保存不消费节点、不调用模型 |
| Intent / TurnRun | 用户提交内容与来源节点；幂等键、预期版本；候选提案、graph/prompt/schema 版本 |
| GenerationJob / ProviderOperation | 稳定 operationId、提交状态、供应商 taskId、查询时间、租约、请求摘要与失败类型 |
| MediaSegment / ValidationResult | 实际文件、来源任务、格式/时长、检查结果；生成完成不等于播放或事实成立 |
| InteractionEvent / ActionReceipt | 对应片段/经历版本、2–4 个可行动建议及自由输入入口；已消费节点禁止再次推进 |
| FactCandidate / ConfirmedFact | 候选与确认事实分离；确认必须含来源片段、播放证据、语义检查与版本 |
| BudgetReservation / UsageEntry | 预留、结算、释放、未知费用分别记录；一个 operation 的结算幂等 |
| DomainEvent / Outbox | 提交时生成事件序号；待推送/副作用重投幂等，不把日志当数据库 |

M0唯一约束以 [业务唯一登记表](UNIQUE-KEY-REGISTER.md) 为准；后续候选真实唯一约束：`(ownerId, commandId)`、`(experienceId, eventSequence)`、`(experienceId, interactionEventId)` 的消费回执、`(providerAccountScopeId, providerTaskId)`（仅非空时有效；M2 建立独立的供应商账户/部署作用域，避免换绑定版本绕过唯一性）、`(operationId, ledgerEntryKind)`。用户命令幂等记录须保存 payloadHash；同一 key 不同内容返回冲突，不能返回另一个动作的成功回执。

Experience 另有 rowRevision 作为行级CAS；暂停/归档/调度变更递增它，不改变剧情 revision 或使节点过期。播放进度使用独立 playbackRevision/playbackInstance/序号；普通进度上报不递增剧情 revision，避免把当前回应节点误判过期。接管播放实例使旧窗口的迟到进度失效，合法 seek 不等同于旧包倒退。

跨聚合只经应用用例/事务仓库协调。常用列表按 ownerId/updatedAt，worker 按 status/nextAttemptAt 索引。软删除/归档先停止新的操作，不级联销毁仍用于旧经历的设定或素材；真正清理由引用检查与宽限期控制。

## 5. 分段交互与事实提交

不要用一个巨大的 status 混合玩家、任务、播放三种状态：

- 经历：`preparing → generating → validating → playing → awaiting_input`；另有 paused、needs_attention、ended。
- 供应商操作：`reserved → submitting → accepted → running → succeeded / failed`；提交回执丢失进入 submission_unknown。
- 播放：not_started、playing、paused、completed；是片段的消费进度，不反向改供应商任务。
- 取消：cancel_requested 不等于 cancelled，也不等于退款。只在供应商可确认时结束其责任；离开页面仍继续核对费用。

### 保存离开与暂停准入

`SaveAndPause` 命令原子保存当前回应草稿/已确认播放位置、设置 schedulingPaused 并递增 dispatchEpoch，返回可恢复保存点。worker 在每次新的付费文本/检查/视频操作及素材上传前重新检查 epoch、暂停与预算；退出不撤销已经发生的输入/事实。显式 Resume 只恢复调度资格，仍先核对旧任务，不自动重提。

单 runtime 对每个经历的“开始发出请求”与暂停使用短提交门锁串行化：事务登记 operation/submitting 后、实际开始网络请求前复核准入；门锁仅持有到请求已开始，不等待外部响应，也不持数据库事务等待网络。暂停确认之后不再开始新的生成请求；在临界区先发出的请求按在途处理，UI 明确列出。崩溃落在登记与发送之间仍按未知提交核对。多实例扩展前须重新验证这一保证，租约本身不代表远端请求可撤回。

新增多分支时，经历门锁必须扩展为[scope级串行化](BRANCH-SAVEPOINTS-DESIGN.md#61-scope级派发串行化)：scope → Experience → WriteGate，未知提交落库与同scope最后检查/开始发送互斥，由唯一调度拥有者协调；独立进程里的两个Map不构成保证。原已开始请求仍按在途处理，重启先恢复unknown门禁再开放新调度。

关闭标签页/崩溃不是已确认保存离开：正常退出按钮等服务端回执后再导航；pagehide 仅尽力保存/暂停。调度使用有到期时间的前台续租许可，失联到期后禁止新增付费操作；到期前已发起的调用仍可能收费，UI 不宣称强制关闭浏览器能立即停止费用。具体续租/到期窗口在 M2 故障测试后固定。

回应草稿通过独立幂等 API 持久化，使用 draftRevision CAS；编辑中浏览器保留缓冲，服务端确认才标“已保存”。保存离开必须提交最新草稿；失败留在当前页面。节点变化后旧草稿保留为可手动引用的草稿，不自动发送到新节点。双窗口冲突提供保留副本/重新编辑，不静默覆盖。

### 一个完整回合

1. 正式tRPC命令输入显式携带commandId（历史REST曾用Idempotency-Key）；intent输入携带节点、expectedExperienceRevision、expectedDraftRevision、输入、ControlProof和acceptedQuoteId。服务端验证身份、节点、版本和能力；开场是单独的 StartExperience 用例。
2. 短事务消费有效且动作匹配的Quote与节点、写 Intent/TurnRun、预留回合成本上界、写 outbox。若预算上界未知或能力未验证，拒绝创建付费任务，不先调用再追账。
3. worker 取得租约；在事务外由 LangChain/LangGraph 生成结构化提案，校验玩家身份、规则和预算。记录提案与待执行操作，**此时不写确认事实**。
4. worker 提交已固定参数的官方视频任务；存 taskId；轮询并持久化进度。页签关掉与否不影响任务记录。
5. 成功结果导入本地 AssetStore，验证文件与内容。技术可播放检查和语义检查分开；不确定进入 needs_attention，保留上一画面，重试需要明确额度与动作。
6. 检查通过才开放播放；生成/播放中不显示自由介入。结束前不展示会剧透的下一步选项。
7. 客户端上报播放进度/完成证据；服务端核对片段/版本/执行状态。播放遥测不是用户确实观看或语义真实的密码学证明，不用它计费或授予敏感权限。
8. 整段有效播放完成且语义可确认后，同一短事务幂等归并事实、保存点、可回应节点与领域事件。允许下一回合；有不确定候选时不偷偷当事实。

节点消费后若生成失败，经历进入 needs_attention 并保留原 Intent/TurnRun。用户可显式重试同一回合或保存离开：RetryTurn 绑定原 turnId，复用已受理任务的查询；仅确认需要新付费尝试时新增 attempt/operation 与预算预留，不再次消费旧节点。submission_unknown 仅开放核对/退出；已有可播放结果时只重试本地获取/检查，不重生成。编辑原行动必须显式放弃失败回合并创建新版本节点，不偷偷改写旧 Intent。

语义校验器是需要实测的能力边界，不能仅用导演文本自证画面。Mock 阶段只产生标记为模拟的检查结果；M2/M3 需验证真实视频的抽帧/内容证据与评测流程，未达到 PRD Gate B/C 不开放“自动事实已可靠”声明。

LangGraph 组织有界阶段；应用数据库保存阶段结果与副作用回执。初期从持久阶段边界恢复，纯计算可重跑，已受理外部操作只查询。若接 checkpoint store，需通过独立适配器与相同数据库生命周期验证，不默认 Prisma 自带 LangGraph checkpointer；checkpoint 不是另一套世界真值。[LangGraph 持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)

## 6. SQLite 的可靠性基线

- 一个 runtime 拥有数据库连接和调度租约；所有写入通过短事务，外部网络调用不放事务里。多个窗口通过 API 访问，不各开文件连接。
- 启动配置并读取验证 WAL、schema零外键断言、busy_timeout（首轮候选 5000ms）、synchronous=FULL；连接级选项每条连接都生效，记录实际驱动行为。
- SQLite WAL 允许读写并行，但仍只有一个写者；数据库放本机持久目录，不放网络盘或正在同步的云盘。[SQLite WAL](https://www.sqlite.org/wal.html)
- 检查实际驱动 `sqlite_version()`，要求包含 WAL-reset 修复：3.51.3 或以后，或官方修复回移 3.44.6/3.50.7；不能以系统 sqlite 命令版本代替嵌入版本。具体版本与驱动兼容测试写入 M0 报告。[修复说明](https://www.sqlite.org/wal.html#walresetbug)
- 所有业务写入经WriteGate：Prisma事务内第一条应用语句更新本机身份writeEpoch取得SQLite写权，然后读查关联/去重并写入；任务/导入/GC无旁路。此协议不自动等价于PostgreSQL，迁库须重新验证隔离/锁范围。
- CAS 更新使用 `id + ownerId + revision` 条件并检查影响行数；重复请求/冲突由业务处理，不依赖前端锁保证一致性。
- SQLITE_BUSY 只有限退避重试可重入的本地事务；已发生外部副作用的完整回合不整体重跑。锁等待超限返回可恢复错误和原草稿。
- 监测数据库/WAL/媒体空间、checkpoint 耗时与锁等待；大查询分页，不长时间占读事务。

### 本机参考图到模型的传输

AssetStore 是本地源文件真值，另设 `ProviderAssetTransport.prepare(assetId, binding, operationId)` 负责发送给供应商，返回 RemoteAssetLease（上传回执/远程素材标识、绑定、输入格式、有效期、用途及撤销/清理状态）。本地路径或 localhost URL 不作为供应商可访问的图片地址。

M2 根据官方能力选择：供应商直接上传/内联输入优先；若精确端点只收公网 HTTPS，则另行启用经用户确认的私有临时对象存储和限时读取 URL，不把本机目录公开。远程临时存储是素材传输适配，不替换本地素材真值。无可验证上传路径就保持图片生成准入关闭，不能只验证本地预览便宣称图生视频接通。

上传去重键含 assetHash + bindingVersion + 用途；文件先按模型规则生成衍生图，保留原文件。记录传输回执后提交视频；URL/素材租约覆盖供应商实际取图窗口，过期时只在确定未提交任务前刷新。已有任务则先核对，不通过换 URL 重提视频。任务终态/宽限期后请求清理并记录结果，不能确认删除时如实显示保留状态。素材内容、远程签名 URL 和访问密钥不写普通日志；上传失败不消耗回应节点第二次，网络/存储成本计入本轮预算。

### 文件布局与备份

`APP_DATA_DIR` 指向平台用户数据目录，开发环境显式使用 gitignored 独立目录；数据库、assets、temp、backups 分开。备份默认排除凭证。只读安装目录不是数据目录。

上传先限流/限大小/验证真实格式，写临时文件，再原子移动到不可变存储键，最后事务写 Asset/AssetUse。数据库失败可留下孤儿文件，由宽限期清理；不提前返回成功。文件与 SQLite 不声称跨介质原子事务。

备份用 SQLite 一致性备份接口或经验证的 VACUUM INTO，不直接复制运行中的单个 .db。[SQLite 备份](https://www.sqlite.org/backup.html)

V1 备份短暂进入维护模式：停止新命令/worker 写入和素材 GC，等待活动本地事务/文件提交完成，取得数据库快照；从快照生成素材清单并固定引用，复制不可变文件、校验 hash，写完成标记后恢复。进行中的外部任务在本地仅待核对，不因备份重提。

恢复到新目录，先验证 manifest/schema、数据库完整性、应用引用扫描及文件 hash；**以隔离、无 worker/付费网络的模式启动**。旧备份可能缺少后来已提交的供应商任务，禁止自动重提 reserved/submitting 操作；显式核对后才恢复任务准入。确认旧实例停止后再切换活动目录。至少完成一次真实备份/恢复演练，再称存档可靠。

## 7. 任务恢复、费用与幂等

调度器租约包含 leaseOwner、leaseExpiresAt、递增 fencingToken；每个 Job 更新都检查 token/状态。只有一个有效调度实例，误启动第二个时保持等待或退出。租约防止过期本地写入，不保证供应商网络请求 exactly-once。

| 故障时点 | 恢复动作 |
|---|---|
| 命令响应丢失 | 相同 commandId 查询/重放既有回执，不再消费节点 |
| 提案计算中崩溃 | 从已提交阶段恢复；必要的额外模型调用计入剩余额度 |
| 提交前本地已写 submitting | 即使没有 taskId 也视为待核对，不因重启推断未发送 |
| 请求超时，可能已受理 | submission_unknown；保留预算，优先供应商查询/幂等能力核对，不自动新建 |
| 已有 taskId 后崩溃 | 继续查询同一任务；指数退避 + jitter + 最大频率 |
| 文件已落地但元数据未提交 | 按 operation/内容摘要对账，保留孤儿宽限期 |
| 已有片段但未看完 | 恢复原片段与播放位置，不重复生成 |
| 事实事务后响应丢失 | 按节点消费回执/版本返回既有结果，事实与账本不重复 |
| 取消不受支持 | 停止后续回合，不虚报当前任务已取消；继续费用核对 |

预算先预留后结算；包含规划、有限修复、视频和检查成本。预留、已知支出、未决支出在 UI 分开。每次新付费尝试都有明确 operation 与预算责任；未知费用不自动释放。没有价格版本/成本边界时只能 Mock 或进入另行授权的测试，不打开默认付费入口。

Outbox 至少一次投递；消费者按 eventId 去重。权威状态用事务保证，网络副作用采用可核对、可重入的工作流，不承诺第三方 API 的 exactly-once。

## 8. 供应商与模型契约

自审修订的完整准入见[Provider专项规范](PROVIDER-DESIGN.md)：Definition→Connection（地区/账户作用域）→Deployment→BindingVersion→ExecutionProfileVersion。公开API显式connectionId，内部固定规划/视频/检查各绑定；不能只固定视频而让其他收费阶段漂移。Quote是授权包络，规划后才持久化实际PreparedGeneration并校验未越界。

使用 `ProviderBinding`：providerId、modelId（精确 API 标识）、adapterVersion、capabilityVersion、credentialRef、参数快照、验证状态。文本/视频/后续音频各自绑定，不把 MiniMax 品牌等同于一个万能模型。

视频分两种 port，不让任务接口伪装成实时流：

```ts
// 契约设计草图；具体 DTO 在 M0 经 schema 与测试固定。
type VideoBinding =
  | { mode: 'job'; bindingVersion: string; providerId: string; modelId: string }
  | { mode: 'realtime'; bindingVersion: string; providerId: string; modelId: string };

interface VideoJobProvider {
  submit(request: ValidatedVideoRequest, operationId: string): Promise<SubmitOutcome>;
  query(task: ProviderTaskRef): Promise<JobObservation>;
  // 取消作为独立 capability；未声明支持就不显示“已取消”反馈。
}
```

能力包含支持比例/分辨率/时长、图片用途与数量、连续性输入、原生音频、查询/取消、幂等提交、输出有效期、费用边界。值可为 verified / unsupported / unknown，且注明来源与验证日期。UI 根据已验证能力显示，不猜测。

已有官方 `minimax-jobs.ts` 的请求注入、未知提交分类和校验可迁移；本次已核对官方V2文档中的型号/创建查询路径；地区、参考输入、计费与查询期限差异见专项规范。此处是文档证据，现有适配器仍缺Connection注入/完整用量/期限/执行profile，不是账户实测验收。现有 `LiveVideoProvider`/fal 单独保留为实验，不接入一期路径，不隐式回退。供应商请求失败不允许换供应商后造成另一笔费用。

媒体走文件/视频协议与 Range 请求；SSE/AI SDK 不传视频帧。供应商输出 URL 先按允许域、重定向和大小规则获取，验证后落库，避免临时 URL 过期使存档失效。读取只暴露受控 assetId URL，不暴露磁盘路径或永久外部密钥。

## 9. API、事件与共享 Player

当前应用业务传输采用tRPC；旧 `/api/v1`、[API契约1.0.0](../api/CONTRACT.md)、[OpenAPI](../api/openapi.json)和[接口清单](../api/ENDPOINTS.md)仅作历史业务语义检查，不作为当前客户端生成基准，也不是已经实现的路由。请求与响应都做schema校验，成功`{data, meta:{requestId,replayed,storeEpoch}}`，错误`{error:{code,message,retryable,retryAction,requestId,details}}`。owner来自服务端身份。

| 接口组 | 关键契约 |
|---|---|
| session / commands | 宿主一次性启动材料；同源cookie+CSRF或桌面Bearer；查询已接受命令不重执行 |
| stories / characters / versions / assets | 创建幂等；编辑/删除/恢复使用If-Match；固定版本可复用；墓碑与受权素材读取 |
| provider-models / provider-bindings | 供应商、精确模型、能力与适配版本；unknown候选可保存但不付费准入 |
| experiences / quotes / start / intents | 创建零调用；Quote绑定动作/版本/素材/费用上界，付费命令消费授权与节点 |
| control-lease / playback-instances | 获取/续租/显式接管；控制与播放身份分开，接管不自动Resume |
| response-draft / pause / resume / retry | 草稿独立CAS；原子保存退出；恢复不重提未知任务；新尝试需报价 |
| operations / reconcile | 202仅持久接受，未知提交仅核对；经历删除后仍可核对在途费用 |
| playback / events / experience快照 | 播放独立序号；快照和cursor来自同一读快照；SSE不传视频帧 |

命令键映射HTTP Idempotency-Key；编辑使用强ETag，复杂动作明确区分expectedExperienceRevision / expectedRowRevision / expectedDraftRevision。重放返回历史接受结果，并标replayed；客户端另取当前快照，不能用旧回执回退新状态。所有自动重试保持原键原内容，是否refresh/reconcile由retryAction决定。

事件envelope含eventId、sequence、eventStreamId、schemaVersion、experienceId、type、occurredAt、payload，revision放在对应领域payload中。快照包含lastEventSequence及`eventCursor=eventStreamId:sequence`。备份恢复轮换storeEpoch/流身份并撤销旧session、lease、未接受quote；纯数字序号不足以区分旧备份世代。流身份按经历保存；客户端去重还包含experienceId，不跨经历复用cursor。保留期外重新取快照，不自动创建任务。

Player 只接收快照、媒体源和 actions。服务端回合状态是权威，本地只管音量、悬浮层、焦点、草稿与播放瞬时状态。SSE 断开时保留画面并提示连接，恢复后不新建任务。使用 AI SDK 时通过适配器映射类型化内容，不能再造一份互相覆盖的经历真值。

外部空间保持浅色、故事/角色/图片操作统一；场内一块宽幅舞台占满可用视口，悬浮层可收纳，系统全屏独立切换。片段结束正常出现2–4个上下文建议+自由表达入口；建议失败保留节点/草稿、明确提示并开放有引导的自由回应，不推进剧情；点击建议默认直接提交；只在用户主动修改时展开输入。等待生成显示真实阶段，不伪造实时进度/倒计时；设置不退出经历、不重启任务。

## 10. 安全与本地隐私

- 本机 runtime 绑定 loopback；验证 Host/Origin、请求身份和防跨站写入策略，不使用通配 CORS。非浏览器客户也要鉴权，本机端口不等于可信 caller。
- 开发 Web 通过同源tRPC与服务端会话调用Service；桌面用受限 IPC/配对启动材料与短期会话。密钥不进 URL、localStorage、前端环境变量、日志或公开构建产物。
- CredentialStore 初期接开发环境注入；桌面接系统安全存储，runtime 按需读取。SQLite 只存 credentialRef，不明文备份密钥。托管版的平台凭证与本地 BYOK 是不同模式。
- 素材验证文件签名、像素/字节上限、路径、压缩炸弹和访问权；生成结果抓取防 SSRF/重定向到私网。引用图实际传给模型前验证该 binding 的输入规则。
- 创建设定不自动上传图片；开始前展示会发送哪些素材。日志默认不存原始私密对话或图片；诊断导出可查看、脱敏、手动触发。
- SQLite 文件默认不等于加密数据库。依赖系统账户权限/磁盘保护；应用级库加密及恢复密钥作为另一个 ADR，不写“已端到端加密”。

## 11. 现有工程的迁移裁决

| 现状 | 处理 |
|---|---|
| domain 的故事快照/人物复制规则与测试 | 保留；补 owner、revision、经历/任务对象；去除领域测试对 Web 反向依赖 |
| 3100 localStorage + IndexedDB | 明确版本化导出/导入；不只替换 storage 函数 |
| 3103 独立原型数据 | 另一个来源格式；导入设定和素材，演练节点只作模拟记录，不变成真剧情事实 |
| 官方任务适配器 | 移至 runtime 基础设施，保留错误语义与测试；再接准入/账本/持久任务 |
| 旧 LiveSession 与 fal 依赖 | 隔离实验入口，不作为一期共享 Player 骨架；确认无引用后才删除 |
| 3103 视觉与交互 | 迁入正式 React 组件，保留单舞台/片段结束建议规则，不继续双线维护业务逻辑 |

浏览器跨端口是不同 origin，服务端没有直接读取旧 IndexedDB 的能力。导入包包含 source、schemaVersion、exportId、对象 ID 映射、素材 manifest/文件/hash；先预览再事务导入元数据，重复包幂等，缺图提示修复。先不删除旧数据；浏览器缓存/未发送草稿可留，但正式保存后的真值只在 runtime。

## 12. 未来扩展点与触发条件

| 后续需求 | 现在保留的边界 | 到时新增，不提前实现 |
|---|---|---|
| 换模型/供应商 | Binding 版本、能力表、契约测试 | 新 adapter + 真实评测，不改 Player |
| 原生实时交互 | job/realtime 分型、Intent/事实分层 | 实时传输、打断/取消/计费语义；单独准入 |
| 视频物体/位置点击 | Intent 来源可扩展、片段/版本锚点 | 媒体时刻、对象/区域、归一化坐标、证据与确认；视口坐标不直接当世界坐标 |
| 多类型剧情/恋爱以外玩法 | 版本化规则/角色设定、类型化动作 | 新规则与评测集，不按题材复制整套平台 |
| 回溯/分支经历 | 不可变版本、来源片段与事件关联 | 显式 fork 经历；禁止覆盖已发生记录 |
| 托管多人平台 | ownerId、Auth/AssetStore/Repository ports | 认证/配额/审核/对象存储/运维，不把个人广场当公共发布 |
| PostgreSQL | 明确关系、仓库契约、有限数据库专用逻辑 | 独立 PG 迁移和数据导入校验；不是只换 DATABASE_URL |
| 更高任务并发 | Job/outbox 接口、幂等消费者 | 先测锁等待；持续竞争、多实例需求再迁 DB/队列 |
| 离线创作 DeepAgents | 独立作业类型与预算/权限 | 后台草稿/QA，不进入每个在线回合 |

SQLite → PostgreSQL：先跑两种仓库同一契约测试；生成目标专用迁移；维护窗口停写并备份；导出转换 ID/时间/JSON/状态；校验行数、零外键策略、应用引用与账本总额；对恢复经历做抽查，再切运行配置。旧库留只读备份。新库已有新写入后，回退须处理这些增量，不能直接换回旧文件。Prisma 迁移 SQL 与数据库供应商绑定，迁移历史不能原样跨数据库套用。[Prisma Migrate 限制](https://www.prisma.io/docs/orm/v6/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues)

## 13. 实施切片、验收与评审结论

详见 [开工计划](../superpowers/plans/2026-09-10-local-first-implementation.md)。

| 阶段 | 可验收结果 | 不以什么代替 |
|---|---|---|
| M0 版本与数据基础 | 锁版本、runtime、SQLite 迁移、连接验证、仓库契约、备份恢复 | 写了 schema 不等于持久化完成 |
| M1 本地创作闭环 | 剧本/角色/素材保存、固定版本、独立经历、冲突与原型导入 | 浏览器演示缓存不等于正式库 |
| M2 任务闭环 | Mock 故障注入、预算/幂等/重启；再复核并测试官方任务 | 超时自动重提不算恢复 |
| M3 编排与正式 Player | 单编排、语义检查、Web 两轮生成/观看/回应/保存恢复；满足 Gate B 与 C 的 Web 部分 | 静态轮播不算 AI 生成 |
| M4 桌面与可玩 Alpha | sidecar/系统权限/关闭重开/资源回收真机通过，完成包含双端的完整 Gate C | Web 测试不等于桌面通过 |

工程验收必须覆盖：双窗口并发只消费一次节点；恢复旧备份不自动产生新费用；断网/重启不重复提交已受理任务；未看完不提交后果；过期模型输出不串入新经历；文件缺失可诊断；未决账单保持预留；未知卡片安全降级；键盘/IME/缩放/全屏不破坏输入和播放；构建产物无密钥/服务端 SDK。

候选体验预算（不是当前实测）：本地保存/API P95 ≤300ms（不含媒体复制）；点击即时反馈 ≤100ms；1万条元数据列表分页 P95 ≤300ms。M0/M1 固定机器与样本测量。模型首帧/整段生成延迟、每轮成本、可玩连贯率另按 PRD Gate B 实测，不用前端动画掩盖。

复审另补齐：退出与新请求竞争、未发送草稿正式保存、失败回合恢复、参考图远程传输、Web/桌面分阶段验收。

前次静态评审发现并收敛六项问题：旧实时/PG 假设、domain 缺生产对象、两套浏览器数据、官方适配未入任务链、Player 宿主耦合、依赖版本漂移。首发架构建议按本文推进；**M0-A/B随后已完成内部数据库初始化与剧本根用例；受保护接入、完整代码迁移、模型联调及性能/恢复测试仍是后续工作**。

[前次独立评审与主仓验证记录](REVIEW-2026-09-10.md)；最新设计1.2见[本次设计审查](DESIGN-REVIEW-1.2-2026-09-10.md)。


## 未来关系的当前裁决：分支存档

[专项设计1.0](BRANCH-SAVEPOINTS-DESIGN.md)细化既有显式fork经历方向：不可变Snapshot/稳定Savepoint，新child的fork_base与fresh节点/空稿，明确前缀引用与GC，整棵树共享BudgetScope。普通decision仍要求同经历媒体/播放证据；fork_inherited只允许通过本地fork_base的封闭来源证明，不是放宽任意跨经历引用。

下一正式预算迁移应建立scope基础；分支UI可后置。该设计不改当前M0 schema，正式实施按[技术总稿1.2](TECHNICAL-SOLUTION-V1.md)闸门。
