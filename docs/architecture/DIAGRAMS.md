# 架构、关系与时序图册 · V1.4 / 技术方案1.2同步

2026-09-10 · 设计图不是实现验收。系统图已统一为T3单HTTP入口；M0关系图仍只画当前15模型，新增分支对象单独画，避免误认为已迁移。

图2是无物理外键的逻辑关系；其余序列中的旧操作名称表示领域动作，正式tRPC名称与wire由AppRouter/Zod按阶段冻结，不以图代替接口契约。模型调用始终在数据库事务外。

受众：产品、研发与维护者。系统图说明职责/边界，关系图说明来源/共享，时序图说明并发、失败与恢复；不把三类问题堆进一张大图。源文件、下方代码块及SVG保持同步。

| 图 | 解决的问题 | 范围 |
|---|---|---|
| 01 系统架构 | 一个入口、内部worker、前端Mock、供应商边界 | 总体目标，未接通部分详见技术方案 |
| 02 M0逻辑关系 | 当前15表及关联基数 | 已有基础，不包含未来全表 |
| 03 保存与冻结 | CAS、版本与原子回执 | 领域语义 |
| 04 回合与事实 | 事务外生成、检查播放、确认存档 | M2/M3 |
| 05 保存与派发竞争 | 暂停先到/受理先到 | M2/M3 |
| 06 重启恢复 | 恢复、未知受理、旧备份 | M0-C/M2/M3 |
| 07 开始确认 | 创建零调用、报价与开始分离 | M1/M2 |
| 08 分支来源 | 不可变快照、共享前缀、独立进度 | M3/B1待实施 |
| 09 分叉时序 | 暂停、幂等、素材预检、创建/恢复 | B1待实施 |
| 10 共同预算竞争 | 两分支共享总上限、记账一次、未决责任 | M2基础/B1复验 |

## 系统架构与运行边界

[打开矢量图](diagrams/rendered/01-system.svg) · [Mermaid源](diagrams/01-system.mmd)

```mermaid
flowchart TB
  subgraph CLIENT[同一个产品界面]
    UI[Next / React 单舞台与创作管理]
    MOCK[前端 Mock 控制器] -->|显式演练 / 不请求模型| UI
    TAURI[后续 Tauri 薄壳] -.-> UI
  end
  subgraph HOST[本机宿主 / 单受控数据实例 · 目标架构]
    API[Next / tRPC 单一 HTTP 入口]
    AUTH[会话 / Host / Origin / CSRF]
    SERVICE[应用 Service / 权限 / CAS / 幂等]
    DB[(Prisma / SQLite / WriteGate)]
    ASSET[AssetStore / 不可变文件 / 引用与 GC]
    WORKER[内部任务 Worker / 租约 / 恢复]
    GRAPH[LangChain / LangGraph 唯一编排]
    PROVIDER[Supplier / Connection / Deployment / Binding / Profile]
    UI -->|正式业务路径 · 待接入| API
    API --> AUTH --> SERVICE
    SERVICE --> DB
    SERVICE --> ASSET
    DB -.持久任务.-> WORKER
    WORKER --> GRAPH --> PROVIDER
    WORKER --> SERVICE
    API -->|授权媒体读取 / Range| ASSET
  end
  REMOTE[用途受限的素材外传]
  MODEL[选定供应商的官方模型 API]
  ASSET --> REMOTE --> MODEL
  PROVIDER -->|事务外有界请求 / 不隐式 fallback| MODEL
  CHAT[二期创作 Chat / 画布] -.人工确认工具写入.-> SERVICE
  NOTE[已实现仅配置查询及内部数据切片 / 不代表正式业务链已接通]
```

## M0 逻辑数据关系

[打开矢量图](diagrams/rendered/02-data-foundation.svg) · [Mermaid源](diagrams/02-data-foundation.mmd)

