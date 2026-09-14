# 原应用分幕游玩接线（2026-09-14）

状态：原3100前后端入口已接线；真实SQLite/HTTP/浏览器客户端两幕测试、Chrome原页面交互测试均使用明确的供应商/媒体替身。没有调用付费模型。不能将这些结果称为真实供应商验收或整个V1完成。

## 用户路径

我的剧本 → 保存并准备 → 确认开局配置 → 进入故事；已有旅程从“我的游玩”进入。进入和刷新只读取已保存状态。准备页固定的是设定、供应商绑定与预算上限，费用确认发生在舞台内。

舞台占满当前窗口，单视频和可收纳的悬浮回应区。逐幕生成，生成和播放期间不能插入回应。视频播完且后端保存播放结果后，才出现2–4条情境建议，以及“自己回应”。建议可直接采用或修改。每个回应先保存本机草稿，再获取下一幕报价；确认费用后才入队。

## 架构

```mermaid
flowchart LR
  Entry[原 Platform / 我的游玩 / 故事准备] --> Controller[PlayController]
  Controller --> Stage[GenerationStage / 单视频舞台]
  Controller --> HTTP[原 tRPC generation API]
  HTTP --> Session[本机会话 / owner / dataset / storeEpoch]
  Session --> App[GenerationService / GenerationPlayback]
  App --> DB[(SQLite + Prisma)]
  Launcher[原 local-start 生命周期] --> Worker[串行 Worker / Outbox]
  Worker --> DB
  Worker --> Director[LangChain 场景导演]
  Director --> Text[OpenRouter 固定文本模型]
  Worker --> Video[MiniMax 官方视频任务适配器]
  Worker --> Files[私有 MP4 / ffprobe / 采样]
  Files --> Media[原私有媒体 HTTP]
  Media --> Stage
```

## 时序

```mermaid
sequenceDiagram
  participant U as 用户
  participant C as 原页面
  participant A as Generation API
  participant D as SQLite
  participant W as Worker
  participant P as 供应商
  U->>C: 进入故事
  C->>A: get / 按需 getDraft、getQuote
  A->>D: 读取当前进展
  U->>C: 查看费用或选择回应
  C->>A: 按需 saveDraft，然后 quote
  A->>D: 保存草稿/固定报价（不提交模型）
  U->>C: 确认并生成
  C->>A: accept（commandId = quoteId）
  A->>D: 原子预留预算、消费报价、创建 turn/Outbox
  W->>D: 领取固定阶段
  W->>P: 规划、视频任务、结果查询
  W->>D: 保存私有媒体与核验结果
  C->>A: 轮询 get
  A-->>C: playing + 私有媒体ID
  C->>C: 播放完整片段
  C->>A: completePlayback（commandId = turnId）
  A->>D: 保存 viewed、decision、空回应草稿
  A-->>C: awaiting / 情境建议
  Note over U,P: 等用户回应，不自动生成下一幕
```

## 新增 API 契约

沿用 `/api/trpc/generation.<方法>`。GET单请求查询；POST单请求修改；禁batch、cookie会话、同源校验、请求marker、严格字段校验、有界响应及no-store。所有输入共有 `protocolVersion:1, datasetId, experienceId`；ID为UUIDv7。owner来自服务端会话，客户端不得指定。

| 方法 | 类型 | 额外输入 | 输出 |
| --- | --- | --- | --- |
| get | GET | 无 | PlayDTO |
| quote | POST | commandId、expectedExperienceRevision、kind；response还需interactionEventId、text | `{data:QuoteDTO,replayed}` |
| getQuote | GET | quoteId | `{quote:QuoteDTO,acceptedTurnId:string或null}` |
| accept | POST | commandId、expectedExperienceRevision、quoteId、consent:true | `{data:TurnDTO,replayed}` |
| completePlayback | POST | commandId、expectedExperienceRevision、turnId、mediaId | `{data:PlayDTO,replayed}` |
| getDraft | GET | interactionEventId | ResponseDraftDTO |
| saveDraft | POST | commandId、interactionEventId、expectedDraftRevision、text | ResponseDraftDTO |

ResponseDraftDTO为公共三字段加 `interactionEventId,revision,text`。text最长2000个UTF-16代码单元，允许空串。仅当前awaiting节点可读写；不能修改已离开的节点草稿。保存按revision做并发检查，同命令重放原回执。保存不推进体验修订，不调用模型，也不生成新节点。

