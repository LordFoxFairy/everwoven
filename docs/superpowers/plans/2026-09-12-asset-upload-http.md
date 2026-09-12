# M1-C1c · 上传事务与HTTP接入计划

**依赖：C1a/C1b本地验收通过，08de822已推送，C1b Linux CI34718307948成功。C1c-3入口现已注册并通过真实生产HTTP验证；下列原始清单保留实施意图，最终证据及尚未闭合事项见文末。** 依据已批准的INTEGRATED-AUTHORING-M1第7节与Dewey对现有Host/HTTP代码的只读核查。不增加第二后端，不替代原页面。

## 最小切片

1. 上传意图Store/应用用例：begin/getUpload、processing/finalizing/终态CAS、事务回执、恢复与清理。
2. Host组合和tRPC：`assets.beginUpload/getUpload/completeUpload`；与既有story/character共享认证与资源边界。
3. 受保护二进制PUT/GET，以及有界接收器、真实临时宿主HTTP/重启/角色头像绑定验收。
4. 服务闭环后接C2原图片控件；本切片不创建新的上传管理页面。

## 唯一网络契约（C1c-3已注册）

- tRPC三操作使用现有`contracts/asset`公开结构，不新增REST CRUD。
- `PUT /api/local-assets/uploads/:uploadId`：dataset使用`x-everwoven-dataset-id`header；内容是原始二进制，严格Origin/请求标记/真实session准入。
- `GET /api/local-assets/:assetId?datasetId=…`：普通同源img请求可无Origin，仍核实存在时的Origin、Host、Sec-Fetch-Site、cookie与dataset/owner。
- header统一`x-everwoven-dataset-id`，实现时放一处常量，测试与接口文档使用同名。
- nodejs动态route只委托handler；不经过现有JSON body接收器处理图片。

## PUT不可颠倒的时序

- [ ] 方法/Host/Origin/标记/服务端配置/cookie存在性检查。
- [ ] Host真实认证；严格解析ID/dataset并与宿主比对；按认证owner查询意图。
- [ ] 校验状态、过期和租约；CAS领取processing token，结束短事务。
- [ ] 取得有界接收容量，之后才惰性调用openBody/getReader。容量覆盖慢上传和留存buffer，不只靠decoder两槽。
- [ ] 按数据库意图原大小/hash读实际chunks；EOF精确一致，解码真实图片。
- [ ] 复核宿主/世代和处理权；持久预期output元数据；再调用文件工厂创建私有目录并无覆盖发布。
- [ ] published更新仍验证token/状态/租约，旧处理者零状态推进；文件I/O不持SQLite写事务。

组合根只注入惰性`openFiles`工厂，不因创建AssetService就mkdir。begin/getUpload、准入失败、原hash/大小错误都不触发资产目录初始化。complete在回执/状态校验及finalizing CAS后才打开文件。

## 接收器与资源释放

- [ ] `receiveImageBody({openBody,signal,expectedSize,expectedHash,maxBytes,deadline})`：只开一次reader，不接受客户端路径。
- [ ] Content-Length只作可选提前拒绝提示，不作真值；缺失/虚报较小仍按chunk计数。超过意图大小或10MiB立即停止。
- [ ] 空body、短读、中断、hash错零解码/发布；不用arrayBuffer/formData把无限正文一次装进内存。
- [ ] abort/deadline能打断挂起read；取消reader、释放lock和接收槽。cancel的异常不覆盖原安全错误。
- [ ] pending read取消不是原生decode硬杀；进入decode后沿用C1a实际工作结束才释放其槽。
- [ ] 分块上传接收与解码各有明确容量，不建立无界buffer队列。

## 状态、回执、恢复与清理

- [ ] owner WriteGate事务内begin意图+回执，同command同payload返回历史响应，状态另get。
- [ ] published前记录输出证据；complete领取finalizing后通过ensureDurableCandidate核验并补齐file/dir同步（不拿只读verify当durable），最终事务校验有效token/状态/租约，写ready Asset+completed+回执。
- [ ] 丢响应重放安全；租约过期允许明确接管，旧token零ready提交。
- [ ] cleanup先T1提交不可逆deleting，再由必选SQLite CleanupCoordinator在T2取得writer lock并复核身份/状态后执行同步小删除临界段；completed永不授删除许可；保留terminal记录重复处理迟到writer残留。见ADR-0009，禁止用现有3秒事务包异步FS造成超时提前释放锁。
- [ ] 覆盖核验后cleanup抢先、complete先提交、processing/finalizing过期、缺失/损坏/部分候选，禁止先删文件再判断DB状态。
- [ ] ready文件缺失/损坏明确unavailable并拒绝后续新引用；不得给演练图或假成功。M1不GC ready未引用文件，也不删历史引用。

