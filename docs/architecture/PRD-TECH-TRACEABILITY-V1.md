# PRD 1.9 → 技术方案与接口追踪

2026-09-10 · 技术交付1.2 · 状态：设计对齐评审稿，非实现验收。主范围见[PRD](../../FINAL-PRD.md)，交互见[页面细则](../product/PAGE-SPEC-V1.md)，测试见[AC01–34](../product/ACCEPTANCE-V1.md)。

## 1. 本轮裁决

采用**增量对齐既有架构**，不为PRD改版重建一套API，也不把页面状态直接变成数据库表。

- 采用TS/Next/T3单HTTP入口、内部Service/worker、SQLite/Prisma、标量关联无外键、真实唯一、单一LangChain/LangGraph执行链。
- 前端依据经历快照和允许动作展示界面；不以聊天消息数组作为游戏状态，不把动态UI协议当调度引擎。
- 现有47项操作是待实现契约，不因本轮补映射就改为已上线。本轮不增路由、表或付费模型调用。
- 业务范围冻结与视觉评审分开：可准备M0地基；P05–P07原型仍需按页面规格设计与Gate A测试，不把技术评审当视觉通过。

## 2. 功能 → 页面 → 模块 → API → 数据 → 验收

下表API列保留历史OpenAPI的精确`operationId`作为语义映射，不代表REST为新实现目标；正式tRPC名称与Zod逐切片冻结。数据列是领域/持久对象，不保证当前M0已建全表。名称映射：Story DTO对应StoryDraft，Character DTO对应CharacterTemplate；不可变版本另存。

| 功能与页面 | 负责模块 | API操作 | 数据与关键约束 | 验收 / 阶段 |
|---|---|---|---|---|
| F01 · P01/P02 我的内容 | Authoring / Repository | `listStories`、`createStory`、`getStory`、`updateStory`、`deleteStory`、`restoreStory`、`getCommand` | StoryDraft及人物/素材槽；owner、ETag/CAS、命令回执；同名允许 | AC01–04 / M1 |
| F02 · P02/P05 创建与开始 | Authoring / Experience / Admission | `freezeStory`、`getStoryVersion`、`createExperience`、`changeControlLease`、`quoteAction`、`startExperience` | 固定StoryVersion/Binding；经历初始预算；Quote/lease/Turn在M2落实；创建零调用 | AC05–08 / M1–M2；AI整理另见缺口 |
| F03 · P03 角色 | Authoring / CharacterRepository | `listCharacters`、`createCharacter`、`getCharacter`、`updateCharacter`、`deleteCharacter`、`restoreCharacter`、`freezeCharacter`、`getCharacterVersion` | CharacterTemplate/Version、局内cast overrides；角色模板不共享经历记忆 | AC09–10 / M1 |
| F04 · P04/P05 图片 | AssetStore / AssetTransport / CapabilityPolicy | `listAssets`、`uploadAsset`、`getAsset`、`readAsset`、`deleteAsset`、`restoreAsset`；关联更新用`updateStory`/`updateCharacter` | 原图/衍生图不可变、引用分层、真实解码、延迟结果版本校验；外传只按报价用途 | AC11–14 / M1–M2 |
| F05 · P06 单舞台 | Player / Playback / MediaValidation | `getExperience`、`createPlaybackInstance`、`reportPlayback`、`readAsset`、`streamExperienceEvents` | MediaSegment/检查证据、播放实例与序号；UI浮层状态不改变剧情revision | AC15–18 / M3，M4双端 |
| F06 · P06 回应 | Interaction / Graph / FactMerge | `saveResponseDraft`、`quoteAction`、`submitIntent`、`retrySuggestions` | 节点一次消费、草稿独立CAS、Turn候选与确认事实分开；本地建议恢复不新调模型 | AC19–23 / M3 |
| F07 · P01/P06/P07 继续 | Experience / Control / Recovery | `listExperiences`、`getExperience`、`saveAndPause`、`resumeExperience`、`changeControlLease`、`createExperience`、`deleteExperience`、`restoreExperience` | 保存点/草稿/媒体/固定版本/当前恢复回合；重新开始独立；暂停与外部任务终态分开 | AC24–28 / M1–M3，M4双端 |
| F08 · P05/P06/P07 异常费用 | Budget / Provider / Recovery | `listProviderModels`、`listProviderBindings`、`createProviderBinding`、`getOperation`、`reconcileOperation`、`retryTurn`、`quoteAction`、`saveAndPause` | Connection/Binding/Profile、Quote/Operation/预留/用量；未知提交不重提；费用与业务状态独立 | AC29–34 / M2–M3 |