PlayDTO/QuoteDTO/TurnDTO的完整严格结构以runtime/contracts/generation及generation-output为准。原播放与媒体协议见GENERATION-PLAYBACK、PRIVATE-GENERATION-MEDIA相关文档。

## 恢复与错误语义

- URL只存dataset/experience/quote的UUID和confirm标志，不存剧情、密钥、供应商地址。生成接受前写入原报价身份；刷新不自动重发accept。
- getQuote证明已经接受时，直接读取当前进展。结果未知仍保留原命令。原命令明确返回报价过期，且服务端复查该报价未接受且已过期，才解除确认锁；普通4xx不替代这个证明。
- get的响应以请求序号和连接epoch隔离。Worker推进阶段未必改变experienceRevision，因此不能只按revision判断新旧。
- 草稿800ms空闲保存，报价和离开前再次保证保存。保存结果未知只核对原命令；另一窗口引发revision冲突时，读取新版本并让用户明确选择使用已保存回应或保存当前输入，不静默覆盖。
- 播放通知丢失可重放相同turnId命令；HTTP回执成功后仍GET当前状态，不把历史回执当最新现场。浏览器检查played覆盖范围，服务端目前仍信任播放完成通知，尚非防伪观看凭据。
- 媒体播放错误只重新读取/重新加载原文件。失败与unknown不自动重新提交视频。
- 首次accept检查宿主运行、profile和资产后，才创建预算预留/任务。原回执重放不要求当下模型配置存在。

## 正式供应商安装边界

`providers.json`继续负责供应商连接和视频模型目录。`generation.json`是同一私有宿主目录中mode0600的执行配置，启动时一次性读取，不从HTTP或浏览器接收。缺失时剧本、旅程读取和历史播放仍可用；新报价/首次accept返回固定的配置未就绪错误。

每份配置包含schemaVersion=1及1–8个profiles，各项：

- profile：ExecutionProfileSpec，planner/video/validator固定供应商—连接—模型版本，graph/prompt/schema取已安装sceneArtifacts。
- prices：三阶段StagePrice，币种、有效期、bindingHash、计量项完整；不在代码中猜测实时价格。
- textInputBounds：planner/validator各自的method=context-window、modelId、tokens、source。tokens必须等于配置的maxInputTokens，作为运营者依据公开模型规格提供的保守上界；代码仅校验声明一致性，不代表已经在线验证metadata或精确计数。
- audio、validatorImageLimit、dimensions、cdnHosts：固定媒体规格与下载白名单。提前检查像素总量、比例、官方视频规格和本机ffmpeg/ffprobe。
- 凭据通过绑定credentialRef读取env:OPENROUTER_*或env:MINIMAX_*，只在服务端。不得把POLLO_API_KEY交给MiniMax官方域名。

本安装器当前实现OpenRouter结构化文本与MiniMax官方text-to-video。Pollo和image-to-video尚未安装；需要实际供应商完整公开base/protocol/model ID后实现对应适配，不能凭截断截图推测。

启动器在listener成功后开始处理已接受Outbox；关闭时取消lifetime、停止领取、等待阶段处理与drain、断开DB。仅明确SQLite锁错误有界退避重试tick，业务/供应商未知结果不直接重发。并发stop共享同一清理任务。启动会恢复已有已授权队列，因此操作真实宿主前须确认没有未授权的待执行任务；本轮本机无generation配置、无turn/Outbox。

## 数据与验收

本轮复用ResponseDraft、CommandReceipt、GenerationQuote、GenerationTurn、RuntimeOutbox；没有新迁移、FK或业务唯一约束，未重置用户数据。下一幕通过parentTurnId连接上一幕。可选择旧节点的存档/fork界面及服务不在本次接线中宣称完成。

本地验证：`pnpm test`、`pnpm typecheck`；生产构建在独立依赖目录执行，避免破坏原3100开发服务。`node apps/web/scripts/verify-stage-flow.mjs`要求原3100已运行、Chrome/ffmpeg可用；仅在独立浏览器上下文拦截生成接口和旅程列表，以测试素材检查原页面播放、回应、刷新与第二幕，不写用户业务表、不调用供应商。真实SQLite→原HTTP→客户端→controller测试另见generation-flow.integration.test.ts。

剩余真实闭环：核实供应商公开协议并安装配置、实际账单结算、完整播放凭据、存档/fork，以及明确预算授权后的真实两幕验收。当前没有该预算授权；零付费测试。
