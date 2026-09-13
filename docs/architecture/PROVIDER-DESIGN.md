# Provider 专项设计与准入规范 · V1

2026-09-10 · 技术方案自审修订。**设计基线，不是已完成的正式runtime实现。** [自审结论](SELF-AUDIT-2026-09-10.md) · [API契约](../api/CONTRACT.md)

## 1. 裁决：保留方向，补齐五层身份

不要做一个全能`generate(provider, model, prompt)`，也不把品牌名当部署或账户。采用：

```text
ProviderDefinition（供应商品牌/协议家族）
  → ProviderConnection（具体地区/账号/凭证引用/允许端点）
    → ModelDeployment（精确远端型号/操作类型/能力版本）
      → ProviderBindingVersion（本项目所选部署、参数和身份快照）
        → ExecutionProfileVersion（本回合规划/视频/检查各阶段的固定绑定）
```

| 对象 | 稳定身份及内容 | 生命周期 / 变化 |
|---|---|---|
| Definition | providerId；协议家族、登记来源 | 代码登记，供应商名称不是模型ID |
| Connection | connectionId、providerId、region、endpointProfileId、providerAccountScopeId、credentialRef | 宿主配置；前端只看到公开ID/地区/可用性，不接收任意URL或密钥 |
| Deployment | catalogId、connectionId、精确modelId、operationKind、protocolVersion、capabilityVersion | 同模型不同地区/账号权限可能不同；不因名称相同合并 |
| BindingVersion | bindingKey+versionNo、connection/账户作用域快照、部署、参数、adapterVersion | 不可变。旧操作按旧绑定查询；新默认值不覆盖存档 |
| ExecutionProfileVersion | plannerBinding、videoBinding、validatorBinding、prompt/graph/schema版本、阶段预算上限 | 服务端固定、不可变；Quote返回此版本ID，内部保存完整摘要 |

同一账户轮换API key：credentialRef可指向新密钥，但providerAccountScopeId不变；更换账号/地区必须新Connection/Binding，不拿新账户查询旧任务。旧凭证撤销导致旧任务不可核对时保留未决状态并提示，不当作任务失败。公开connectionId不是账户密钥，也不直接等于数据库ownerId。

本期用户先选择视频供应商/模型。规划与语义检查通过宿主登记的有界执行配置绑定；**不是前端需要填三遍模型**。M2创建Quote前冻结ExecutionProfile，后续回合可在显式新授权下采用新profile，旧回合继续原profile。没有规划/检查能力或成本证据就阻断相应执行，不把固定视频模型当整个系统都已绑定。

## 2. 端口与职责：协议适配器不拥有游戏

| 边界 | 输入 / 输出 | 禁止承担的责任 |
|---|---|---|
| ModelRegistry.resolve | connectionId+catalogId+版本 → 已登记部署 | 任意URL拼接、按名字模糊匹配、偷偷切供应商 |
| CapabilityPolicy.preflight | 部署证据+输入用途+规格+阶段要求 → 准入/理由 | 用单个imageInput=true跳过组合约束 |
| QuoteService | 固定执行profile+动作+输入包络 → 成本上界/告知摘要 | 调模型算报价、假定未知价格为0 |
| ProviderAssetTransport | 本地asset/用途/绑定 → 衍生素材与远端素材租约 | 公开本地目录、把localhost URL当远端可读地址 |
| TextModelPort | 固定预算的结构化规划/修复请求 → 候选结果与用量 | 写确认事实、无限工具调用 |
| VideoJobProvider | 一次submit / 一次query / 受支持的reconcile或cancel | 内置循环轮询、自行重试POST、持有事务、扣款或消费节点 |
| VideoRealtimeProvider | 将来独立会话/流式协议 | 用job端口假装可以实时打断 |
| MediaImporter/Validator | 输出定位信息 → 本地文件/技术与语义检查证据 | 只用模型生成的计划自证视频内容 |
| Worker / TurnService | 阶段恢复、租约、费用、事实与outbox | 将SDK自动重试当本地幂等保证 |

一期采用注册工厂和依赖注入，不需要动态插件容器。SDK由适配器包封装；Player只依赖快照/媒体/命令，换模型不改其供应商分支。

