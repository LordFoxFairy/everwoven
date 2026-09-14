# 分段生成主链与播放 API 契约

2026-09-14。生成实现位于 `apps/runtime/src/application/generation.ts` 和 `generation-worker.ts`；播放读取/回执独立位于 `generation-playback.ts`。`generation.get` 与 `generation.completePlayback` 已注册到原应用的 Host/tRPC，并有浏览器客户端。报价与接受仍是内部契约，**正式导演、私有视频、校验适配组合、调度及原页面绑定尚未完成**。测试用显式假传输验证协议和数据库行为，不是付费模型验收。

## 输入与回执

所有操作由已认证宿主注入 owner、dataset、storeEpoch；请求不能提供 owner、账户、价格、密钥、执行器或费用证明。标识为 UUIDv7，金额用最小货币单位的百万分之一整数字符串。

| 操作 | 输入（除 protocolVersion=1、datasetId 外） | 返回及副作用 |
|---|---|---|
| quote 开场 | commandId、experienceId、expectedExperienceRevision、kind=opening | `{data: QuoteDTO, replayed}`；固定 Profile、素材摘要和最多五分钟的报价，不建任务、不调用模型 |
| quote 回应 | 同上，kind=response、interactionEventId、text（1–2000字符） | 仅当前 awaiting 节点可报价，固定自由回应、上一幕 ID 和摘要 |
| accept | commandId、experienceId、expectedExperienceRevision、quoteId、consent=true | `{data: TurnDTO, replayed}`；同一事务消费报价、占用预算、创建回合和 Outbox，返回 queued |
| get | experienceId | 当前 PlayDTO；纯读取，不触发生成或重发 |
| completePlayback | commandId、experienceId、expectedExperienceRevision、turnId、mediaId | ready 且绑定媒体匹配后，原子转换为 viewed/awaiting，创建决定节点及空回应草稿 |

`QuoteDTO.summary` 含标题、本次输入、模型、地区、时长、分辨率、比例、声音方案、明确发送的私有图片 ID。不得将此摘要说成视频中已发生的内容。`TurnDTO` 是接受回执；其 queued 状态为接受时的历史事实，当前状态以 get 为准。播放回执同样不替代当前读取。

相同命令和规范化输入返回原回执；不同输入复用命令 ID 报 IDEMPOTENCY_CONFLICT。报价回放不续期、不读取当前价格；接受回放不重新预留预算。新命令重用已消费报价被拒绝。修改本轮输入后需要新报价和新的明确确认。

## 原应用播放接口

| 路径 | 方法 | tRPC 输入 / 输出 |
|---|---|---|
| `/api/trpc/generation.get` | GET | `input` 为 JSON 查询参数；输入为上表 get，输出 `result.data = PlayDTO` |
| `/api/trpc/generation.completePlayback` | POST | JSON 请求体为上表 completePlayback，输出 `result.data = {data: PlayDTO, replayed: boolean}` |

两者复用原本机会话 cookie、已配置来源和 `3100` 入口。POST 必须带相同 Origin 与 `x-everwoven-request: 1`；不接受单项或混合 batch。GET URL 上限 8192 字节，POST 流上限 16384 字节；响应 `no-store`、`nosniff`。浏览器读取成功响应最多 128 KiB，错误响应最多 8 KiB，越界立即取消读取。读取状态没有业务写入，也不唤醒 Worker。

`PlayDTO` 的固定字段：`protocolVersion`、`datasetId`、`experienceId`、`title`、`revision`、`status`、`turn`、`interaction`。`turn` 仅含 `id/status/media/errorCode`；`media` 仅含私有 ID 和正数时长，不含绝对路径或供应商 URL。`interaction` 仅含 ID、1–2000 UTF-16 单元的摘要与 2–4 个去重建议；建议含 `id/title/text`，标题最多 100 单元，回应最多 2000 单元。

输出校验关系：preparing 无 turn；generating 只允许执行中的 turn，且无媒体/选项；playing 必须 ready 且有媒体但无选项；awaiting 必须 viewed、有媒体和合法建议。unknown/failed 对应同名 turn，隐藏媒体和建议。成功/已播放状态不能带错误码。任何未知字段、跨数据集/经历响应或不一致状态都转为固定内部错误。

当前幕定位使用已接受报价的 `experienceRevision`（逻辑修订），并验证报价 acceptedTurnId 与回合 quoteId、owner、经历、interactionEventId 的双向关系。接受使经历修订 +1，播放完成再 +1；同一逻辑节点出现多份已接受报价按数据损坏拒绝。报价、播放读取/完成和下一幕父节点选择共用此定位规则，系统时间回拨不会切换回旧幕。不增加物理外键或新的唯一约束。

播放回执必须关联原请求的 turnId/mediaId，返回修订精确等于请求修订 +1。旧命令重放返回历史 awaiting 回执，**不代表当前仍可回应**；客户端应另行 GET 后渲染。新命令使用旧修订返回 409。当前 completePlayback 是受认证客户端的播放完成通知，尚不证明实际播放覆盖范围；正式媒体服务/播放凭据门锁仍待补齐，不能据此宣称真实视频验收完成。

错误：无效参数 400；会话失效 401；来源拒绝 403；经历不存在 404；修订/幂等冲突、当前不可播放、内容未确认 409；数据集/协议变更 412；超大请求 413；未知内部失败 500；存储 epoch 暂不可用 503。返回固定标识，不传递堆栈、数据库路径、供应商响应。网络中断、无效响应、5xx 保持结果 unknown，不自动重发任何命令。

