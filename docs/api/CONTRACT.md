# 未完 · V1 API 契约

> **2026-09-10 最新实施裁决：** 传输方案已调整为T3/tRPC，见[最新裁决](../architecture/T3-FRONTEND-MOCK-2026-09-10.md)。本文件及现有OpenAPI保留为未上线的历史REST候选与业务语义检查表，不再生成第二套内部REST客户端。新上线操作以AppRouter、Zod和对应测试为机器基准；当前仅video.configuration只读元数据已实现，47项业务操作尚待逐项映射/评审。

版本 **1.0.0 · 2026-09-10 · Review baseline，语义修订3**。与[技术方案](../architecture/TECHNICAL-SOLUTION-V1.md)共同评审；**尚未实现这些 `/api/v1` 路由，不代表当前原型接口可直接调用**。

[完整接口表](ENDPOINTS.md) · [OpenAPI 3.1.1](openapi.json) · [验证记录](VERIFICATION.md)

## 1. 契约边界与维护

自审修订2增加必填Connection、恢复目标及报价字段；所有正式路由仍未实施。1.0.0是待冻结候选，旧候选生成的客户端需重新生成，不宣称这些改动兼容已发布客户端。正式发布后仍遵守下述major规则。

- OpenAPI 是字段、必填、枚举、HTTP 路径的机器基准；本文是事务、权限、重放、费用与时序的语义基准。冲突必须在评审中修正，不由客户端自行猜测。
- 本期 36 个路径、47 个操作，分 M0/M1/M2/M3 实施。`x-implemented: false` 是交付状态；`x-stage` 是计划，不是运行时能力。
- 本地浏览器通过同源 BFF 访问唯一 runtime；Tauri 后续通过宿主适配使用同一契约。模型凭证、Prisma 对象、文件路径不进入 DTO。
- 当前由 `build_contract.py` 生成 OpenAPI/接口表；不手工修改生成物。M0 再从契约生成 TypeScript client，并建立 runtime 请求/响应校验与端到端契约测试，避免手写三套相似类型。
- V1 新增字段须更新 schema、兼容矩阵与测试；客户端可以忽略未知响应字段，但必须识别未知状态并停止推进。破坏性字段/语义变更升级 major；不凭 URL 相同宣称兼容。
- 不开放任意 `ownerId`、供应商 URL、SQL、模型生成 HTML/JS、内部维护许可。新增操作先过权限/费用/幂等评审。

本契约使用 [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)，不将其称为最新版本。

### PRD1.9语义对齐（本次未修改wire schema）

[功能/页面/API追踪](../architecture/PRD-TECH-TRACEABILITY-V1.md)列出F/P/AC及operationId。修订3只澄清组合调用：P05冻结角色/故事后createExperience，再取得控制和quote/start；固定版本、绑定和预算没有PATCH接口。更改开局配置显式创建新的未开始经历并重新报价，原经历及旧请求不被改写；相同配置重试复用原幂等命令。已开始经历换模型、改世界、追加预算属于后续独立契约。

节点后可对当前建议分别调用quoteAction（不调用模型、不预留费用），只在玩家选择且有效授权时提交其中一个；修改建议变为free文本并重新报价。报价过期仅重报同经历动作，不新开局。UI不因打开浮层、全屏或收纳而提交Intent。

AI辅助整理、字幕生成/对齐没有本版公共操作，入口保持未就绪。规划超出包络不意味着有任意改素材/绑定的重报价接口：先needs_attention，原回合只按固定配置允许的恢复模式执行；改变开局配置需另开经历。新增扩展命令须同步OpenAPI、费用和恢复测试。

## 2. 身份、安全与数据格式

### 2.1 本机也要鉴权

