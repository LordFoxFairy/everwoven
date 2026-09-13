# 数据与 CRUD 规范 · V1.3 无外键与来源关系评审稿

> 2026-09-12实际结构更新：单一 `202609120001_authoring_baseline`，16表/13业务唯一/零FK；CharacterTemplate作用域、必填图片元数据及AssetUpload结构已建。旧M0迁移定义已替换，无旧库迁移/旧DTO兼容；原业务数据未删除。M1用例落地进度见[PROGRESS](../PROGRESS.md)，建表不是上传/角色链路完成。

2026-09-10。按用户新要求修订：**禁止数据库外键，保留真实业务唯一、剔除伪唯一和冗余唯一，明确 create/update/delete 及三个生命周期时间字段**。这是本项目约定，不把它宣称为所有大型公司的统一标准。替代 V1.1 的复合外键/触发器设计。

[总体方案](ARCHITECTURE.md) · [逻辑关系与时序图](DIAGRAMS.md) · [Prisma/SQL及验证边界](data/README.md)

## 1. 硬性约束与 Prisma 选择

- 使用 Prisma ORM + SQLite。datasource 设置 `relationMode = "prisma"`。
- 当前 model **只存标量关联 ID，不声明 `@relation` 或关系数组**。无 ORM 级联操作，读写由仓库显式组合；模式设置本身不是完整性保证。
- 迁移 SQL 禁止 `FOREIGN KEY` / `REFERENCES`；不使用跨表触发器暗中模拟外键。本轮同时撤下 V1.1 业务触发器，完整性/封口/生命周期统一经应用用例执行，避免双套逻辑漂移。
- 每表保留主键，额外唯一索引必须有真实业务基数依据。M0保留13项业务唯一，逐项见 [唯一约束登记表](UNIQUE-KEY-REGISTER.md)，不以数量作为优化目标。
- 删除 `(ownerId,id)` 等冗余唯一；版本号、来源修订、人物/素材槽、节点草稿等真实唯一保留。角色名、标题、图片名称、hash不唯一。事务校验负责语义和友好错误，唯一索引提供并发冲突的最终防线。
- 后续费用结算等涉及重复扣费的真实唯一可建立，先写清作用域、调整分录与历史规则。禁止只为调用upsert而给非唯一业务字段加索引。