## GET与公开错误

- [ ] owner+dataset相符且ready/未删除才读取；从C1b已核验句柄返回同Buffer，不再按路径重开。
- [ ] 完整核验后才发送200，固定image/webp；成功/错误均no-store、nosniff；本批不增加Range/重定向/可控Content-Disposition。
- [ ] 状态码用精确白名单：401/403、DATASET_CHANGED→412、不可见与不存在→404、状态冲突409、超限413、其余固定服务错误；以现有真实domain code统一映射，不泄原始exception/cause。
- [ ] 日志仅事件码、阶段、request/command ID及状态，不记录cookie、原图或私有剧情。

## 证据边界与验收

- [ ] image PUT准入失败测试openBody/read=0、资产工厂/资产目录/临时及最终图片创建=0，覆盖无效session、来源、dataset、owner、状态。
- [ ] “零图片文件”不混称“连SQLite sidecar都不打开”。现有DB连接配置WAL；若要求更强磁盘零副作用需单独证明，不能由惰性图片工厂推导。
- [ ] JSON tRPC仍有界读取body后进入Host真实认证；dataset在JSON中必然先读JSON再校验。图片PUT的零bodyread保证不泛称所有tRPC已经具备。
- [ ] 三格式真实字节→规范WebP→GET→重启→角色portraitAssetId绑定；auth/dataset/owner错误零图片副作用。
- [ ] 成功GET缺Origin合法；foreign Origin/旧dataset/删除/非ready/损坏不得200。
- [ ] 丢响应/同命令异payload/并发CAS、所有文件与DB故障点、迟到cleanup两种顺序；原有角色/演练/剧本root回归保持通过。
- [ ] 主仓全量+typecheck+实际生产构建/浏览器，独立规格再质量审查，更新PROGRESS与已实现接口文档；仅服务切片完成不通知总体完成。

C1c协调器需真实多进程与SIGKILL/超时验证，特别unlink后fsync前崩溃、旧FS未结束前第二个协调者不得进入；测试fake协调器不是生产互斥证明。

实际C1b接入签名为createPrivateAssetStore(host,binding,coordinator,faults?)；协调器必填，生产禁止work=>work()。其runExclusive必须原样返回同步callback产生的同一个结果对象，文件端口检查身份以拒绝未执行callback的伪结果。


## C1c-1 当前先行切片：真实清理协调器

- [x] 可信owner/dataset上下文与scope严格一致，错误在进入DB前拒绝。
- [x] T2获取真实SQLite writer lock后，查询本owner对应asset的唯一deleting意图；不存在/nondeleting/completed/混乱引用一律零callback；已有任何Asset记录（含unavailable/softdeleted）禁止清理，保护历史引用。
- [x] 原样返回同步FileStore callback结果，固定错误净化。不创建第二锁DB或永久文件锁。
- [x] 实测两个进程排斥、删除前/删除后fsync前SIGKILL、同步临界段超过事务timeout不提前放锁；状态保持deleting可重试，不仅用fake coordinator。
- [x] 此批允许直接seed完整AssetUpload记录模拟已提交T1，但不宣称begin/complete或T1服务已实现。Host认证由后续组合接入，不把可信context注入当真实HTTP认证验收。

写集由Feynman独占DB cleanup adapter与专属tests/fixtures；完成后主仓验证及独立规格/质量复核，再继续上传生命周期服务。

C1c-1独立规格Hegel PASS（实际28/28），主仓全量956/956及双端typecheck通过。Cicero质量审核及隔离生产回归仍在执行；T1/生命周期/HTTP依然未实现。

C1c-1最终：主仓956/956+双端typecheck；隔离生产构建和HTTP演练/原角色/原root三Chrome全部退出0。Hegel独立规格28/28，Cicero最终只读质量PASS（没有另跑全量）；无schema/Host/HTTP改动。


## C1c-2 / 有界接收器：落地决策补充

Dewey只负责新增图片接收端口/媒体实现/专属测试；Feynman只负责Asset应用/事务Store/composition/专属测试，写集不重叠，主会话维护文档并在主仓统一验证。不并发修改既有Host/HTTP或私有文件实现。