## 3. 视频任务的内部契约

以下是待M2落实的领域契约，不是当前`minimax-jobs.ts`已实现的签名。

### 准备与提交

- `PreparedGeneration`：operationId、connection/账户scope、binding/profile版本、requestSchemaVersion、semanticRequestHash、原始素材hash、衍生规则/角色、远端素材租约引用、有效请求参数、expectedOutput约束、授权ID、deadline。
- Quote前固定的是**授权包络**：玩家动作、可用素材及用途、媒体规格、模型profile、最大调用次数和费用。规划阶段之后形成实际提示词/请求；写入PreparedGeneration后才允许发送。
- 最终请求必须在授权包络内。规划器新增图片、改变输入用途/声音/模型/费用则停在needs_attention，重新报价确认；不能先发送再解释。
- 业务hash排除会轮换的签名URL/token，但包含素材内容和处理语义；另存传输请求摘要供排查。租约刷新仅在确认未提交且语义不变时允许，不能靠换URL把未知操作当新任务。
- `submit(prepared, context)`最多一次网络创建。context含追踪ID、截止时间、abort、CredentialStore访问，外层先做预算与派发门锁。

### 明确结果类型

| SubmitOutcome | 含义 | 上层动作 |
|---|---|---|
| accepted(taskRef) | 得到合法供应商任务回执 | 持久化并查询，不重新创建 |
| not_sent(reason) | 有证据证明未发出，如本地校验/派发前abort | 原回合可在授权内重新准入 |
| rejected(evidence) | 官方协议明确未受理；不能仅凭未知代理状态码猜测 | 写失败责任与结算依据，再决定重试 |
| unknown(evidence) | 已可能发送，断线/5xx/回执格式异常 | 保留预留、禁止自动新POST，只核对 |

`ProviderTaskRef`必须携带本地operationId、账户scope、connection/binding版本、taskId、operationKind、firstSubmittedAt；不能只传一个taskId让当前默认账户去查。

`query(taskRef)`返回观察，不直接改世界状态：queued/running/succeeded/failed/cancelled，或transport_unavailable、not_found、retention_expired、invalid_response。查询失败不等于生成失败。收到成功还要核对taskId/model/operationKind及媒体定位，再落地检查；无完整费用证据时业务成功与费用未决可并存。

`cancel`是能力可选端口；AbortSignal仅中止本地请求等待，不证明远端取消，不退款。无取消能力不暴露成功的取消按钮。`reconcile`可利用官方列表辅助调查，但匹配结果只在有可靠关联证据时绑定；绝不因为时间相近、模型相同就自动认领陌生任务。

## 4. 能力是矩阵，不是几个布尔值

每个能力记录三层证据：`documented`（官方说明）/`implemented`（适配+样本）/`verified`（指定账户真实调用），以及来源URL/日期、版本、验证范围和过期策略。文档存在不自动将生产available设为true。

完整服务端矩阵至少覆盖：

- operationKind与job/realtime；t2v/i2v/r2v各自准入。
- 按场景的图像角色及个数、输入组合互斥、格式/尺寸/字节/总请求大小、上传传输方式。
- 按模型与场景的时长、分辨率、比例控制（显式或输入驱动）。
- 原生音频生成/实际音轨、语言/口型质量的验证状态；非原生TTS是另一个明确收费阶段，不假装已由视频模型提供。
- 请求幂等、可验证查找、取消、查询保留期、输出URL过期、轮询/并发限额。
- 计费维度、失败/取消结算规则及未知费用处理。

前端Capability摘要只用于展示；最终准入查完整矩阵和当前输入。`aspectRatios`列表不保证所有输入模式都遵循该比例。

### 本次官方资料核对（2026-09-10，仅文档证据）

| 条目 | 核对结果 | 对本产品的裁决 |
|---|---|---|
| H3 与 H3 Max | V2文档列明两种精确modelId；Max的参考输入场景比H3受限 | 不把多人物参考/风格参考自动映射到Max |
| 首尾帧构图 | I2V以输入图决定比例，不能把设置16:9当强制输出 | 生成前预处理并告知裁切/补边；未知输出像素不伪报精确宽高 |
| 官方地区 | 中文与国际文档使用不同主机 | connection显式选择地区，凭证/账户scope随之固定 |

