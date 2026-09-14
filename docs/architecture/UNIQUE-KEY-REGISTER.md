# 唯一约束登记表 · V1.2

2026-09-10 · 按用户澄清：**保留真实业务唯一，禁止伪唯一、删除冗余唯一；不追求唯一键数量越少越好。外键仍然禁止。**

判断顺序：先问“业务是否允许同时存在两条”；再确定范围、NULL、历史、删除/恢复规则；最后才决定索引。不能因为 Prisma upsert/findUnique 用起来方便就添加唯一键。

2026-09-12新基线：增加AssetUpload操作意图表，保留13项业务唯一，主键共16个；scope/名字/输入或输出hash/原文件名不增加unique。begin回执负责同命令不重复预留，AssetUpload.id是操作身份，不额外给assetId堆叠伪唯一。

## 当前13项真实业务唯一（不含16个主键）

| 表/键 | 唯一性理由 | 重复时行为 / 删除后规则 |
|---|---|---|
| CommandReceipt(ownerId,commandId) | 同用户一个命令键只代表一次已接受操作 | 同摘要返回原回执；异摘要冲突。保留去重墓碑，不因对象删除重跑 |
| StoryVersion(storyDraftId,versionNo) | 同剧本一个发布编号只能对应一个快照 | 冲突核对/重新分配；历史永久占号，不复用 |
| StoryVersion(storyDraftId,sourceRevision) | 当前策略：同来源修订只冻结一次 | 复用原版本；如未来支持同修订不同生成参数，须先改业务键/策略 |
| CharacterVersion(characterTemplateId,versionNo) | 同人物模板一个发布编号一个快照 | 同上，历史不复用 |
| CharacterVersion(characterTemplateId,sourceRevision) | 同人物修订复用同一个快照 | 不因创建多份经历重复发布 |
| StoryDraftCast(storyDraftId,slotKey) | 一个演员配置槽只能指向一个人物版本 | 同一人物可放多个不同槽；显式移除草稿槽后可重建 |
| StoryVersionCast(storyVersionId,slotKey) | 冻结版本的一个演员槽只有一份记录 | 随版本保留，不允许覆盖/重复插入 |
| StoryDraftAsset(storyDraftId,slotKey) | 一个素材槽只有一个当前引用 | purpose可重复；多张参考图使用不同槽；移除槽后可重建 |
| StoryVersionAsset(storyVersionId,slotKey) | 冻结版本素材槽对应固定引用 | 历史保留，不覆盖 |
| ProviderBindingVersion(ownerId,bindingKey,versionNo) | 同用户的同一绑定版本号固定 | 同model可有多个不同bindingKey；旧版本号不复用 |
| InteractionEvent(experienceId,experienceRevision) | 当前模型：同一剧情修订至多一个可回应节点 | 多张建议卡在同一节点内；通用领域事件另表，不受此规则约束 |
| ResponseDraft(ownerId,interactionEventId) | 同用户同节点一份当前未发送草稿 | 更新原行；旧节点草稿保留；新分支使用新nodeId |
| Asset(storageKey) | 当前一份资产元数据拥有一个不可变物理存储键 | 名称/hash可重复；若未来共享物理blob，改成Blob与Asset分层，不能悄悄取消保证 |

versionNo 和 sourceRevision 是两种不同的防线：发布编号与来源修订不必数值相同。parent ID已全局唯一，版本/槽键不再重复拼 ownerId；应用仍独立校验 owner 权限。所有这些业务键字段当前非空，唯一性不依赖SQLite的NULL特殊行为。

## 明确不做唯一的字段

角色名、剧本标题、图片名称、文件内容hash、模型名称、创建时间、ownerId、purpose、显示排序值。复制故事/同名人物/同图不同用途都允许。不能用“样本里没有重复”推断真实业务唯一。

## 删除的冗余键

`(ownerId,id)`：id已是主键，无物理外键引用需求；删除。
`(ownerId,experienceId,id)`：节点id已是主键；删除。
只为 ORM 关系导航构造的唯一键：当前没有@relation，全部删除。

## 后续新增与变更

每个新唯一键必须回答：业务实体、作用域、允许重复的反例、NULL语义、软删除/恢复、历史保留、冲突处理，以及跨租户/数据库迁移影响。任务/费用去重若真实业务唯一可以建立，不因“少索引”牺牲正确性；涉及账单调整则区分首次结算与有独立adjustmentId的后续调整。

数据已存在时，先报告重复样本与业务裁决，禁止随意删除重复数据来让建索引成功。上线迁移须验证存量与回退范围。

## M2-B1增量 · ExecutionProfileVersion