`POST /session/exchange` 接收**宿主签发**的一次性启动材料。宿主先建立高熵、短期（上限60秒）、绑定本机 profile/允许 origin 的 nonce，交换时原子消费；不开放匿名获取 nonce 的 HTTP 接口。Web 可由宿主打开含一次性 fragment 的启动页，页面立即清除 fragment 后通过同源 POST 交换；不得写日志/分析系统/持久缓存。桌面优先受限 IPC 交付。交换响应丢失后由宿主重新签发，不重复使用旧 nonce。

- Web：`weiwan_session` 是 HttpOnly、SameSite=Strict cookie；HTTPS 环境加 Secure。本机明文只允许 loopback。写请求另带 `X-CSRF-Token`；GET/session 读取当前 CSRF 材料。
- runtime/BFF 校验 Host、Origin、允许的本机端口/来源；拒绝通配 CORS与任意 DNS rebinding Host。没有会话的本机请求也返回401。
- 桌面：宿主签发短期 Bearer，非供应商 API key；token仅内存/受限IPC，发行/撤销属于宿主适配，不提供公众 mint 接口。Bearer调用不依赖cookie，但浏览器发来的Origin仍检查。
- 会话失效只停止客户端控制与新增调度资格；在途操作的安全核对/结算由后台继续。令牌、cookie、CSRF与 controlToken 全部从日志脱敏。
- 本期不开放 LocalProfile 删除/恢复、管理维护、凭证写入与备份恢复的公共HTTP接口；这些是宿主/内部维护入口，不能借普通 API 注入权限。

### 2.2 类型和响应

| 项目 | 规则 |
|---|---|
| 业务ID | UUIDv7小写字符串；不是授权凭证 |
| 时间 | UTC毫秒：`2026-09-10T12:00:00.000Z`；服务器维护生命周期时间 |
| revision | 正整数，按对应聚合CAS；不与事件序号混用 |
| sequence / 字节数 | 非负十进制字符串；客户端不转JS Number |
| 金额 | `amountMicros` 十进制整数字符串，1单位币种=1,000,000微单位；非浮点；领域校验不超有符号64位上限 |
| null | 显式没有值；PATCH字段缺省=不变，null仅允许清空指定字段 |
| 文本 | UTF-8，长度按schema；裁剪/规范化规则固定后再算hash；不静默截断玩家输入 |

成功：`{data: DTO, meta: {requestId, replayed, storeEpoch}}`。`requestId` 每次HTTP请求不同，不是幂等键。`storeEpoch` 是本次数据恢复世代，恢复备份后轮换并持久化。

错误：`{error: {code, message, retryable, retryAction, requestId, details}}`；`details`可为空对象。不包含堆栈、供应商密钥或私密提示词。前端按code/action处理，message只用于展示。

JSON接口返回 `Cache-Control: no-store`。媒体缓存独立见§8。

## 3. 幂等与并发：逐层分开

### 3.1 命令幂等

除一次性session交换、播放遥测外，所有写请求要求 `Idempotency-Key`（16–128字符）。键在owner内唯一，不按路由重复使用。

事务顺序：鉴权/语法校验 → WriteGate先取得写权 → 按owner+key查回执 → 比较规范化请求hash → **相同请求先重放** → 无回执再检查当前ETag/版本/权限/节点/预算 → 业务写入和回执原子提交。

hash包含方法、规范化路径、强前置条件、经校验的请求体；排除会话token、CSRF、requestId、租约秘密值。控制动作绑定leaseId/epoch/clientInstanceId，并重新验证调用者身份，不能换标签页重放别人的秘密。multipart hash包含文件字节hash及metadata，不包含随机boundary。