- 接收端口采用`withBody(source, expected, work)`而非裸返回大Buffer：两个无队列共享槽覆盖接收和后续work，避免接收完成就放槽、下游无限积压。默认接收30秒，接收结束清timer，实际work结束才释放槽；不把原生decoder的调用方超时当硬杀。
- 应用绑定可信owner/dataset及必选`revalidate`、惰性`openFiles`。HTTP真实组合仍在下一片，测试注入不冒充已认证HTTP。
- 默认意图24小时，processing/finalizing租约120秒；状态判定的Clock在取得WriteGate后读取。token/revision/output匹配不可省略。
- 完整候选写出但published未落库：过期processing且output完整允许complete领取finalizing，ensureDurable后原子提交ready/completed/回执。
- 缺文件重传直接让process领取无有效lease的processing/published/finalizing，保存原输入hash/大小；已有output必须与重新规范化结果一致。缺候选可无覆盖写入，partial/错误候选不覆盖修补。不得把带output记录伪装回reserved。
- 接收容量/abort/hash/解码失败且未持久output时，只有当前token可补偿reserved并清token/lease；旧token错误不能改变接管者。已有output的故障保留恢复证据，不能无条件清空。
- cleanup只接收failed/deleting或已过期意图，且没有有效租约、无任何Asset身份/路径别名；T1提交后调用既有T2。活跃可恢复意图不会因任意cleanup调用被删除。
- getBytes仅确证缺失/损坏才按CAS标unavailable；繁忙、超时、暂时I/O不永久降级。读回后再次核对Host与资产状态/版本，返回已核验同Buffer。

以上为本片执行决定；逐项实际验收后才在状态清单打勾，未有路由即不写可调用。


## Host / HTTP接线审核（Hegel只读结论，实施仍待C1c-2）

复用现有withLocalDatabase并内部扩展pinnedHost/revalidate，不复制整套assets宿主；stories/characters外部签名不变、统一disconnect。固定host/parent/runtime.db身份及manifest/owner/dataset，重验不采纳替换后的新对象；openFiles本身再次重验但仍保持惰性。验证点之后才发生的会话撤销不追溯撤回已提交操作/已发送字节，不能声称文件session检查与SQLite事务原子化。

Web新增local-assets访问器、assets tRPC router和二进制handler，两个App Router薄route标nodejs/force-dynamic。PUT用专属dataset header和既有x-everwoven-request标记；GET允许正常无Origin但检查存在的Origin/Host/cross-site。tRPC assets写命令补标记检查；现有来源/config提前返回缺nosniff分支同步补齐。

错误码需对照服务/接收器最终枚举冻结：会话401，来源403，参数/hash/意图大小不匹配400，不存在/跨owner404，状态/租约/幂等409，dataset412，实际超限413，格式415，容量/暂不可用503，未知500；不透传任意message/prefix。真实Host测试暂停在重验前撤销或换dataset/inode，验证旧绑定拒绝且零图片body/文件副作用；返回同Buffer且成功/失败都有no-store/nosniff。

C1c-2显式生命周期最终本地已验收：主仓1090/1090、双端typecheck、生产三Chrome；回执两次独立审查发现的问题已按ADR0010修复并复核。接收器50d67cb远程CI34720501448成功。下一片实际Host/HTTP接线；自动扫描与bounded maintenance尚未实施，不改为完成。

C1c-3实际派发：Hegel只写runtimeHost及专属测试；Feynman只写Web路由/handler/tRPC及测试，固定withLocalAssets绑定服务签名与dataset header。必须真实临时Host认证/撤销/身份替换和真实HTTP PNG→WebP→重连读回验证；fake access仅路由单元证据。全部写入结束后主仓统一验证，不将中途编译通过当后端已接通。

最终数据/维护验收补项：生命周期新增全局assetId身份核对查询，当前AssetUpload只有status/lease与owner/createdAt索引。聚合用例全部落地后，以真实SQLite EXPLAIN QUERY PLAN统一审查实际路径，必要时补非唯一assetId索引并同步单基线/门禁/DDL，而不是为性能加伪唯一。活跃Host/Web实现期间不并发修改schema。该项属于M1最终数据规范检查，不宣称已有性能验收。


## C1c-3本轮验证记录

- [x] Hegel真实Host绑定与重验；主仓专属34/34，Dewey Host规格74/74，Cicero Host质量PASS。
- [x] Feynman Web/tRPC/二进制真实接线；Dewey独立7文件93/93，含真实Host/独立Node重启读回。
- [x] 主仓重新运行runtime build、全量74文件1202/1202、双端typecheck，exit0。上轮丢失输出未作为证据。
- [x] 隔离最终生产build与四Chrome（新资产HTTP、演练、原角色、原root）exit0。CI新增同一资产smoke，远程结果需提交后另核实。
- [x] Cicero Web及新smoke最终质量PASS；撤销证据P2经mutation RED/GREEN关闭。打包路径增加1条真实Git回归后主仓最终75文件1203/1203及双端类型通过，准备提交本片，不标整个M1完成。

原始接收草案现由withBody端口取代，取消不settle时隔离占槽，并非立即释放；明确细节以接收器实施段/契约为准。生命周期显式cleanup真实，但仍无启动扫描/HTTP维护入口，后续有界维护需独立实施/验收。原图片控件尚未接线，不因HTTP成功而启用剧本正式图片假保存。