来源：[国际创建接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[中文创建接口](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)。这些是文档核对，不包含真实账户调用或音画质量验证。

对于多角色图片：先在产品中存为用户素材；实际生成是否全部参与，由选定模型场景准入决定。首帧模式能传入合成场景不等于具有独立人物身份参考能力；合成若需额外模型则单独报价，首期不暗中补这一笔调用。多人物长期一致性必须真实评测，失败时不继续宣称支持。

### PRD1.9补充：附件冲突与前端开启规则

用户提供的Max/Max-Turbo PDF与本轮重新读取的[公开创建接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)在型号和参考输入声明上不同；逐项比较见[参考评估O01](../product/REFERENCE-ASSESSMENT-2026-09-10.md)。PDF作为`unverified_source`待核实材料，不直接满足本节documented官方证据，更不升级为verified。公开页未列Turbo也不推断它不存在。

按来源/日期/地区/账户/协议版本保存差异，冲突输入场景保持不准入；供应商确认与明确预算试验后再更新能力版本。此处理是宿主登记策略，不向现有公开DTO随意追加未定义枚举。P05展示实际准入摘要；P06只显示真实媒体能力，不因上传头像成功就标人物一致性已验证。

本期视频绑定固定在Experience；Profile升级仅在相同固定视频绑定及显式授权范围内进行。玩家原地更换视频模型/地区/素材配置未有公共命令，当前走保存后新经历；不利用更新默认Registry让旧任务换账号或模型。

## 5. 连续场景与事实记忆

一期不宣称provider有永久世界会话。每一回合从应用保存的确认事实、当前角色状态、固定设定、前段已验证媒体证据和新Intent构造上下文。

- continuity输入优先使用前段已验证的末帧（衍生Asset，记录来源segment/time/hash），是否使用必须纳入Quote素材告知。
- 末帧只承接可见状态，不承载所有叙事记忆；记忆仍由确认事实提供。光照、角色身份、服装、场景方位等做跨段检查。
- 原始角色图作为身份参考、开场首帧、风格素材属于不同用途；模型不支持时明确阻断该输入组合，不简单把所有图都塞first_frame。
- prompt模板、graph版本、检查规则与具体请求摘要绑定TurnRun；前端输入不会直接变成未校验的供应商payload。

## 6. 计费和恢复：查不到不等于没花钱

官方查询文档标明最近7天的任务查询范围；列表也有该范围。方案增加`queryUntil`、`nextReconcileAt`、`reconcileAttemptCount`与`retentionExpiredAt`。超过可查询期，操作保留submission_unknown或原观察状态，attentionCode=PROVIDER_RETENTION_EXPIRED；停止无效自动轮询，预留不自动释放。可用本地媒体仍可观看，继续新付费需原责任先处理。[查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)、[任务列表](https://platform.minimax.io/docs/api-reference/video-generation-v2-list)

只有官方明确关联凭证、受控人工核对或账单证据才能结束未知费用责任。本期人工核对通过内部受控工具/审计流程，不增加客户端“我确认没扣费”按钮；未实现维护流程前，未决案例保持阻断。列表为空、404、已过期均不是零费用证据。

价格适配保留按输出、输入视频、图片、音频、tokens等有单位的计量，不把total_seconds全当output_seconds。当前官方价格页对H3输入和输出分别列出规则；Max另列其输入计费范围，不能复用一条“视频秒价”覆盖所有模型。[官方按量计费](https://platform.minimax.io/docs/guides/pricing-paygo)

`UsageObservation`保存归一化meters（十进制量+单位+来源字段）、完整性状态、价格版本和脱敏证据引用。未返回某字段不等于0。账本结算是独立幂等用例；供应商更正用追加调整分录，不覆盖历史。每日/每次应用预算不是供应商账户余额，需分别展示，不承诺本地限额拦截用户在其他产品上的花费。

## 7. 现有适配器处置与实施门槛

| 已有代码 | 评价 | 迁移前必补 |
|---|---|---|
| `minimax-request.ts` | 有纯请求构建/场景限制，首尾帧与adaptive意识正确 | 对接AssetTransport的验证产物，能力版本与实际输出检查 |
| `minimax-jobs.ts` | 创建/查询单次请求；未知提交不盲重试；错误脱敏 | 去掉唯一CN主机假设，以受控Connection注入；传固定taskRef/operation；保留完整计量与查询期限 |
| `catalog.ts` / `registry.ts` | 供应商-模型显式匹配，不自动fal回退 | 旧live入口不能作为新job是否可用的统一判断；M2建立独立任务准入 |
| `minimax-jobs.test.ts` | 已有参数、错误、回执校验的Mock测试 | 不能替代账户/计费/地区/图像输入/两轮连续性的真实验收 |

这些本轮只审核并建立整改任务，**未将旧adapter宣称升级为完整Provider基础设施**。

M2测试清单（每项记录输入证据、结果、版本，不只写pass）：

1. CN/global两个Connection不串URL/凭证，错误账户不重绑旧任务。
2. 同账户换key保持任务/计费作用域；换账户产生新绑定。
3. 普通H3和Max输入矩阵相互隔离；不支持参考图场景发出请求数=0。
4. I2V参考图派生与告知一致；未知像素精度返回provider_resolved。
5. Quote冻结profile；planner超出素材/模型/成本包络时派发数=0。
6. 超时、5xx、无taskId、崩溃各边界不自动二次POST。
7. 取消/abort/查询失败/保留期过期保持不同责任，费用不凭空释放。
8. 输出URL失效、重定向私网、损坏视频不写可播放事实。
9. input/output/图片/tokens计量完整性及重复结算/调整分录通过。
10. M2验证前段证据传输与请求准备；M3完成两轮语义兑现及30例Gate B样本（至少3例同一非恋爱情境，覆盖接受/拒绝/非选项）。单片生成成功不算Gate B。

建议结论：Provider方向可保留，完成上述协议/实现门槛后才能称“可替换、可恢复、可计费”的正式provider。当前允许开工M0，正式收费接入仍受M2 Gate阻断。


## 8. 分支存档接入约束（设计1.2补充）

[分支专项](BRANCH-SAVEPOINTS-DESIGN.md)不改变本规范的供应商/账号/部署/Binding/Profile分层。

- child初始配置来自来源Savepoint，不取父路线后来变更的profile或全局默认值；每回合profile固定、显式新授权才能切换的规则保持。
- fork、回看、树查询不调用模型，不复制旧taskId、Quote、控制许可或预留。新回应重新报价并检查当前能力/价格/素材授权。
- Quote与Usage/Reservation新增budgetScope归属；同根所有分支累计费用责任，分支子上限与scope总上限同事务检查。同一operation费用只记一次。
- 来源媒体可看不代表旧模型可继续；配置不可用/素材缺失时回看与生成允许动作分开。未知提交保留原账户核对，不能靠fork或换模型绕过scope未决门禁。

上述仍待正式预算、任务和分支用例落地验证；现有M0-B根CRUD没有收费能力。

多分支派发须执行[scope门锁协议](BRANCH-SAVEPOINTS-DESIGN.md#61-scope级派发串行化)：同scope未知状态提交与其他分支最终准入/开始发送互斥；scope→Experience→WriteGate固定锁序。仅做一次余额检查或各进程独立mutex不足以保证门禁。已开始请求继续核对，新的付费阶段等待核对结束；模型网络等待不持SQL事务或派发门锁。

## M2-A3实施补记 · 2026-09-13

已将供应商—型号—精确部署映射及纯MiniMax请求构造迁入runtime，Web不再保留重复实现。非秘密connection/binding登记和输入兼容策略已实码：显式cn/international、稳定账号scope/credentialRef、严格版本和参数、三层能力证据；已存同版本漂移继续由开局事务拒绝。详见[登记/策略实施说明](VIDEO-BINDING-REGISTRY-M2-A.md)。这不是启动配置加载、完整Capability/Quote准入或公开原页面接通的完成声明，compatible不授予派发。
