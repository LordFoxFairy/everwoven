# M0-C2/C3：本机正式草稿存取垂直切片

承接已确认的C1后续顺序：本机初始化/会话 → 受保护tRPC → 同页面SQLite草稿存取 → 重启读取。不是生成链路或全量角色/素材交付。

## 宿主与边界

保持一个Next HTTP入口，常驻worker尚不创建。仅显式RUNTIME_DATA_DIR且APP_ENV=dev|prod，并经专用本机启动器启用正式存储；启动器实际固定监听127.0.0.1并注入本机启动标记，其他启动方式（普通dev/standalone/Docker）保持正式存储关闭。APP_ORIGIN还须为对应loopback origin，但它不作为网络隔离证明。远程Web仍保留原型能力，正式远程身份后置。

宿主数据放用户显式选择的绝对目录。受信父目录必须归当前用户且无group/other写权限，拒绝路径符号链接（系统根的已规范化临时目录例外须在进入可信父目录之前处理）。使用同一规范化目标的排他锁，从检查到ready发布持有；不自动夺取已有锁。以原子mkdir预留最终目录（0700），只由创建成功者写入；数据库与LocalProfile完成并关闭后，以wx/no-follow创建ready manifest（0600），读取端拒绝没有完整ready的目录。禁止普通rename覆盖目标目录，禁止初始化失败后递归清理可能由别人创建的目标。失败留下未ready目录供人工检查，选择新目录可重新初始化；不声称自动恢复半成品。重复初始化只验证已有完整宿主，不覆盖、不新增owner。安全文件使用不跟随链接的打开并fstat校验常规文件/owner/权限，目录属性在敏感步骤前后重检。OS同一用户的恶意进程不属于隔离边界，但不得以检查后覆盖的做法破坏其他进程创建的目标。

manifest仅存version、ownerId、environment及createdAt。会话属于宿主安全材料，独立受限目录，不新增业务表/外键。

- issueConnectionCode：256位安全随机连接码，磁盘只存其SHA256对应的记录，5分钟过期。
- exchangeConnectionCode：每个code记录用原子重命名领取，最多一次成功；先校验格式/过期/宿主，再签发256位随机session，磁盘只存hash索引记录；会话8小时绝对过期。领取后失败需重新签发code，不复用未知结果。
- authenticateSession：格式/文件/期限/owner/environment验证；logout删除该会话记录；进程重启后已有会话可继续到原期限，不能自动延长。
- 原始code仅本机CLI明确输出给用户，原始session仅通过HttpOnly SameSite=Strict Cookie返回，不写日志/URL/浏览器localStorage。只允许loopback HTTP开发；HTTPS cookie设置Secure。
- 数据目录/文件不得打包进Git或镜像。CLI不通过用户任意URL上传数据。

请求边界：所有正式写请求需要精确Host/Origin与固定自定义请求头，JSON体积限制，拒绝跨站和缺失Origin写请求。session兑换是独立安全端点，CRUD唯一tRPC。metadata保持兼容。身份只从服务器验证session取得，DTO不接受ownerId。

CRUD当前无后台副作用，每次受保护调用在受控生命周期打开/关闭DB连接；并发依赖既有SQLite事务/CAS，不宣称进程内global变量解决跨进程单实例。以后worker上线前补独立持久派发互斥。

## 宿主模块约定（runtime/src/host）

- initializeLocalHost(directory, environment): Promise<HostManifest>
- readLocalHost(directory, environment): Promise<HostManifest>（只读验证）
- issueConnectionCode(directory, environment): Promise<string>
- exchangeConnectionCode(directory, environment, code): Promise<{token:string;expiresAt:number}>
- authenticateSession(directory, environment, token): Promise<{ownerId:string}>
- revokeSession(directory, environment, token): Promise<void>
- withLocalStories<T>(directory, environment, token, work:(service:ReturnType<typeof createStoryDraftService>,owner:InternalOwnerContext)=>Promise<T>):Promise<T>

默认时间Date.now，测试注入时钟可使用内部options，但外部请求不得控制时间。初始化迁移使用仓库受控Prisma CLI路径，不经shell拼接。

## 页面与契约

同一“我的剧本”保留浏览器草稿入口；显式配置正式存储后提供“本机数据库”视图，不自动合并或迁移。正式编辑器只管理已支持的title/premise/playerRole/worldRules/tone，明确人物/图片尚待绑定。保存、删除、恢复使用稳定commandId；失败保留输入，同键重试；修改输入后必须新commandId。revision冲突不覆盖，不自动刷新丢稿。使用现有tRPC客户端、样式与组件，不搭第二网站。

正式操作：storyDrafts.create/get/list/update/delete/restore。复用内部校验，公开错误脱敏。session端点GET查询状态，POST连接码换会话，DELETE退出；返回只含authenticated/expiry等必要状态。

## 验收门槛

- 新目录初始化、重复初始化不增owner；未授权目录/符号链接/损坏manifest/环境不匹配停止。
- 连接码过期/并发重复兑换最多一个成功；失效session拒绝；logout后原token失效；秘密不出现在日志、DTO或持久原文。
- 无会话/跨站/缺失Origin写入数为0；输入ownerId拒绝。
- 实际tRPC CRUD、幂等/CAS/软删除恢复；新连接/新宿主对象读回同一数据库。
- 浏览器真实登录→创建→修改→软删除→恢复→刷新，并在服务进程重启后读取同一草稿。
- demo不触发初始化、不自动迁移；正式失败保留输入。
- 主仓测试/typecheck/build、独立审查；不发布新的生产镜像，不宣称backup/worker/生成已闭环。

## 首轮安全评审修订

补齐两个P1设计项：初始化采用可信父目录、共享排他锁、mkdir no-replace预留及最后ready发布；正式模式只通过实际绑定127.0.0.1的本机启动器启用。加双进程init、目标竞争、符号链接/权限拒绝及实际监听验收。绑定标记来自可信启动环境，不是公开HTTP凭据；用户自行篡改启动代码/环境不在产品可保证边界。

## Implementation review corrections

- A lost mutation response is an **unknown outcome**, not proof of failure. The editor retains the original command and payload, preserves navigation protection even if inputs match the old baseline, and reconciles the original command before saving edited content. In particular, a lost create response must not lead to a second create when the user edits the title. Reconciliation must not discard newer in-memory input.
- Untouched `worldRules` arrays are preserved verbatim; a newline inside one valid rule is not silently split when another field is edited.
- SQLite sidecars may legitimately be unlinked between open and fstat as the last connection closes. Optional sidecar validation handles this with a bounded recheck; it does not relax manifest/credential permissions, ownership, symlink or hardlink rules.
