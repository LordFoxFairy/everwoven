# 分支存档 tRPC 候选契约 · Draft 1

2026-09-10 · 仅设计，**未注册到AppRouter**。不是新增REST/OpenAPI上线声明。领域语义以[专项设计](../architecture/BRANCH-SAVEPOINTS-DESIGN.md)为准。

## 1. 共用规则

服务端会话产生owner；Host/Origin/CSRF与既有本机门禁一致。客户端不提交owner、Snapshot、媒体URL或来源祖先数组。UUIDv7、UTC毫秒、正整数revision、十进制金额字符串和同币种规则沿用。查询结果不返回凭证、绝对路径或未来剧情事实。

## 2. 方法与读写副作用

| 候选方法 | 类型 / 输入摘要 | 输出摘要 | 副作用 |
|---|---|---|---|
| history.listBranches | query / rootExperienceId、cursor、limit | 本owner分支列表、来源SP、当前阶段、nextCursor | 只读，不自动resume/fork |
| history.listSavepoints | query / experienceId、cursor、limit | 可访问前缀与本地节点摘要、真实分页范围 | 只读，不返回完整世界状态给普通树列表 |
| history.getSavepoint | query / experienceId、savepointId | 历史情境、受权媒体引用、snapshotHash、forkEligibility、scope预算摘要 | 只读；不创建播放instance，不报告播放，不轮询模型 |
| experience.fork | mutation / ForkCommand | ForkReceipt | 创建独立paused child及持久引用；零模型调用、零资金预留 |

方法名在Zod/实现评审时冻结；所有方法当前implemented=false。分页实际限制需实施前压测和冻结，服务端始终有上限，不提供无限all查询。

`history.getSavepoint`既可以读取当前经历自己的SP，也可以读取通过origin及显式前缀引用授权的祖先SP；不允许据此遍历源经历SP之后的节点。experienceId表示当前查看的经历作用域，savepointId可为其授权前缀中的源点；响应须含实际sourceExperienceId/sourceSavepointId及kind，用于明确fork目标。fork_base本身首版不可再分叉；折叠展示时不得隐去原来源生命周期限制。根路线软删除不隐藏本owner的存活child或清空scope；列表可返回已删除祖先的最小占位而非其全文。

单纯owner相同不是“继承源未来剧情”的依据。

## 3. ForkCommand

```typescript
type ForkCommand = {
  commandId: string;
  sourceExperienceId: string;
  sourceSavepointId: string;
  expectedSnapshotHash: string;
  branchBudgetLimitMicros: string;
  currency: string;
};
type ForkReceipt = {
  data: {
    experienceId: string;
    rootExperienceId: string;
    sourceExperienceId: string;
    sourceSavepointId: string;
    initialSavepointId: string;
    initialInteractionEventId: string;
    budgetScopeId: string;
    acceptedAt: string;
  };
  replayed: boolean;
};
```

这是回执引用，不包含会被误当成当前状态的“仍处于paused”快照。收到回执后用现有经历快照操作读取child最新状态。首次成功的child必为paused，后续重放不把已经继续的child倒回初始状态。

鉴权与规范化输入后先检查回执，未命中才执行来源/文件预检；预检失败返回前及最终创建事务内均复查回执。已提交成功后即使源素材丢失，原键重放仍返回同一child，不把当前素材故障当成原命令失败。

source SP不可变，fork不要求source当前剧情revision还停留在B；否则原路线已经走到C就无法从B分叉。用source SP身份/hash防错目标，以生命周期、owner、素材与scope事务检查保证准入。切换之前的SaveAndPause仍使用正在操作经历的rowRevision/草稿版本，不能用fork省略。

## 4. 快照与错误扩展

经历快照需设计origin、rootExperienceId、currentSavepointId、scope预算摘要，以及fork_base只读媒体的明确来源。existing media不能伪装为child新生成且已播放。旧客户端不认识fork_base证据模式时拒绝推进并提示升级，不把它当普通setup重新start。

forkEligibility仅为提示，包含eligible及有限阻断原因。实际mutation复查；读取到eligible后素材可能被删除或scope状态改变。

新增候选错误：SOURCE_UNAVAILABLE（含越权/不存在/来源删除的对外同类结果）、SAVEPOINT_NOT_FORKABLE、SNAPSHOT_MISMATCH、SNAPSHOT_VERSION_UNSUPPORTED、SOURCE_MEDIA_UNAVAILABLE、BUDGET_SCOPE_UNAVAILABLE、SCOPE_RECONCILIATION_REQUIRED。身份、CAS、幂等、额度和参数错误复用现有语义。具体tRPC code与可重试策略在实现契约中逐项映射，不直接泄露底层错误。

SCOPE_RECONCILIATION_REQUIRED阻止新付费派发，而非阻止零生成的回看/fork；前端用allowedActions区分“可另存分支”和“现在可生成”。所有客户端提示仍需服务端验证。

## 5. 引用与消费保护

新child的decision/建议ID重新生成；引用相同建议文字不复用已消费source节点的身份。scope、root、绑定等从source真值解析，客户端不可选择不相干的账户范围。

普通媒体读取与回看媒体读取的区别主要在授权来源和禁止写副作用；复用AssetStore/Range基础，不新建公开直链。新媒体片段的播放证据仍走原流程；来源继承媒体的回看不走reportPlayback。

## 6. 上线门槛

先有受保护会话、正式经历快照/Savepoint、scope预算、事务与资产GC测试，再注册方法。随后同步客户端类型、输入输出Zod、兼容版本、鉴权/幂等/恢复/分页/模型零调用测试；不提前修改历史47操作的implemented标识。