- 同键同内容：返回原HTTP成功状态与原逻辑结果，`meta.replayed=true`，`Idempotency-Replayed: true`。202仍是接受，不变成视频完成。
- 同键不同内容：409 `IDEMPOTENCY_CONFLICT`。修改输入/ETag后必须使用新键，不能覆盖原命令。
- **重放历史响应不是最新快照**。前端收到replayed后重新GET资源，不能用旧暂停响应覆盖后来恢复的状态。
- HTTP超时：先 `GET /commands/{key}`。找到说明曾接受，再查询resource/operation最新状态。404不证明原请求未来一定不会提交，只允许**原键原内容**重发；不自动换键新生成。
- 拒绝且完全未提交的请求不写成功回执。内部错误不向客户端保证“绝未发出供应商请求”。
- V1命令回执至少与所属经历/资源恢复期共存，**没有定时静默过期后重执行**；保留最小摘要与结果引用，敏感正文按隐私策略清理。资源硬清理后保留必要幂等墓碑；完整清理需另立身份/重放窗口协议。
- control-lease响应包含秘密：CommandReceipt只存结果引用，不存明文token。token由CredentialStore保护的宿主密钥与lease身份派生（域分离），仅原clientInstance、同storeEpoch、仍有效lease可重取；过期/接管返回409 `LEASE_EXPIRED`，不重放过期控制权。这是通用回放规则的显式例外。

### 3.2 版本归属

| 操作 | 前置条件 | 改变什么 |
|---|---|---|
| PATCH/DELETE/restore story、character、asset | `If-Match`资源强ETag | 根revision、updatedAt；逻辑删除/恢复更新deletedAt |
| 固定版本 | draft的`If-Match` | 创建或复用同sourceRevision版本；不任意增加草稿revision |
| DELETE/restore experience | `If-Match`，来自rowRevision | 行版本/可见性；恢复保持暂停 |
| start/intent/new retry | `expectedExperienceRevision`，intent还带节点ID与`expectedDraftRevision` | 接受时消费节点或恢复原turn；具体剧情版本按领域转换 |
| response-draft | 节点ID + expectedExperienceRevision + expectedDraftRevision | 仅draftRevision；不消费节点、不生成、不改变剧情revision |
| pause/resume | `expectedRowRevision`；pause有草稿则再查草稿版本/节点 | rowRevision、dispatchEpoch等调度状态，不自行改剧情事实 |
| 播放 | lease + playbackInstanceId + sequence | 独立playbackRevision；完成确认另触发事实事务 |

强ETag示例 `"story:01993480-0000-7000-8000-000000000001:r3"`。只接受一个强ETag，不接受`*`、列表或weak标签。缺少428，过期412；body中的领域版本失配返回409。标准条件请求语义见 [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)。

所有关联存在、同owner、可引用生命周期、同经历节点由应用事务查验；迁移零外键，真实唯一索引兜底同一业务键竞争。不能以API校验声明直接SQL同样安全。

## 4. 创作、版本、素材与删除

- stories/characters支持创建、部分字段修改、软删除、恢复、冻结版本、分页。标题/角色名/图片hash不唯一。
- PATCH顶层未出现字段不变；出现settings/cast/assets时**整体替换该字段**，不是隐式深合并。slotKey在同一父对象内唯一；重复槽400，无副作用。
- 固定版本200：当前sourceRevision已封口则返回既有版本，否则同事务生成并封口后返回。创建人物/故事版本失败整体回滚，不暴露半成品。
- 列表默认deleted=exclude，回收站用deleted=only；单项用includeDeleted=true读取墓碑/ETag。越权与不存在统一404。返回下一页opaque cursor；限制20默认、100最大。游标绑定owner/筛选/排序，分页并非整个编辑过程的冻结快照。
- 上传是multipart：file+application/json metadata。先校验实际格式、字节/像素上限及使用声明；V1仅JPEG/PNG/WebP用户图片，拒绝SVG/可执行内容。`Session.maxUploadBytes`为运行时限制，schema并不取代字节流限额。
- 文件先临时落盘与校验，再原子移动，再写元数据；失败孤儿文件由宽限GC处理。上传本机不等于发送模型，开始前报价列出inputAssetIds。
- DELETE返回200墓碑，而非宣称磁盘已抹除。Deletion.revision对应被删根的CAS版本；experience映射rowRevision。先GET墓碑ETag再restore。
- 素材软删除禁止新增引用；既有封口版本/经历仍可通过历史引用读取。进入deleting或purged后普通restore返回409 `ASSET_NOT_RESTORABLE`，不是看到文件还在就恢复。
- 经历仅暂停后可删除，未暂停409 `MUST_PAUSE_FIRST`。pendingOperationIds明确仍待核对，不等于取消/退款。restore恢复为暂停，旧任务继续安全核对。
- 历史不可变版本读取须仍在当前owner可保留数据范围；不因父草稿删除破坏旧经历，不提供无权限的全库version遍历。
- 回收、备份和导入采用内部用例/显式工具，本版没有伪装已经实现的管理HTTP路由。