新增 `ExecutionProfileVersion(ownerId,profileKey,versionNo)`，索引名`uq_execution_profiles_version`：同用户给定配置key的一个版本只能定义一份固定执行身份，三个阶段绑定、prompt/graph/schema或限额任一变化须新版本。同内容复用；同版本漂移冲突。字段均非空，历史无删除/占号复用；不同owner或不同key可以存同模型/同内容hash，hash不唯一。dataset由宿主隔离、应用摘要绑定，跨库导入不能只复制引用。累计**14个真实业务唯一、17个主键**；上方13/16为authoring基线历史，不再代表新增后的总数。没有外键。

## 分段生成主链增量（2026-09-14）

`GenerationTurn(quoteId)` / `uq_generation_turn_quote`：同一已接受报价仅产生一个回合。quoteId 非空，回合失败或结果未知后仍保留历史占号，不能通过软删除重试收费；新收费必须是新的报价确认。不同报价可以引用同一父节点，故 parentTurnId **不是唯一键**。累计 22 个主键、15 个真实业务唯一，所有表零 FK。

BudgetReservation.id 和 RuntimeOutbox.id 分别复用本次 turnId，表示本轮唯一预算占用与可反复唤醒的一条执行记录；没有额外叠加 `(ownerId,id)` 等冗余唯一。未来若支持多个并行工作项，应另立工作项身份，不能无声改变当前一对一含义。

## 文字用量观察增量（2026-09-14）

`TextUsageObservation(turnId,stage)` / `uq_text_usage_turn_stage`：当前执行图在一个回合的planner或validator阶段仅允许一次付费调用（封存maxCalls=1），所以各阶段最多一份首次响应观察。turnId为全局UUID、stage非空，所有者/数据集/存储代次由应用校验。相同观察重放；不同响应或用量报冲突，禁止覆盖。不同回合、不同阶段或不同供应商账户可以有相同responseId和用量，所以responseId、bindingHash、contentHash均不唯一。记录不可修改/软删除，不复用占号；后续供应商费用更正采用独立调整分录，不把此首次观察表扩成可覆盖账本。跨库导入必须重建所有权/代次，不直接复制引用。

累计23个主键、16个真实业务唯一，零FK。新增普通索引`(ownerId,createdAt,id)`用于所有者范围的核账读取；不叠加冗余`(ownerId,id)`唯一。

## 合格播放存档增量（2026-09-14）

`Savepoint(sourceTurnId)` / `uq_savepoint_played_turn`：一个已接受并完整播放的回合至多生成一个正式played_segment节点。sourceTurnId非空、全局UUID；节点不可变、不软删除、不重复占号。重复complete命令重放回执，事务冲突回滚，禁止覆盖旧快照。不同回合可有同内容或同媒体hash；同回合允许多次PlaybackSession（重播、断线），因此turnId在播放会话表不唯一。parentSavepointId允许多个子节点，StateSnapshot.contentHash也不唯一。跨库迁移须重建所有者/数据集关系，不能仅复制引用。

累计26个主键、17个真实业务唯一、零FK。当前Savepoint仅实现played_segment；未来fork_base须明确新的来源/可空语义，不能伪造新分支已经播放了原回合。

## 独立路线增量（2026-09-14，当前总数）

累计 **28主键、18真实业务唯一、零FK**。`ExperienceSceneRef(experienceId,savepointId)` / `uq_experience_scene_ref`：同一子路线对同一已确认点仅保留一条授权引用，字段均非空，不软删除复用。不同child可以引用同一源点，相同child可引用多个不同点；owner/dataset由应用检查，引用随存活路线保留。

ExperienceFork.id即child身份，一份child只有一个不可变来源，以主键表达，不再增加sourceSavepointId或rootExperienceId伪唯一。许多child可以来自同一源点和根。Savepoint.sourceTurnId现可空，仅fork_base为空；NULL不约束基点数量，基点身份由origin和原子初始化确定。普通played_segment仍需真实sourceTurn/playback证据并保持一回合一存档约束。

## 分幕费用证据增量（2026-09-14，最新总数）

累计 **29主键、19业务唯一、零FK**。`StageCostEvidence(turnId,stage)` / `uq_stage_cost_turn_stage`：当前固定图每阶段最多一次付费调用，一个已接受回合的某阶段只有一份不可变首次费用证据。字段非空、不软删除或复用占号；异证据冲突拒绝，后续更正须独立追加分录。不同回合可以同responseId/内容/金额，故这些字段不唯一。owner/dataset/storeEpoch在应用内校验，不以冗余唯一或外键表达。整回合首次结算使用现有BudgetReservation主键身份和状态转换，未堆叠另一份同义账本。
