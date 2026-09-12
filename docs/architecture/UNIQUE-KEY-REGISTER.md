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
