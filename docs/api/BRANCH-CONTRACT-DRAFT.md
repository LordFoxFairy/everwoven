# 分支存档 tRPC 契约 · V1

2026-09-14 · 已注册到原 AppRouter。文件路径沿用原设计入口；本稿替换候选方法，以下为实际契约。

## 共同约定

统一 `/api/trpc/history.*`，GET 查询、POST 命令。沿用本机 Host/Origin/CSRF/session 门禁，禁止混合批处理，响应 no-store。owner 取自会话；输入必须包含 `protocolVersion:1`、`datasetId`、`experienceId`。ID 为 UUIDv7，时间为 UTC ISO，金额为十进制微单位字符串。拒绝未知字段、客户端 owner、状态快照和供应商 URL。

## 已实现方法

| 方法 | 附加输入 | 输出和副作用 |
|---|---|---|
| history.list | limit（1–20，默认20）、beforeId? | items、nextBeforeId；UUID降序键集分页，只读本路线已播点及显式继承前缀，摘要最多300字符 |
| history.get | savepointId | savepoint、scene、media ID、canFork、budget；只读，不补发播放证明 |
| history.fork | commandId、savepointId、expectedSnapshotHash、branchBudgetLimitMicros、currency | ForkReceipt；原子创建 paused 子路线、基点、独立回应和引用，无任务及费用预留 |
| history.recover | commandId | 已提交 ForkReceipt 或 null；校验发起 experience/dataset，只读找回原命令，来源删除后仍有效 |
| history.resume | commandId、expectedExperienceRevision | protocolVersion、datasetId、experienceId；显式 paused→awaiting，无模型调用 |

完整类型和解析器：[history.ts](../../apps/runtime/src/contracts/history.ts)。`experienceId` 是当前授权查看的路线；选中点可以来自其显式继承前缀。返回 `sourceExperienceId` 是实际源点所在路线，不能假定与发起路线相同。

```typescript
type ForkReceipt = {
  data: {
    protocolVersion: 1; datasetId: string; experienceId: string;
    rootExperienceId: string; sourceExperienceId: string;
    sourceSavepointId: string; initialSavepointId: string;
    initialInteractionEventId: string; budgetScopeId: string;
    acceptedAt: string;
  };
  replayed: boolean;
};
```

回执只包含稳定引用，客户端随后用 generation.get 读取 child 当前阶段。服务端保存 `{input, data}`，摘要绑定原始规范化命令。同 commandId 同载荷返回原 child；异载荷冲突。入口先查回执，文件预检失败及最终写事务内再次查回执。已经创建成功后，来源删除或文件故障不会把原命令变成“未创建”。

## 恢复与交互

原回应先保存成功，再发 fork。URL 只记录 `fork=commandId`，刷新不重发 mutation。恢复按钮先 GET recover：命中进入原 child；当前页面仍持有完整原命令且未命中时，显式点击可以重试同一命令。刷新后若仅持有 ID 且未命中，保持待核对或返回原路线，不构造新命令。即使源路线删除、未知或读取失败，恢复入口仍显示。

child 初始 paused、逻辑 revision=1；resume 仅增加 rowRevision，逻辑修订保持1。generation.get 使用明确的 inherited 媒体投影，turn=null；不伪造子路线生成/播放。继续后重新选建议或自由回应，生成仍须单独报价与确认。

## 授权、额度和限制

- 来源必须是合格 played_segment，快照哈希、owner/dataset、固定剧本/绑定、媒体和素材均复核；源路线已删除/归档时禁止新 fork。
- 只继承到选中点为止的已确认前缀，最多1000点，超出明确拒绝、不截断。A→B→C 从 B 分叉只继承 A/B。
- 源路线删除后，已创建 child 通过持久引用读取其获准前缀；不获得源 C 的权限。
- 所有 child 共用根 BudgetScope，子上限不大于 scope 上限且币种相同。回看/fork 不收费；同 scope 未知责任阻止新付费阶段。
- GENERATION_CONTEXT_LIMIT 在报价及接受阶段、资金预留之前检查，按实际导演输入序列化上限65536字符，不静默删历史。
- 参数、身份、CAS、幂等和媒体错误复用 generation 公开错误映射；任意底层异常不会返回私有路径或凭证。canFork 为生命周期提示，最终资格以命令校验为准。

验收使用真实本机 Host、SQLite、私有 MP4 和隔离测试传输；不代表供应商付费验收已通过。