公共身份入口为`exchangeSession`与`getSession`（M0），跨上述8组功能使用；加上表内45项业务操作，共覆盖当前47项契约。所有操作共享身份与所有者范围；浏览器隐藏按钮不是权限验证。关联完整性由WriteGate事务实现，媒体文件与SQL没有跨介质ACID承诺；回收/备份要有可恢复协议。

## 3. 页面调用与本地状态边界

| 页面 | 服务端读写 | 仅本地交互 | 禁止混淆 |
|---|---|---|---|
| P01 | 读取真实草稿/经历/回收站 | 筛选、视图布局 | 草稿不叫已玩经历；演示不计真实记录 |
| P02 | 保存、角色槽/图片槽、冻结版本 | 编辑缓冲、逐步展开 | AI整理在契约就绪前禁用；保存不收费 |
| P03 | 保存/冻结角色版本后引用 | 未提交编辑、返回来源 | 修改模板不改旧局、跨页异步结果不串角色 |
| P04 | 图片上传及关联更新是两步 | 上传预览、用途确认 | 上传成功不等于引用保存成功；引用失败仍保留原引用 |
| P05 | 冻结设定→创建零调用经历→取得控制→确定性报价→确认开始 | 费用/素材说明的展开 | 报价不是生成；经历已创建不等于已经开始 |
| P06 | 快照+事件、播放证据、草稿、动作报价/提交 | 全屏、浮层、显示适配 | video ended不是事实事务；设置不创建任务 |
| P07 | 保存暂停回执、任务核对、允许的恢复 | 留存错误与未发输入 | 关闭页面不是远端任务取消；未知结果不是失败重试 |

### 3.1 开始确认的不可变对象约束

1. P02保存成功并冻结所选角色/剧本版本后，P05用所选Binding与明确初始预算创建Experience。仅展示确认层不付费，报价也不调用模型。
2. 当前契约没有修改Experience的StoryVersion/Binding/预算的PATCH。P05返回修改起点、外传素材、供应商、画幅绑定或预算时，旧经历引用保持原值，必须显式准备新的零调用经历，重新报价；同一未变配置的网络重试复用原命令与经历。
3. 旧的未开始经历保留“待开始”身份，可由用户明确暂停后删除，不自动清空。UI不得用新经历结果覆盖旧ID，不凭本地标记跳过服务端旧报价/版本核验。
4. 已开始经历一期不提供原地换模型/改世界设定/追加预算；采用现有保存后另开新经历路径。未来原地切换需独立命令、版本与费用评审，不把“重新报价”当作修改绑定API。
5. 报价过期但配置未变，只需同经历重新报价；玩家修改回应只重报动作，不重新创建经历。候选规划超出授权包络先阻断，恢复只能采用原绑定/素材/预算允许的请求；扩展包络能力不由客户端自行构造。

### 3.2 情境建议的一击回应

节点到达后，客户端可为当前2–4项建议请求确定性报价，显示准确上界；无需后台预生成对应视频，也不预留多份费用。只提交用户选中的有效报价，服务端在接受时预留并消费一次。报价过期/状态变化即失效，不持续循环刷新。

自由编辑不每键请求报价；明确准备提交时为当前文本报价并确认。建议改写按free处理。未就绪时显示“确认费用/准备中”，不把点击选项改成意外付费或自动打开聊天框。前端允许动作是提示，提交仍验证节点、版本、控制权和预算。

## 4. 生成质量与运行职责

| 阶段 | 技术责任 | 用户可见 | 失败时 |
|---|---|---|---|
| 起点整理 | 手工Authoring优先；AI辅助另评审 | 可编辑草案 | 保留原文 |
| 有界规划 | Graph读取固定设定+已确认事实+本轮Intent；结构校验 | 实际准备状态，不显示候选已发生 | 有界修复或恢复目标 |
| 请求准备 | CapabilityPolicy验证PreparedGeneration在Quote包络内 | 输入/规格/声音由已授权摘要说明 | 不支持组合发出请求数为0 |
| 提交/查询 | Provider持久操作、固定连接、受理未知核对 | 真实阶段，旧画面保留 | 不默认fal，不盲目第二POST |
| 媒体检查 | 技术/身份/语义检查，明确检查来源 | 通过后才播放 | 保留候选，禁止提交事实 |
| 事实归并 | 有效播放+语义证据+幂等事务，写保存点/事实/节点 | 节点后出现建议/自由入口 | 保留可恢复状态，不由前端造节点 |