## 5. 供应商绑定、报价与付费准入

`provider-models`返回精确providerId/modelId、适配/能力版本与验证状态。M1可登记unknown候选以保存设定，available=false；**未知能力不能取得付费报价**。不将用户口中的“H3 Max”直接认定为已验证官方API型号。

创建provider-binding接connectionId、catalogId、bindingKey、aspectRatio；connection必须属于当前owner可用的宿主连接登记，且与catalog部署匹配。公开目录/绑定同时返回connectionId及region，不返回账户秘密或任意baseUrl。凭证由宿主配置查找。binding版本不可变，经历固定某一版本，不随默认供应商变更。credentialConfigured不是“调用已验证”。完整能力约束（分辨率、时长、输入个数等）存在服务端能力登记，客户端不可绕过它。

### 5.1 创建不等于开始

`POST /experiences`零模型调用，创建setup节点/空回应草稿，status=preparing，media=null，初始预留/支出为零。创建事务必须保存Experience.budgetLimitMicros/budgetCurrency；GET的limit由这两个持久字段映射，重启不换默认额度。M2先沿用此limit真值再增加预留/账本，不为迁移丢失用户初始值。M1尚无任务表时仅映射这些初始DTO，所有付费allowedActions=false；不编造进度。

正常开场：create → acquire lease → quote(start+expectedExperienceRevision) → 展示费用/素材 → start(control+expectedExperienceRevision+acceptedQuoteId) → 202 → 查询operation/订阅events。

片段后：建议或自由输入 → quote(intent) → 已有可覆盖的同范围明确授权或本次确认 → intent → 202。UI可把确认收在轻浮层，不为隐藏费用而省略授权。

### 5.2 Quote 是有界授权对象

Quote.executionProfileVersionId固定规划/视频/检查各阶段模型、提示/graph/schema及预算策略；用户仍只需选择视频供应商，其他阶段由可审核宿主配置绑定。完整边界见[Provider规范](../architecture/PROVIDER-DESIGN.md)。

服务端根据固定模型能力/计费版本，确定性计算上界，**报价不调用LLM或视频模型**。缺少可计算的上界就422 `CAPABILITY_UNAVAILABLE`；不以假价格绕过。

Quote记录owner/storeEpoch、经历剧情revision、节点、规范化动作内容、绑定版本、全部参考素材及衍生处理规则/用途、输入内容摘要、参数、币种、价格版本、有效期和覆盖范围。actionHash覆盖这些值；客户端提供quoteId，不提供可篡改的价格作为授权。

Quote.generationSummary是可展示的确认摘要：精确providerId/modelId、有效时长/宽高/比例、audioMode（native或silent）、promptSummary，以及每张输入图的assetId/purpose/processingSummary。inputAssetIds必须等于摘要输入的去重ID集合。UI据此展示“发送哪些图、作何用途、是否有声音、生成规格、最高费用”，不能让用户对着不可逆hash确认。摘要也是hash绑定内容，接受quote代表接受该摘要。真实分辨率/时长受官方能力约束；示例值不代表已验证模型支持。resolution返回所选模型规格标签；dimensionMode=exact时width/height必为已知整数，provider_resolved时二者为null，UI显示比例和规格，不显示猜出的像素。实际媒体像素由导入检查读取。无声输出必须清晰显示并由用户明确接受，不自动掩盖原生音频能力缺失。