```mermaid
flowchart LR
    Browser[原 T3 浏览器客户端] --> HTTP[原 tRPC / 会话与来源校验]
    HTTP --> Host[withLocalGenerationPlayback]
    Host --> Authority[文件身份 / owner / dataset / storeEpoch]
    Host --> Playback[GenerationPlayback]
    Playback --> DB[(同一个 SQLite)]
    Generation[GenerationService 报价与接受] --> Playback
    Generation --> Policy[安装的供应商执行策略]
    Note[播放读取不依赖当前供应商配置] -.-> Playback
```

```mermaid
sequenceDiagram
    participant UI as 原页面客户端
    participant Host as 播放 Host / tRPC
    participant DB as SQLite
    UI->>Host: GET generation.get(experienceId)
    Host->>DB: 事务读取根状态、最新回合、当前决定节点
    Host-->>UI: 经严格校验的 PlayDTO
    Note over UI: 正式视频与 onEnded 绑定待完成
    UI->>Host: POST completePlayback(原修订、回合、媒体、commandId)
    Host->>DB: 幂等检查 + viewed/awaiting + 选项 + 草稿 + 回执
    Host-->>UI: 历史播放回执
    UI->>Host: GET generation.get(experienceId)
    Host-->>UI: 当前状态，可能已进入新一幕
```

## 持久执行

```mermaid
sequenceDiagram
    participant UI as 原页面（接入待完成）
    participant App as GenerationService
    participant DB as SQLite
    participant Worker as GenerationWorker
    participant Provider as 固定账户的模型适配器
    UI->>App: quote(开场或当前节点回应)
    App->>DB: 同事务保存 Profile、报价、回执
    App-->>UI: 有效期、费用上限、素材用途
    UI->>App: accept(quoteId, consent=true)
    App->>DB: 消费报价 + 双预算 + Turn + Outbox + 回执
    App-->>UI: queued 回执
    Worker->>DB: 获取租约，先保存即将执行的阶段
    Worker->>Provider: 规划、单次提交或原任务查询
    Provider-->>Worker: 结果
    Worker->>DB: 保存阶段结果与下次唤醒状态
    Note over Worker,Provider: 事务外网络；未知付费结果不自动重发
    Worker->>DB: 私有媒体与内容结果就绪，状态 ready
    UI->>App: get
    App-->>UI: 单视频信息；尚无选项
    UI->>App: completePlayback(turnId, mediaId)
    App->>DB: viewed + 决定节点 + 空草稿
    App-->>UI: 当前建议和自由回应入口
```

Worker 每次 tick 只做一步。queued → planning → prepared → submitting → polling → materializing → checking → validating → ready。暂停在 ready 等播放确认，不自动生成下一幕。

planning/submitting/validating 在调用前已持久化。租约过期后发现这些阶段，标记 unknown、暂停经历、保留费用占用；迟到回调不覆盖新状态。有供应商 task reference 的 polling 只查询原账户原任务。查询暂时中断延后查询，不重新 POST。默认租约两分钟；正式 executor 仍须实现各调用的超时和退出取消，宿主调度也尚未注册。

`GenerationExecutor.assertProfile` 必须验证安装的 graph/prompt/schema/adapter；`plan` 不接收或输出模型选择和任意图像 URL。图像 URL 由独立的受信素材解析步骤提供，须只解析本次报价已同意的素材。正式图像解析与私有媒体落地尚待接入，不能用外部 URL 直接充当私有视频。

## 存储与费用

- 新增 generation_quotes、budget_scopes、generation_turns、budget_reservations、runtime_outbox 五表；全部没有物理外键。
- Experience.budgetScopeId 在第一次接受时分配；准备阶段不消耗费用。将来的分支必须继承根预算 scope。
- GenerationTurn.parentTurnId 记录上一幕；一个父节点可有多个子节点，使用普通索引。当前已实现同经历的后续幕；跨经历 fork/Savepoint 入口尚未实现。
- generation_turns.quoteId 是真正唯一：一份明确确认的报价最多对应一次生成。其他标题、摘要、父节点、内容 hash 不唯一。
- 报价覆盖 planner/video/validator 的固定最大调用次数、输入输出 tokens、视频秒数、原图及校验采样帧数量上限。整数 BigInt 运算，每项计量向上取整，禁止用 Number 表示金额或把未知费用当 0。
- 根 scope 和当前经历的责任额都必须容纳新报价。held 责任包含未完成和未知；提交失败不推断免费。
- 当前保守地一直保留整份预留。**实际费用结算、释放未使用额度、对账和异常任务人工恢复仍未实现**，因此不把内部状态 ready 当作经济闭环完成。

## 验收界限

已覆盖真实 SQLite 的报价/一次接受、事务回滚、重启原任务查询、未知不重提、播放前无选择、播放后决定节点、自由回应生成子幕和原幕保留。供应商 HTTP、导演、落地视频、内容检查在这些测试中是显式测试替身，生产不会注册这些替身。

下一项是同一原页面/宿主/正式 executor 的组合接入及实际私有媒体播放。完整验收还包括响应草稿编辑持久化、分支存档、实际结算、关闭应用后续玩，以及取得明确预算后两幕真实模型实测。当前没有这些完成声明。