内容质量用[生成规格](../product/GENERATION-SPEC-V1.md)评测，不以schema通过代替。30例中至少3例为同一非恋爱情境，分别覆盖接受/拒绝/非选项表达；M2取得Provider基础证据，M3完成Gate B与指标冻结，M4完成双端Gate C。

## 5. 缺口登记与实现边界

| ID | 当前差异/缺口 | 本期处理 | 后续开启条件 |
|---|---|---|---|
| T01 / O05 | AI辅助整理没有独立API/成本授权 | 保留手工创建；AI入口未就绪禁用 | 产品、schema、费用及失败恢复用例一起评审 |
| T02 / O05 | 字幕生产/对齐无独立契约 | 无可靠来源不显示字幕控件；不把候选台词当转录 | 明确转录/音轨来源、时间轴与计费后启用 |
| T03 / O01 | 附件PDF与公开文档能力声明冲突 | 冲突输入能力不准入；参考资料不是运行配置 | 供应商来源/地区/账户/版本核对及有预算实测 |
| T04 | P05“修改模型/设定再报价”不能修改已固定经历 | 按§3.1新建未开始经历；不新增隐式PATCH | 原地切换需独立设计与真实恢复验证 |
| T05 | 广场社区、支付、跨设备、物体点击等后续需求 | 当前只提示模板、本地预算与片段后回应 | 独立PRD/API及能力验证，不预建无消费者表 |

缺口关闭证据按角色负责：产品确认交互与范围，研发确认契约/实现，测试确认故障与真实行为。具体负责人和时间在排期时补充，不假设已上线日期。

## 6. 变更与评审方法

本轮同步技术总稿、架构说明、数据映射、Provider准入、API语义说明、时序与实施计划。历史REST wire schema仍为1.0.0候选（47操作），当前tRPC只有video.configuration；M0已实现DDL仍15模型/13真实唯一/0FK；没有为了文档版本号而改数据库。

每次变更从F/P/AC发起，登记operationId/schema、数据生命周期、权限/费用、失败分支、图源和阶段影响。增加客户端状态不必加表；新持久真值必须有单一所有者和迁移。契约冻结与实现通过分别留证，验收标准不因功能暂未实现而删除。


## 7. 新增分支需求追踪（不自动扩大P0）

[技术设计](BRANCH-SAVEPOINTS-DESIGN.md)中的BR编号是待实施验收，不沿用演练数据作为证据；[候选tRPC](../api/BRANCH-CONTRACT-DRAFT.md)尚未注册。

| 用户需求 / 入口 | 领域与候选操作 | 数据与约束 | 验收 / 阶段 |
|---|---|---|---|
| 一幕接一幕且记得过去 | 确认播放与事实用例 | Turn输入来源、不可变Snapshot/Savepoint；候选不等于事实 | BR01–02 / M2–M3基础 |
| 从某一刻另走一条线 | experience.fork | 新Experience/fork_base/decision、空稿、幂等；不继承未来 | BR03–04、BR10–11 / B1 |
| 故事足迹回看，不打断当前进度 | history.listSavepoints/getSavepoint | 前缀授权、只读媒体、浏览位置不改currentSavepoint | BR05–06 / B1 |
| 删除原路线不删坏新路线 | 引用与受控GC | ExperienceAssetRef、祖先/备份pin；不开放源未来 | BR07 / B1前置 |
| 分支费用可控 | Quote与BudgetScope | 两级额度、单笔账本、未决责任与删除无关 | BR08–09、BR12 / M2基础＋B1复验 |
| 一棵可浏览的故事树 | history.listBranches及懒加载投影 | source/root来源；无伪唯一、无预生成选项树 | BR12 / B2 |
| AI对话打磨剧本/角色，后续工作画布 | 二期独立创作Chat，工具经草稿Service | 复用草稿对象；人工确认写入；不改已发生Snapshot | 独立二期提案，不挤入上述热路径 |