```mermaid
erDiagram
  %% 15 个 M0 逻辑关系；无物理FK，owner/引用由应用事务校验。
  LocalProfile ||--o{ StoryDraft : owns
  LocalProfile ||--o{ CharacterTemplate : owns
  LocalProfile ||--o{ Asset : owns
  LocalProfile ||--o{ CommandReceipt : deduplicates
  StoryDraft ||--o{ StoryVersion : freezes
  CharacterTemplate ||--o{ CharacterVersion : freezes
  StoryDraft ||--o{ StoryDraftCast : configures
  CharacterVersion ||--o{ StoryDraftCast : references
  StoryVersion ||--o{ StoryVersionCast : freezes
  CharacterVersion ||--o{ StoryVersionCast : references
  StoryDraft ||--o{ StoryDraftAsset : uses
  Asset ||--o{ StoryDraftAsset : references
  StoryVersion ||--o{ StoryVersionAsset : uses
  Asset ||--o{ StoryVersionAsset : references
  Asset o|--o{ CharacterTemplate : portrait
  Asset o|--o{ CharacterVersion : portrait
  StoryVersion ||--o{ Experience : starts
  ProviderBindingVersion ||--o{ Experience : pins
  Experience ||--o{ InteractionEvent : presents
  InteractionEvent ||--o| ResponseDraft : saves
  StoryDraft {
    string id PK
    string ownerId
    int revision
  }
  StoryVersion {
    string id PK
    string ownerId
    string storyDraftId
    int versionNo
    int sourceRevision
  }
  Experience {
    string id PK
    string ownerId
    string storyVersionId
    string providerBindingVersionId
    bigint budgetLimitMicros
    string budgetCurrency
    int revision
    int rowRevision
    int dispatchEpoch
  }
  ResponseDraft {
    string id PK
    string ownerId
    string experienceId
    string interactionEventId
    int revision
  }
```

## 保存草稿与冻结开局

[打开矢量图](diagrams/rendered/03-save-and-freeze.svg) · [Mermaid源](diagrams/03-save-and-freeze.mmd)

```mermaid
sequenceDiagram
  %% 回执与业务写入同事务；复用版本不再次装配子引用。
  participant U as 创作者
  participant API as Runtime 用例
  participant DB as Prisma / SQLite
  U->>API: 保存草稿(commandId, expectedRevision, 内容)
  API->>DB: BEGIN / WriteGate先写取得写权 / 查询命令回执
  alt 同 commandId 且内容摘要相同
    DB-->>API: 既有结果
    API->>DB: 结束事务，不重复业务写入
    API-->>U: 返回原回执，不再次写入
  else 同 commandId 但摘要不同
    API->>DB: ROLLBACK
    API-->>U: 幂等键冲突，保留编辑
  else 新命令
    API->>DB: 按 ownerId + id + revision 条件更新
    alt 影响行数为 0
      API->>DB: ROLLBACK
      API-->>U: 版本冲突，保留编辑
    else 更新成功
      API->>DB: 更新人物/素材关联 + 写回执 / COMMIT
      API-->>U: 已保存 + 新 revision
    end
  end
  U->>API: freezeStory(expectedRevision, 独立 commandId)
  API->>DB: BEGIN / WriteGate / 校验身份与回执
  alt 重复冻结命令
    API->>DB: 结束事务；同摘要返回原版本，异摘要回滚
    API-->>U: 原冻结回执或冲突，不重建版本
  else 新冻结命令
    API->>DB: 校验 sourceRevision / 角色 / 素材
    alt 已有该来源修订的封口版本
      DB-->>API: 直接复用 versionId，不复制关联
    else 没有对应版本
      API->>DB: 插入未封口 header + cast/assets
      API->>DB: 固定内容 hash / sealedAt 封口
    end
    API->>DB: 保存冻结版本回执
    API->>DB: COMMIT
    API-->>U: 固定 storyVersionId，尚未创建经历
  end

  U->>API: createExperience(storyVersionId, bindingVersionId, budgetLimit, 独立commandId)
  API->>DB: WriteGate短事务 / 幂等 / 校验固定版本与所有者 / 创建经历和setup草稿 / 回执
  API-->>U: 零模型调用经历；重复同键同摘要返回原回执
```

## 回合生成、播放与事实归并

[打开矢量图](diagrams/rendered/04-turn-and-facts.svg) · [Mermaid源](diagrams/04-turn-and-facts.mmd)