Prisma 的 relationMode 可以避免物理外键，但关系模拟有范围限制，包括原生 SQL 和创建路径。本项目因此明确选择标量 ID + 应用校验，而不是声称改一行配置就自动安全。[Prisma 官方关系模式](https://docs.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode)

## 2. 命名、ID 和公共字段

Prisma model 单数 PascalCase，字段 camelCase；数据库表使用 plural snake_case，列 snake_case，通过 `@@map/@map` 固定。索引以 `ix_`、明确批准的唯一索引以 `uq_` 命名，不使用名称暗示不存在的外键。

新业务 ID：应用 IdFactory 生成 UUIDv7 小写规范文本，SQLite TEXT / Prisma String @id。供应商 taskId 与展示编号另存；ID不是权限凭证。导入旧数据使用持久化来源映射，不通过截断/拼接强行转换。

### create / update / delete 三个字段

| Prisma 字段 | SQL 字段 | 规则 |
|---|---|---|
| createdAt | created_at | 创建时间，UTC毫秒，创建后不变 |
| updatedAt | updated_at | 最近业务修改时间，创建时等于 createdAt；删除/恢复也更新 |
| deletedAt | deleted_at | 可空；NULL=未删除，有值=逻辑删除；默认读取过滤 |

这三个字段用于可变业务根对象：LocalProfile、StoryDraft、CharacterTemplate、Experience、Asset。不可变版本、命令回执、事件/账本不为了格式整齐伪造 update/delete 语义；其撤销、作废和隐私清理走专门操作。草稿关联表随父草稿显式替换/移除，不单独复制整套软删除字段；冻结关联随版本保留。

其他字段：
- ownerId：服务端取得；不能由请求体的用户ID决定权限。所有关联都检查同一 owner，节点还检查同一 experience。
- revision：普通可变根/回应草稿的 CAS；Experience.revision 特指剧情版本。
- rowRevision：Experience 行级 CAS；暂停、调度、归档不让剧情节点过期。
- schemaVersion：JSON/事件结构版本，和并发版本分开。
- archivedAt：归档是可见性整理，不等于删除；与 deletedAt 含义不同。
- LocalProfile.writeEpoch：内部写门计数，取得数据库写权使用；不是业务修改，不改变 profile 的 updatedAt/revision。该身份行正常操作仅软删除，不物理移除。

时间由 runtime Clock 在仓库明确写入，API ISO8601，SQLite驱动统一 UTC ISO 毫秒存储。当前样本不用 `@updatedAt` 伪装数据库自动更新：它是 Prisma 层行为，原生 SQL 不会自动维护。[Prisma 字段说明](https://www.prisma.io/docs/orm/v6/reference/prisma-schema-reference)

## 3. 无外键与真实唯一约束的并发保证

### WriteGate：先取得写权，再做业务校验

所有改变业务状态的入口（API、worker、导入、清理、恢复后核对）统一通过 `WriteGate.run(ownerId, tx => ...)`，没有旁路仓库写入。

SQLite 下，在同一 Prisma interactive transaction、同一连接中，**第一条应用数据库语句**执行：

```sql
UPDATE local_profiles
SET write_epoch = write_epoch + 1
WHERE id = :owner_id AND deleted_at IS NULL;
```

普通业务要求影响1行。LocalProfile软删除后，恢复身份、旧任务费用核对、已开始GC的完成记录走受控MaintenanceGate：锁同一身份行但不要求deletedAt为空，只接受服务端内部授予的维护许可与操作白名单，客户端不能提交一个maintenance布尔值取得权限；维护路径不开放新生成/新引用。身份墓碑保留到核对结束，不能物理删掉锁定行。随后才读取命令回执、关联对象、占用槽、来源修订或费用。SQLite 一个文件同一时刻只有一个写事务，更新身份行让并发检查进入明确的写序列，不靠进程内 mutex，也不允许事务外先查再写。直接 SQLite 协议测试使用同等的先写后读顺序；实际 Prisma驱动锁行为还须M0证明。[SQLite事务规则](https://www.sqlite.org/lang_transaction.html)

- 任一错误整笔回滚。SQLITE_BUSY 只在没有外部副作用的短事务内有限重试，每次重新取得写权、重读全部判定数据。
- 外部模型调用、文件上传和慢网络不在该事务内。网络操作仍遵循独立的调度门锁/operation/未知提交核对规则。
- 主键或 CommandReceipt唯一冲突不是默认换个 ID 再跑业务；先核对回执/输入摘要。
- 同一业务键读到多条时，返回数据异常并停止该写操作，记录待核对项；不能用 findFirst 静默掩盖脏数据。
- 本机初始化 LocalProfile 是受控初始化操作，以稳定启动身份和主键冲突核对防重复；不先自动创建多份身份再锁门。

**适用边界：** 这是本机 SQLite 单文件写串行化，不是通用分布式锁。迁 PostgreSQL 时必须重新设计 owner/account/resource 锁顺序、事务隔离和幂等唯一例外；多个用户共享供应商账户的费用不能只锁各自 owner。禁止把这里的第一条 UPDATE 当作跨数据库自动等价保证。

数据库直接写入可以制造悬空引用、跨域引用或违反未被声明为唯一的业务规则，这正是去掉约束后的责任变化。需要限制写入口、权限与维护工具，并定期做只读一致性扫描；扫描用于发现问题，不代替写入时的保证。

## 4. Create / Update / Delete 操作契约

### Create

1. 输入 schema 校验，IdFactory/Clock 准备记录；进入 WriteGate。
2. 查询 CommandReceipt：同键同摘要返回原结果；同键异摘要报冲突。
3. 校验 owner、关联对象存在且属于同域、是否已删除/允许引用；视频节点还校验所属经历。
4. 检查业务基数：来源修订是否已冻结、slot是否占用、节点是否已有草稿；同事务内复用或明确冲突。
5. 插入主记录及显式关联、初始化 createdAt/updatedAt/revision，写成功回执并提交。新增/替换/删除草稿人物或素材关联时，同事务递增父StoryDraft.revision并更新updatedAt，避免变化后仍复用旧sourceRevision快照。

不可变剧本版本：首次插入未封口header → 复制人物/素材引用 → 计算hash并封口；这整个用例在WriteGate事务内。已有封口版本直接复用，不再次复制子引用。仓库不暴露普通版本更新接口。

### Update

1. WriteGate内检查权限、未删除状态、关联/用途、当前可编辑节点及回执。
2. 仅更新白名单字段；id、ownerId、createdAt与固定经历起点禁止修改。
3. `WHERE id + ownerId + expectedRevision + deletedAt IS NULL` 做CAS，要求影响1行；Experience用rowRevision做行CAS，动作另核对剧情revision。
4. 更新updatedAt、递增相应版本，关联修改与父对象版本在同事务提交。冲突保留草稿，避免 last-write-wins。

### Delete / Restore / Purge

- 对用户的普通 Delete = 逻辑删除：WriteGate内核对版本、在途状态、依赖范围；写deletedAt/updatedAt并递增CAS版本，保存回执。已删除的同命令重放不重复执行。
- 不设置级联删除。删除剧本/人物模板只从工作列表隐藏，不销毁冻结版本/旧经历；删除经历先禁止新增调度，已受理任务继续核对，未决费用不释放。
- 素材逻辑删除后禁止新引用；既有合法版本/经历仍可读取被引用的文件，防止删除素材库条目使旧存档失效。默认资产列表过滤删除状态，历史读取是单独授权用例。
- Restore 是显式命令，按版本重新检查当前槽/同名业务规则，清空deletedAt；Asset处于deleting或purged时一律不接受普通Restore，即使文件暂时还存在；先确认GC状态，不以“文件存在”判断可恢复。若未来支持取消GC，必须另建带令牌/确认的协议。Restore不自动恢复生成任务。
- Purge只在无活跃/历史引用、无未决操作、无备份pin且过宽限期时进行。WriteGate内检查并把Asset置为deleting；所有新引用必须检查status=ready。释放事务后才删文件，成功后单独事务记录purged；崩溃由清理任务恢复。不得“检查无引用后放锁，仍允许新引用，再删除文件”。
- 隐私清理另有受控操作，明确受影响版本/经历和审计最小化；不冒充普通Delete已删除供应商端所有副本。

## 5. 15个 M0 模型与完整性归属

ER连线仅代表逻辑关系，数据库没有FK。当前Prisma保留ID列、实际业务唯一和查询索引，不定义外键。

| 模型组 | 应用事务必须保证 |
|---|---|
| LocalProfile | 初始化身份稳定；内部writeEpoch与用户资料版本分离 |
| CommandReceipt | owner+commandId唯一例外；payloadHash含命令类型/目标/有效载荷；回执与业务同事务 |
| StoryDraft / StoryVersion | 同来源修订只冻结一次，版本号分配串行；封口正文/关联不变 |
| CharacterTemplate / CharacterVersion | 人物快照来源明确，模板删除/编辑不改旧版本；头像同所有者 |
| StoryDraftCast / StoryVersionCast | 同父对象slot只一条；人物版本同域；冻结后不追加/修改 |
| StoryDraftAsset / StoryVersionAsset | 同域素材及用途；同slot一条；删除/GC与新增引用共用WriteGate |
| Asset | storageKey由owner/id派生，文件排他创建/核对hash，禁止覆盖既有不同文件；新引用仅ready且未删除 |
| ProviderBindingVersion | 同bindingKey/versionNo只一条；凭证只存引用，版本不可变 |
| Experience | 固定同域已封口设定/绑定；M0仅preparing/paused，不生成 |
| InteractionEvent | M0仅setup身份且空options；M2真实decision节点须有同经历媒体证据 |
| ResponseDraft | 每个节点一份，同owner同experience；独立CAS，消费节点后拒绝迟到保存 |

SQL只检查登记的唯一/主键与列结构，不检查跨表存在性、归属和生命周期，因此“SQL建表成功”不等于完整性功能完成。读取也要按owner过滤；普通索引只加速检查，不防重复。

## 6. 真实唯一 / 伪唯一 / 冗余唯一

详见 [13项唯一约束登记表](UNIQUE-KEY-REGISTER.md)。保留真实基数约束；不把角色名、标题、文件hash等正常可重复值定义为唯一；删除主键已经覆盖的冗余组合。所有者、归档/删除、引用范围仍由WriteGate校验。

不存在“为了遵守少唯一规范而把所有正确性搬到应用”的目标。数据库唯一处理同一业务键竞争，应用事务处理完整性与生命周期，两者分工明确。

## 7. 后续SQL与迁移规划

新增关系需求：[分支存档与时间线分叉](../product/BRANCH-SAVEPOINTS-PROPOSAL.md)。与既有显式fork经历一致：M2/M3的片段、回合、互动节点和Savepoint应保留不可变来源链；fork来源、进度与共享媒体生命周期需独立评审。此处不修改M0迁移，也不把父节点/来源存档点加唯一约束。

M0只建15个地基模型。M2/M3增加 Intent、TurnRun、ProviderOperation、Job、RemoteAssetLease、MediaSegment、ValidationResult、PlaybackReceipt、Fact、Savepoint、Budget/Usage、DomainEvent/Outbox；仍禁止外键。

所有对象关联保留明确ID列与反向查询索引。金额BigInt微单位+currency、事件sequence与账本写入同事务；回合/节点/操作/结算去重逐项进入WriteGate与唯一例外评审。未来共享供应商账户的操作命名空间独立于易变model binding版本。未解决并发作用域前，不开放多人共享余额/任务写入。

普通索引对应实际查询：owner+deletedAt+archivedAt+updatedAt+id列表、父对象+slot、来源修订、素材反向引用、任务status+nextAttemptAt、经历+sequence。只建有查询需求的索引；使用EXPLAIN检验，不把所有字段都索引化。

历史V1.1样本移入archive。当前没有正式用户SQLite库，不对旧用户数据执行迁移；未来若已有带FK的正式库，应备份、数据核查、生成移除FK的表重建迁移、演练再部署。禁止只关 `PRAGMA foreign_keys` 冒充schema已经无外键，也不以db push/reset替代用户数据迁移。

验收分三层：
1. **结构**：Prisma validate/diff；所有表foreign_key_list为空；除PK外唯一索引与13项业务登记一致；无引用触发器。
2. **应用协议**：创建跨域引用被用例拒绝；并发同slot/同来源只一条；CAS、删除与新增引用竞争、同键异载荷、回滚与重复删除。
3. **正式实现**：真实Prisma驱动/连接事务与这些协议一致，导入/worker/GC无旁路，恢复与预算测试通过。

本轮协议测试不是正式Prisma仓库实现，旧24项外键/触发器测试不再作为当前方案验收依据。


## 8. API1.0对数据实施的补充（不冒充已建表）

对外DTO和内部表不同名字段通过mapper转换：Experience.revision为剧情版本，rowRevision用于ETag；ResponseDraft.revision映射draftRevision；BigInt金额/序号映射十进制字符串。完整映射与HTTP前置条件见[API契约](../api/CONTRACT.md)。现有15模型评审样本不包含下列M2/M3完整结构。

| 阶段 | 新增/完善的持久状态 | 约束与用途 |
|---|---|---|
| M0宿主元数据 | storeEpoch、恢复启动标记（受控宿主文件，不是业务表） | 不从旧备份覆盖当前宿主身份；恢复时先隔离，原子写入新世代并持久化，失败禁止开放API/worker；正常重启保留同世代 |
| M2 Quote | owner、storeEpoch、经历/节点/revision、actionHash、绑定/价格版本、素材/参数摘要、maxCost、currency、expiresAt、acceptedTurnId | 原子消费一次、不可篡改报价；过期仅限制新接受，已接受回合复制固定授权到TurnRun |
| M2 ControlLease | experienceId、leaseId、epoch、clientInstanceId、expiresAt、宿主密钥版本引用 | 只保留身份/到期信息，不存明文controlToken；WriteGate串行取得/续租/接管；不等于付费回合授权 |
| M2 Experience事件流 | eventStreamId、lastEventSequence | 每个经历持久流身份；旧备份恢复隔离阶段轮换、未接受报价失效，首次M1初始快照也分配稳定流身份 |
| M3 PlaybackInstance/Receipt | segmentId、当前实例、controlEpoch、sequence、payloadHash、positionMs、playbackRevision、ACK结果引用 | 同实例同序幂等、同序异载荷冲突；新实例使旧实例失效；进度与剧情版本独立 |

宿主storeEpoch恢复流程：先写持久恢复标记并关闭普通入口 → 隔离验证备份 → 轮换宿主世代并在恢复库中轮换流身份/废止许可 → 校验元数据一致 → 清除恢复标记再开放只读与核对。崩溃后见标记必须继续隔离修复，不能把文件与数据库跨介质操作描述为单一ACID事务。

Quote、租约、事件流字段与草稿初始化必须随正式迁移和mapper测试落地。新增真实唯一候选如“一个Quote至多接受到一个Turn”、`(playbackInstanceId,sequence)`、`(experienceId,sequence)`需登记业务依据；不是简单复制目前13项登记，也不预先建全部远期表。DTO初始零账本是没有发生操作，不是模型价格为零。

CommandReceipt保留payloadHash/结果引用，历史接受结果与当前GET快照分开；control-lease秘密从宿主受保护密钥按lease身份派生、限同客户端和有效世代重取，不把秘密塞进result JSON。M0须测试普通回执重放，M2补控制秘密过期与接管例外。


## 9. 自审修订2：初始预算与Provider数据边界

- 审核Experience新增`budgetLimitMicros BigInt`/`budgetCurrency String`两个必填标量，创建时保存客户端确认的上限，应用校验非负/64位范围/币种；没有用DEFAULT假装保存。M1即持久存在，M2的预留/用量记录引用经历limit真值；后续真要迁移成预算聚合必须复制原值并校验，不重置额度。
- 仍为15模型、13项真实唯一、零外键/触发器。新增第24个数据样本验证另开数据库连接后预算上限/币种原值保持；不是正式API写入测试。
- Connection是受控宿主登记，不是客户端随意创建的任意端点。M0/M1 Binding的parameters JSON采用版本化结构保存connectionId、region、endpointProfileId、providerAccountScopeId及有效参数快照；credentialRef只引用秘密。所有ID明确是宿主登记或业务对象，不宣称M0已有Connection表。
- M2持久化ExecutionProfileVersion（或等价不可变配置快照库，实施前固定唯一存储）及TurnRun对它的引用；Quote与已接受回合不读取可变默认配置。规定首选为独立ExecutionProfileVersion表，JSON记录角色绑定与版本，禁止外键，来源绑定由WriteGate校验。
- M2/M3 Experience.recoveryTarget由当前恢复回合关联与TurnRun/Operation状态投影。当前turn身份必须持久化，即使operation已终态也保留；不从临时前端/SSE回放猜测。
- ProviderOperation增加账户scope、operationKind、request/schema/profile版本、PreparedGeneration语义摘要、queryUntil/核对次数/保留期过期状态和完整计量证据。详见[Provider规范](PROVIDER-DESIGN.md)。


## 10. PRD1.9页面映射与数据变更判断

[完整追踪矩阵](PRD-TECH-TRACEABILITY-V1.md)。P01/P02的Story对应StoryDraft及其版本/人物/素材关联，P03的Character对应CharacterTemplate/Version；产品字段“兴趣/习惯”进入已有description，不新增无消费者列。P04上传产生Asset，绑定到编辑对象是另一次有CAS的写入，失败不覆盖旧引用；迟到上传不能串目标。

P05的StoryVersion、ProviderBindingVersion和初始budgetLimit由CreateExperience固定；当前API没有修改这些值的命令。更改开局配置创建新零调用经历，旧经历不变；恢复/继续不重新创建。报价缓存不是新世界状态，浮层/全屏不改剧情revision。生成候选、确认事实、恢复回合按M2/M3计划持久化，不混入模板全局记忆。

本轮不改M0 schema/DDL，不加外键、伪唯一或通用扩展JSON列。新增Provider证据差异进入能力登记/版本与准入流程，不把PDF描述直接写成每个经历的已支持事实。Quote/Profile/任务/费用正式表仍按阶段迁移并验证。


## 9. 分支存档数据裁决（待M2/M3迁移）

权威细化见[分支设计§2–6](BRANCH-SAVEPOINTS-DESIGN.md)。当前15表/13项真实唯一不变，不将候选索引冒充已应用SQL。

- Experience是一条路线的进度所有者；rootExperienceId组织同根树，sourceExperienceId/sourceSavepointId创建后不可变。不要再建重复持有相同状态的Branch表。
- 稳定played_segment Savepoint＋StateSnapshot不可变；child fork_base明确继承证据，新decision/空稿属于child。普通setup、生成中恢复目标不能伪装成可分叉点。
- MediaSegment上一幕由输入Savepoint/TurnRun来源链确定，后继由反向查询得到，不维护易分叉失真的单个nextId。
- Snapshot/媒体共享必须保留child持久引用与可访问前缀边界。删除源经历不级联破坏存活child，也不开放源未来内容。
- BudgetScope在首个正式预算/账本迁移中建立；Experience预算是本分支新增费用子限额。Usage/Reservation只有一份，含scope/experience双重归属；接收Quote原子检查两级，不复制父分支余额。
- 普通索引/候选真实唯一见专项§3.1；尤其禁止parent/sourceSavepoint做唯一。新增DDL、schema与真实SQLite故障测试通过后才进入登记表的“已应用”部分。

### M1-C1c-2：asset begin共享创建身份

仅asset begin在同事务使用同一服务端UUIDv7作为AssetUpload.id与CommandReceipt.id，重放以receipt.id核对对应意图，禁止仅凭response.id自证。complete以及其它业务回执仍独立ID。两表PK与owner/command真唯一未变，无FK/新增unique；应用维护关系而非ORM关联。M1保留意图与回执，未来归档需一起评审重放期限，见[ADR0010](adr/0010-asset-begin-identity.md)。

## M1 维护查询索引

当前单一fresh baseline新增普通索引`ix_asset_uploads_asset(asset_id)`，用于跨意图的资产身份/别名保护查询；真实SQLite EXPLAIN由SCAN变SEARCH。分页仍用现有owner/createdAt/id索引，tuple keyset支持相同时间戳。没有新增业务唯一、外键或触发器；16表/13业务真唯一不变。schema、迁移、生成DDL和已审结构指纹同步，不迁移用户旧库。

## 2026-09-13实施补记：M2-A封存原语

StoryVersion/StoryVersionCast/StoryVersionAsset已增加内部单事务封存实现，使用既有DDL而非迁移用户数据库。首次未封口header→引用→封口CAS→回读，复用校验内容hash与源修订，封口后的孩子追加在存储端口拒绝；完整[内部契约与时序](../api/STORY-VERSION-SEAL-M2-A.md)。这尚不是CreateExperience公开命令或任务链，具体测试/质量状态见PROGRESS，不改变后续绑定、Quote与预算责任设计。


## M2-A2实施补记 · 2026-09-13

沿现有SQLite schema实现内部CreateExperience/getPreparing，不新增Connection表或FK，不改baseline、不清用户库。Binding.parameters严格固定身份/部署/参数，capability有界快照在本片不是执行许可；BudgetLimitMicros以规范字符串入站、BigInt持久化、固定币种，零调用不授权支出。新建StoryVersion/BindingVersion/Experience/InteractionEvent(setup)/ResponseDraft和CommandReceipt同一WriteGate原子提交，回执ID共享Experience的服务端ID。既有版本按真实唯一复用，不按标题/内容做伪唯一。回放通过真实经历固定引用/预算及封存/绑定摘要核对原确认，优先于当前source/registry；历史确认与getPreparing明确分开。详见[内部契约与时序](../api/EXPERIENCE-OPENING-M2-A.md)。原页面/公开tRPC/费用Quote/后台视频任务链尚待接入，不作整体完成声明。
