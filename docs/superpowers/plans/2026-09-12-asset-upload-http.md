# M1-C1c · 上传事务与HTTP接入计划

**依赖：C1a已验收；C1b私有文件端口仍在实施。此文件是下一切片计划，不表示路由可用。** 依据已批准的INTEGRATED-AUTHORING-M1第7节与Dewey对现有Host/HTTP代码的只读核查。不增加第二后端，不替代原页面。

## 最小切片

1. 上传意图Store/应用用例：begin/getUpload、processing/finalizing/终态CAS、事务回执、恢复与清理。
2. Host组合和tRPC：`assets.beginUpload/getUpload/completeUpload`；与既有story/character共享认证与资源边界。
3. 受保护二进制PUT/GET，以及有界接收器、真实临时宿主HTTP/重启/角色头像绑定验收。
4. 服务闭环后接C2原图片控件；本切片不创建新的上传管理页面。

## 唯一网络契约（待注册）

- tRPC三操作使用现有`contracts/asset`公开结构，不新增REST CRUD。
- `PUT /api/local-assets/uploads/:uploadId`：dataset使用专属header；内容是原始二进制，严格Origin/请求标记/真实session准入。
- `GET /api/local-assets/:assetId?datasetId=…`：普通同源img请求可无Origin，仍核实存在时的Origin、Host、Sec-Fetch-Site、cookie与dataset/owner。
- 具体header名称在实现时统一一处常量并写接口文档，不边做边产生两个名字。
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