```mermaid
sequenceDiagram
  %% SQL 事务不跨模型调用；计划、媒体、事实三次分开提交。
  participant P as Player
  participant A as tRPC / 应用 Service
  participant D as SQLite
  participant W as Worker / LangGraph
  participant V as 官方模型
  P->>A: 请求Quote（动作、节点、剧情版本）
  A-->>P: 上界、素材、模型版本与有效期；不调用模型
  P->>A: 确认Intent（幂等键、节点版本、草稿版本、control、quoteId）
  A->>D: WriteGate短事务：幂等/控制/报价/两级预算/消费节点/一次预留/TurnRun/outbox/命令回执
  alt 相同幂等键重复请求
    A-->>P: 同摘要返回原回执，异摘要报冲突；不再次调度
  else 节点冲突或预算不足
    D-->>A: 回滚
    A-->>P: 保留输入，不启动生成
  else 已提交
    A-->>P: accepted + turnId
    W->>D: 获取租约 / 读取固定上下文
    W->>V: 门禁检查后有界提案与视频请求(事务外)
    alt 提交超时且受理状态未知
      W->>D: submission_unknown / 保持预算预留
      A-->>P: 等待核对，只开放核对或离开
    else 已取得 taskId
      W->>D: 保存同一 operation 的 taskId
      loop 有界退避查询
        W->>V: 查询既有 taskId
        V-->>W: 状态 / 最终媒体
      end
      W->>W: 落地媒体 / 技术检查 / 语义检查
      alt 检查未通过或不确定
        W->>D: needs_attention，不提交候选事实
        A-->>P: 保留上一画面 / 显式恢复动作
      else 检查通过
        W->>D: MediaSegment + 检查证据
        A-->>P: 受权媒体源 ready
        P->>A: 整段有效播放完成证据
        A->>D: WriteGate短事务：核验片段/版本，事实+不可变Snapshot/Savepoint+新节点+事件
        A-->>P: 片段后情境建议与自由回应入口
      end
    end
  end
```

## 保存退出与请求发起竞争

[打开矢量图](diagrams/rendered/05-pause-race.svg) · [Mermaid源](diagrams/05-pause-race.mmd)

```mermaid
sequenceDiagram
  %% 旧暂停命令只返回原回执，不能在 Resume 后再次暂停。
  participant P as Player
  participant G as Runtime 经历提交门锁
  participant D as SQLite
  participant W as Worker
  participant V as 官方供应商
  P->>G: SaveAndPause(commandId, 最新草稿, 版本)
  G->>D: 查询命令回执快路径
  alt 同 key 同摘要
    D-->>G: 原回执
    G-->>P: 原结果，不改变当前 epoch 或暂停状态
  else 同 key 异摘要
    G-->>P: 冲突，保留编辑；不执行暂停
  else 新命令
    alt 暂停先取得门锁
      G->>D: BEGIN / WriteGate / 复查回执 / CAS草稿与经历
      G->>D: 保存点 + paused + epoch递增 + 命令回执
      G->>D: COMMIT
      G-->>P: 已保存并停止新增调度
      W->>G: 请求提交(旧 epoch)
      G-->>W: 拒绝新请求，保留任务
    else 提交先取得门锁
      W->>G: 检查 epoch / 续租 / 预算
      G->>D: WriteGate短事务登记 operation 为 submitting
      G->>V: 开始请求，然后释放门锁
      G->>D: BEGIN / WriteGate / 复查暂停回执 / CAS保存
      G->>D: 保存点 + paused + epoch递增 + 回执 / COMMIT
      G-->>P: 已暂停；列出已开始的在途请求
      V-->>W: 回执或超时
      W->>D: 核对既有操作与费用，不新增生成
    end
  end
  Note over G,D: 任一事务冲突整笔回滚，不显示保存成功；并发同key复查后返回既有回执
  Note over G,V: 门锁不等待外部响应；数据库事务不跨网络
```

## 重启与旧备份恢复

[打开矢量图](diagrams/rendered/06-restart-reconcile.svg) · [Mermaid源](diagrams/06-restart-reconcile.mmd)