Quote前固定授权包络，而非尚未生成的最终导演提示词：promptSummary描述玩家动作和已固定上下文，不伪称最终模型输出。规划后形成不可变PreparedGeneration，必须验证实际素材/用途/规格/profile/费用处于授权范围，再登记请求摘要并发出。超出包络进入needs_attention，重新报价确认。临时签名URL可轮换而素材hash/处理语义不变；已未知提交时不换URL重提。

- start/retry报价也带预期剧情revision。intent报价绑定具体suggestion或free文本；修改输入、设定/模型参数或素材即失效。
- 已选suggestion的实际utterance由服务器节点数据解析；不信任客户端替换的候选文案。用户修改建议后作为free文本重新报价。
- start/intent/new_attempt接受时原子校验quote有效、动作匹配、控制权、当前节点、余额，预留maxCost并一次性消费quote；重复命令只回放，不二次预留。
- maxCost覆盖includes列明的规划、视频、检查、传输、有界修复。报价未列明的付费步骤不执行；不能先按视频报价、随后无限调用付费agent。
- Quote过期只限制**新接受**；已接受的回合持久化原授权与预留，暂停/重启后仍受原上限约束。Resume不是新费用授权，也不扩展次数/范围。需加价/新尝试则新报价新确认。
- 全部金额同币种；不自动汇率换算。`unresolved`是`reserved`的子集，表示其中尚不明确的支出，**不重复扣减**。可用额度=`limit-settled-reserved`；未明确任务不能释放预留。
- 本版不提供任意充值/改预算接口。需要追加经历预算时另立明确确认命令；预算耗尽允许保存、查询、退出。

## 6. 控制权、回应、播放与暂停

### 6.1 一次只有一个控制窗口

`POST /control-lease`的kind为acquire/renew/takeover：

- acquire：clientInstanceId由窗口生成。已有未过期其他窗口lease则409 CONTROL_CONFLICT；同窗口应renew而不是重复acquire。
- renew：带完整ControlProof，只延长当前epoch许可，不解除暂停/删除，也不新建任务。迟到旧epoch或过期令牌409 LEASE_EXPIRED。
- 快照controlSummary提供当前leaseEpoch、clientInstanceId、expiresAt及expired，首次无租约时为null，不含秘密。新窗口从该摘要取得接管前置版本。
- takeover：用户显式确认，带expectedLeaseEpoch；增加epoch并废止旧lease与旧播放实例。接管本身不resume、不生成。
- lease期限与renewAfterMs以服务端返回为准；客户端不硬编码。到期暂停新增付费派发；在途任务仍核对，不宣称续租失效等于供应商取消。
- 控制token只在签发响应中出现，不进快照/SSE/普通回执。快照allowedActions是显示提示，每条命令仍重新验证，不是授权令牌。
- 保存草稿仅需owner与CAS，允许另窗口编辑并提示冲突；发送/播放/暂停/恢复需要当前有效lease。过期后先重新获取控制；未取得前本地保留未发送内容。

### 6.2 节点与参与

setup节点suggestionState=not_applicable、无建议且freeInputAllowed=false。正常decision节点suggestionState=ready，提供2–4个情境建议与自由输入。建议由本轮场景/状态产生，非固定ABCD；视图可收纳，但不能让用户面对没有方向的空框。

建议失败时保留decision节点与草稿，suggestionState=unavailable、suggestions=[]、freeInputAllowed=true；UI明确提示建议暂不可用并给“你可以描述想说的话或想做的事”的引导，不制造假选项，不因建议失败推进剧情。`POST /experiences/{id}/interactions/{interactionId}/suggestions/retry`仅从持久提案做本地解析/校验，无外部调用/新增费用；200返回Interaction，仍失败409 SUGGESTIONS_UNAVAILABLE。成功只更新该节点建议和领域事件，不消费节点、不改剧情revision、不重新生成视频；已ready则返回现有建议，不随机替换。若未来需要新付费LLM生成建议，必须先扩展有界授权协议，本版不隐式执行。

节点属于确定experienceRevision。只有播放完成检查与事实事务成功后，status=awaiting_input且allowedActions.respond=true，才开放提交。保存文字不是提交；在播放/生成中不开放自由介入。

创建decision节点时同事务创建空ResponseDraft（draftRevision=1），客户端据此CAS保存，无“首写版本猜0”问题。旧节点草稿不自动搬到新节点发送；复制需用户明确动作。

### 6.3 播放实例与事实

1. createPlaybackInstance带segmentId+control；生成当前实例并废止旧实例。取得播放实例不自动开放付费调度。
2. reportPlayback使用单调sequence，从nextSequence开始；不带普通Idempotency-Key。相同instance+sequence+相同payload重放ACK；同序异载荷409；旧instance/旧epoch拒绝。
3. 合法seek可以位置变小；按序号判断新旧，不能用position必须递增禁止用户回看。服务端验证position<=实际时长，完成信号与片段/实例对应。
4. completed是播放证据，不直接代表事实。ACK的factCommitState可为pending；客户端等权威awaiting_input与节点，不能自行显示新选项/推进剧情。
5. 事实事务幂等。供应商成功、技术可播放、语义检查通过、播放证据是不同阶段。客户端遥测不用于敏感授权或实际观看的强证明。

### 6.4 保存与恢复

正常离开：先flush播放进度并取得ACK → pause提交最新draft（若有）+expectedRowRevision+control → 服务端原子保存草稿及**已确认**播放位置、设暂停并递增dispatchEpoch → 返回200后导航。

任一CAS失败整笔不接受；UI保留输入、重取快照，用户确认后新键提交。pause不把浏览器未发出的遥测虚构成服务器已存。断电/pagehide只有尽力保存；服务端回执才可展示“已保存”。

暂停前已经发出请求可继续计费；响应pendingOperationIds列出在途项目。网络派发短门锁与暂停准入详见架构时序图。Resume只恢复调度资格，先查旧operation，不重新发送未知提交。

## 7. 故障、重试与费用核对

快照.recoveryTarget提供当前待恢复turnId、operationId（可空）、allowedRetryModes、reconcileRequired；任务已失败且费用结清时也保留，不仅依赖pendingOperationIds。重开页面无需旧202或旧命令键即可构造重试报价/请求。只有该回合恢复成功、明确结束或被合法新状态取代才清空；未知提交时allowedRetryModes=[]、reconcileRequired=true，服务端仍独立复核权限/状态。

官方任务查询有供应商保留期限。内部operation保存queryUntil；过期停止无效自动轮询，attentionCode=PROVIDER_RETENTION_EXPIRED，保留费用责任并走受控核对；404/空列表不作为未收费证据。具体资料与门槛见Provider规范§6。

- operation.status描述**供应商操作**，succeeded并不承诺媒体检查/游玩完成。经历有独立status；不能用一个loading布尔值合并。
- 202返回turnId、operationId和statusUrl，表示已持久接受。客户端只查询/订阅，不通过重复调用start催进度。
- submission_unknown：保留预算预留，只允许reconcile/保存离开；无taskId且官方无可验证幂等/检索能力时进入人工处理，不自动猜测失败重提。
- retry.local_recovery：同turn/既有operation，重试本地导入/技术检查或原来已明确授权的无新增费用恢复，不另建视频调用；202可返回原operationId。涉及新的付费检查也必须new_attempt报价。
- retry.new_attempt：只有已明确旧任务状态/费用并允许重试时建立新attempt/operation；有新quote，仍不二次消费原互动节点。
- reconcile只核对既有任务/费用，不创建新生成。若供应商查询收费，只在原报价覆盖的有限轮询额度内执行，额度不足转needs_attention；不假定所有查询免费。
- 删除经历后，owner仍可读取operation和请求核对；不暴露凭证或外部敏感任务参数。