```mermaid
sequenceDiagram
  %% 本地内容恢复与未决远端核对是独立维度，taskId 不阻塞已有媒体。
  participant Boot as Runtime 启动与 API
  participant D as SQLite
  participant W as 恢复调度
  participant V as 供应商
  participant P as Player
  Boot->>D: 验证迁移/引擎/零外键结构，取得实例租约
  opt 旧备份恢复启动
    Boot->>D: 隔离检查，轮换storeEpoch及经历流身份
    Boot->>D: 废止旧会话/lease/未接受Quote；保持暂停
  end
  P->>Boot: 重新鉴权，获取快照与带世代cursor
  Boot->>D: 同一读快照：保存点/草稿/媒体/预算/recoveryTarget/cursor
  opt 有完整且已验证的本地片段
    Boot-->>P: 立即恢复本地画面/位置/草稿，不等待远端
  end
  alt 来自旧备份恢复
    Boot->>W: 隔离模式，禁止付费出站及自动调度
    W->>D: 标记需核对操作，不假定备份之后没有费用
    W-->>P: 可只读查看；核对并显式恢复后开放推进
  else 正常重启
    W->>D: 仅扫描未决 operation / 费用
    alt 未决且已有 taskId
      alt 尚在供应商可查询窗口
        W->>V: 后台查询原账户任务，不新建
        V-->>W: 进度 / 结果 / 用量或查询失败
        W->>D: 幂等写回或保留未决，既有画面不受阻
      else 查询保留期已过
        W->>D: 标记retentionExpired，停止无效轮询，保留费用责任
        W-->>P: 需要受控核对，不自动重生成
      end
    else submitting 且没有 taskId
      W->>D: submission_unknown，预留不释放
      W-->>P: 该操作仅核对，不自动重提
    else 没有未决操作
      W-->>P: 按本地节点继续，无需远端查询
    end
  end
  Note over Boot,P: 缺失本地文件是独立修复状态，不把它当作重新生成授权
```

## P05开始确认与报价

[打开矢量图](diagrams/rendered/07-start-confirmation.svg) · [Mermaid源](diagrams/07-start-confirmation.mmd)

```mermaid
sequenceDiagram
  participant U as 用户
  participant P as P02 / P05 前端
  participant A as tRPC / 应用 Service
  participant D as SQLite
  U->>P: 确认起点、人物、模型与初始预算
  P->>A: 保存角色并freezeCharacter（有修改时）
  A-->>P: 固定CharacterVersion
  P->>A: updateStory绑定版本，再freezeStory
  A-->>P: 固定StoryVersion
  P->>A: createExperience（版本、绑定、budgetLimit、幂等键）
  A->>D: WriteGate事务创建零调用根经历、BudgetScope及回执
  A-->>P: preparing / media为空 / 无支出
  P->>A: changeControlLease + quoteAction(start)
  A->>D: 固定Profile与确定性Quote，不预留费用
  A-->>P: 费用上界、实际输入用途、规格及有效期
  P-->>U: 开始确认，不展示生成中
  alt 修改设定、绑定或预算
    U->>P: 返回编辑并确认新配置
    Note over P,A: 显式准备新零调用经历；旧经历不变，不隐式PATCH
  else 仅报价过期
    P->>A: 同经历重新quoteAction
    A-->>P: 新报价，重新确认
  else 配置和报价有效
    U->>P: 开始经历并接受当前费用
    P->>A: startExperience(control, revision, acceptedQuoteId, 幂等键)
    A->>D: 原子准入 / 两级预算 / 消费报价 / 一次预留 / Turn / outbox / 回执
    alt 回执丢失
      P->>A: getCommand（原幂等命令）
      A-->>P: 原受理结果或按契约继续核对，不另起付费命令
    else 已接受
      A-->>P: 已接受语义 / operationId / turnId（tRPC wire另行冻结）
    end
    P->>A: getExperience + streamExperienceEvents
    P-->>U: 进入单舞台，展示真实准备状态
  end
  Note over A,D: 外部模型调用由后续worker执行，数据库事务不跨网络
```

## 分支来源与共享关系

[打开矢量图](diagrams/rendered/08-branch-lineage.svg) · [Mermaid源](diagrams/08-branch-lineage.mmd)

```mermaid
flowchart TB
  SCOPE[BudgetScope 根树总上限]
  ROOT[Experience E0 / 根路线]
  CHILD[Experience E1 / 新路线 / origin=E0:B]
  SCOPE -->|同一账本 / E0 子限额| ROOT
  SCOPE -->|同一账本 / E1 子限额| CHILD
  ROOT --> A[保存点 A]
  A --> B[保存点 B]
  B --> C[保存点 C / 源路线未来]
  B --> SNAP[不可变 Snapshot B / 仅已确认事实]
  CHILD --> BASE[fork_base / 本地父点为空 / 无新媒体]
  BASE -->|共享已确认状态| SNAP
  BASE --> D[新保存点 D / E1 自己的已确认结果]
  CHILD --> NODE[独立 decision / 新建议 ID / 空草稿]
  CHILD --> REF[持久 ExperienceAssetRef]
  REF --> MEDIA[A/B 前缀必要媒体]
  B -.来源证明 / 非普通本地父指针.-> BASE
  C -.禁止进入 E1 上下文.-> BLOCK[不继承未来 / 任务 / 报价 / 许可]
  NOTE[逻辑关系不是数据库外键 / 故事树是查询投影]
```