| HTTP / code | retryAction | 客户端处理 |
|---|---|---|
| 400 INVALID_REQUEST / INVALID_CURSOR | none | 修正输入/游标格式，不自动重试 |
| 401 AUTH_REQUIRED | reauthenticate | 重新建立会话，保留本地草稿 |
| 403 ORIGIN_REJECTED / CSRF_REJECTED | none | 显示连接/安全错误，避免循环 |
| 404 NOT_FOUND | none | 查询回执时按§3处理；资源页面提示不可用 |
| 428 PRECONDITION_REQUIRED | refresh_snapshot | 获取ETag/版本，确认后新命令 |
| 412 REVISION_MISMATCH；409 NODE_STALE / REVISION_MISMATCH | refresh_snapshot | 保留输入，展示冲突；不自动应用到新节点 |
| 409 CONTROL_CONFLICT / LEASE_EXPIRED | refresh_snapshot | 续租/重新获取或显式接管 |
| 409 IDEMPOTENCY_CONFLICT | none | 同键内容错误，禁止静默换键执行 |
| 409 OPERATION_UNCERTAIN | reconcile_operation | 查询/人工核对，保留预留 |
| 409 SUGGESTIONS_UNAVAILABLE | none | 保留节点/草稿，自由回应入口仍可用 |
| 409 MUST_PAUSE_FIRST / ASSET_NOT_RESTORABLE | none | 暂停后删除/展示不可恢复状态 |
| 410 CURSOR_EXPIRED | refresh_snapshot | 重取快照+新流身份 |
| 410 ASSET_MISSING | none | 缺失/已回收媒体，保留存档，不自动重生成 |
| 413 UPLOAD_TOO_LARGE；415 UNSUPPORTED_MEDIA | none | 更换文件，原素材不变 |
| 422 CAPABILITY_UNAVAILABLE / BUDGET_EXCEEDED / QUOTE_EXPIRED / QUOTE_MISMATCH | none | 展示原因；调整后重新报价与确认 |
| 429 RATE_LIMITED；503 DATABASE_BUSY | same_command | 遵循Retry-After，有限退避，保持原键原内容 |
| 500 INTERNAL_ERROR | none | 保存requestId，先查命令/任务，不能推断未扣费 |

`retryable=true`仅表示可自动进行**相同命令**的有限网络/本地事务重试，不授权新生成。refresh/reconcile/reauth这类为恢复动作而非重发授权，retryable=false。发生超时先查回执。OpenAPI列出共享错误集合，具体合法组合以此表及端点语义为准。

## 8. 媒体与事件流

### 媒体

`GET /assets/{id}/content`按owner及历史引用授权。输出受控同源路径，不返回本地磁盘地址、供应商临时下载地址或密钥。用户上传图片与已验证生成视频共用AssetStore；前者V1图片类型白名单，后者须经过媒体导入检查。

支持单bytes Range；完整200，部分206附Content-Range，无法满足416附`bytes */size`；If-Range不匹配返回完整200。不承诺multipart range。媒体ETag基于不可变字节，与元数据revision不同。默认`Cache-Control: private, no-store`；未来缓存需单独处理删除/授权撤回。技术语义依据 [RFC 9110 Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-range)。

### SSE：状态，不是视频帧

1. GET experience在**同一数据库读快照**取得DTO、lastEventSequence、eventStreamId与eventCursor。eventCursor=`eventStreamId:sequence`。
2. 首次订阅带after=eventCursor；重连使用Last-Event-ID。两者同时存在必须相同。客户端选定一种重连机制：fetch-stream手动更新cursor，或重建EventSource URL；不保留旧after又附新Last-Event-ID。
3. 事件格式：`id: <streamId>:<sequence>`，`event: domain`，`data: <EventEnvelope JSON>`。数据包含独立eventId、sequence、eventStreamId、schemaVersion、experienceId、occurredAt、type、payload。
4. V1类型仅experience.snapshot / operation.updated / response_draft.updated。一个经历内序号递增，客户端按流身份+序号去重；发现缺口先补事件或刷新快照，不自动新建任务。
5. 保留期外或旧store世代cursor：建流前410 CURSOR_EXPIRED；已建流时发送无id的`event: stream.reset`及StreamReset后关闭。未来序号400 INVALID_CURSOR。心跳用注释，不写数据库事件。
6. 备份恢复必须在开放API前轮换并持久化storeEpoch/eventStreamId，同时废止旧session/lease/未接受quote。不能只从备份恢复旧数字序号，否则前端可能丢弃新事件。已接受外部operation仍核对，仍不重生成。
7. BFF禁缓冲，断流重连有退避；token不放query。浏览器用同源cookie，桌面fetch流使用Bearer。媒体字节不经SSE，临时模型token也不冒充已提交领域事实。

SSE的id、Last-Event-ID与注释机制依据 [WHATWG规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)。流世代、快照一致性、过期码是本项目自定义保证，需M2故障测试，不是标准自动提供。

## 9. 完整调用示例与验收

`examples.json`提供正反schema样本；这里的HTTP顺序是设计，不是当前路由实测：

```text
POST /stories                           -> 201 + ETag
POST /stories/{id}/versions              -> 200（If-Match + 幂等键）
POST /experiences                       -> 201（零模型调用）
POST /experiences/{id}/control-lease     -> 200（acquire）
POST /experiences/{id}/quotes            -> 201（start动作与剧情revision）
[用户确认本次上限和素材]
POST /experiences/{id}/start             -> 202（acceptedQuoteId）
GET  /experiences/{id}                   -> 快照+eventCursor
GET  /experiences/{id}/events?after=...   -> SSE
POST /experiences/{id}/playback-instances-> 201（已验证segment）
POST /experiences/{id}/playback          -> 完成证据，等待事实/节点提交
PUT  /experiences/{id}/response-draft    -> 200（可选编辑，只保存）
POST /experiences/{id}/quotes            -> 201（intent动作）
POST /experiences/{id}/intents           -> 202（接受回应）
POST /experiences/{id}/pause             -> 200（保存成功再离开）
```

交付验收分层：A机器文档合法；B样本schema与结构不变量；C真实HTTP/Prisma/并发/故障；D真实供应商费用与产品两轮体验。**A/B通过不代表C/D通过**。本次结果见验证记录。


## 技术方案1.2差异说明（不改历史REST wire）

当前实现按T3/tRPC逐项冻结；上述REST路径、HTTP envelope和状态码属于历史候选，不新增同义REST客户端。新分支候选见[专项契约](BRANCH-CONTRACT-DRAFT.md)，不在现有47操作内，也未注册到AppRouter。

- 原decision本经历播放证明保持；唯一新增设计是child-owned fork_base经不可变origin证明继承已确认Snapshot，新节点/建议ID及空稿独立，不接受任意跨经历媒体作为证明。
- 正式预算首次实施即加入BudgetScope根树总上限；Experience额度是本路线新增消费子上限，同一费用记录带两个作用域，不重复扣账。unknown责任阻断scope新付费派发，不禁止零调用回看/fork。
- 原线继续后仍可从历史稳定Savepoint分叉，不要求当前剧情revision倒回；来源owner、生命周期、hash、素材引用与兼容性必须事务复查。
- 回看不调用reportPlayback；先保存暂停当前路线再切换child。fork命令不取消source任务，也不复制Quote、许可或taskId。
- fork不提供换模型参数；固定来源保存点的初始执行profile。后续profile更改属于独立显式授权方案，不把Provider层的可扩展性冒充一期已上线换模型功能。

相应新Zod/wire、预算迁移与来源证明测试完成前，历史OpenAPI的implemented标识保持原样。