## 从历史保存点创建新路线

[打开矢量图](diagrams/rendered/09-fork-sequence.svg) · [Mermaid源](diagrams/09-fork-sequence.mmd)

```mermaid
sequenceDiagram
  participant U as 用户
  participant P as Player
  participant A as tRPC / 应用 Service
  participant F as AssetStore
  participant D as SQLite
  U->>P: 回看 B / 从此另走一条线
  P->>A: history.getSavepoint（查看经历 / 来源保存点）
  A-->>P: 历史情境 / 前缀媒体 / hash / 可用性 / 预算摘要
  Note over P,A: 回看不改当前播放实例，不报告播放，不调用模型
  opt 当前路线尚未保存暂停
    P->>A: SaveAndPause 当前路线（可能不是 B 所在源线）
    A->>D: 原子保存草稿与暂停准入
    A-->>P: 回执；失败则保留输入，不切换
  end
  P->>A: fork（原命令 ID / 来源 B / hash / 子限额）
  A->>D: 先检查已有命令回执
  alt 已有相同命令
    A-->>P: 原 child 引用；不回退 child 当前进度
  else 新命令
    A->>F: 事务外预检必要素材可读
    Note over A,D: 预检失败返回前复查回执，同键并发成功则回放原 child
    A->>D: WriteGate：重查回执 / owner / 来源 / hash / 素材 / scope
    alt 来源失效或冲突
      D-->>A: 整笔回滚
      A-->>P: 明确错误，保留原位置
    else 准入通过
      A->>D: 创建 paused child / fork_base / 新 decision / 空稿 / 引用 / 回执
      D-->>A: 原子提交
      A-->>P: child 与初始节点引用（不是当前状态快照）
    end
  end
  opt fork 已确认成功
    P->>A: 读取 child 当前快照 / 取得控制 / 显式 resume
    A-->>P: awaiting_input / 本分支新节点
    U->>P: 选择建议或自由回应
    P->>A: 独立 Quote / 明确接受
    Note over A,D: 两级预算通过后才创建 child 自己的新回合
  end
  Note over P,D: fork 零模型调用 / 零预留<br/>原线已受理任务保留核对责任
```

## 分支共同预算与并发准入

[打开矢量图](diagrams/rendered/10-branch-budget.svg) · [Mermaid源](diagrams/10-branch-budget.mmd)

```mermaid
sequenceDiagram
  participant A as 分支 A
  participant B as 分支 B
  participant S as 准入 Service / WriteGate
  participant D as SQLite 单账本
  participant W as 内部 Worker
  A->>S: 接受 Quote A（命令 / 控制 / 节点版本）
  B->>S: 同时接受 Quote B
  S->>D: 串行短事务：回执 / scope 与 A 余额 / 原子预留一次
  D-->>S: 提交 A 预留、回合与回执
  S-->>A: 已接受
  S->>D: 下一短事务：以 A 提交后的余额检查 scope 与 B
  alt 共同余额或 B 子限额不足
    D-->>S: 回滚，不消费 B 节点或 Quote
    S-->>B: 额度不足 / 保留回应
  else 两级额度均足够
    D-->>S: 提交 B 的独立预留与回执
    S-->>B: 已接受
  end
  Note over S,W: 唯一调度拥有者：scope门锁 → 经历门锁 → WriteGate
  W->>D: scope门内最终检查并登记提交，再开始发送后释放门锁
  alt 提交后受理状态未知
    W->>D: 同scope门内标记 submission_unknown，保留原预留
    Note over A,W: unknown先提交则禁止新请求；已先开始的请求仍属在途责任
  else 有可核对终态
    W->>D: 原子结算原费用一次并释放对应预留
  end
  Note over S,W: 同一账本分别按 scope 与 experience 汇总<br/>费用不复制，未决属于预留的一部分
  Note over A,D: fork、删除或暂停不增加 scope 上限，也不释放既有责任
```
