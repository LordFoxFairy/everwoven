# M1-C1 · 私有图片上传服务 Implementation Plan

**Goal:** 图片真实字节经过本机服务验证、持久化、读取、重启恢复，可由角色服务正式引用。不包含剧本聚合、ready资产GC或视频模型调用。

**Dependencies:** M1-B原角色库先完成浏览器验收。现有Asset/AssetUpload字段可复用；runtime声明精确直接sharp依赖，不依赖Next间接安装。M1-C2将本服务接入原图片控件，取代正式模式临时提示。

**Approved context:** INTEGRATED-AUTHORING-M1的图片协议已批准。Hegel只读实现核查补充了文件无覆盖发布、目录同步、过期finalizing回收和旧处理者迟到残留处理。本计划是实施拆分，不是再次让用户确认功能。

## 1. 契约和纯验证

- [ ] UploadIntentDTO与AssetDTO只含公开字段；字节数用十进制字符串，绝不透传storageKey/目录/processingToken/lease。
- [ ] begin固定dataset/command、原hash/原字节数/原始文件名/权利声明。ID和资产路径由服务端产生；文件名只是元数据。
- [ ] JPG/PNG/WebP魔数与实际解码双核验；最多10MiB，每边至少256、至多8000，像素至多24MP。拒绝动画/多页/SVG/URL/path/截断文件。
- [ ] EXIF方向归一，去元数据，最大边2048静态WebP；输出hash/真实宽高/字节数来自产物。
- [ ] 固定编码参数、解码并发、输出上限与处理超时；队列有界，不能无限驻留大Buffer。用实际生成的小型测试图片，不使用用户图片。

## 2. 私有文件端口

- [ ] Host内私有素材目录，目录0700/文件0600，检查owner/inode/no-follow；世代进入服务端storageKey。
- [ ] 有界二进制写入；不得把现有writeExclusive文本助手用于图片字符串化。
- [ ] 明确采用无覆盖发布原语并测试崩溃窗口。可选择O_EXCL直接写最终私有候选文件（ready之前绝不公开），避免先exists再rename覆盖；若选hard-link必须单独处理合法瞬态nlink=2，不能放宽通用安全检查。
- [ ] 完整写入与文件fsync、父目录fsync结束，核验hash/宽高/字节数后才允许完成。读取核验和返回字节来自同一已校验句柄。
- [ ] 部分文件/不匹配文件不“继续补写为正确”，拒绝准入并走终态清理。已完成文件缺失/损坏返回明确不可用，不用演练图冒充。

## 3. 上传用例、Store、恢复

- [ ] begin在owner WriteGate事务内写意图+回执；同命令同payload返回历史响应，状态另用get查询。
- [ ] PUT在读取body/创建文件前，完成认证/dataset/owner/意图状态检查；领取processing token/租约后，事务外流式计数/hash/解码。
- [ ] 持久化预期输出元数据，再无覆盖发布；published落库必须再次验证token/状态/租约，不允许旧处理者推进。
- [ ] complete先CAS领取finalizing token；核验文件后，一个事务内检查token/租约/状态，创建ready Asset+completed+命令回执。
- [ ] 恢复包括过期processing/finalizing；文件匹配可核对推进，缺文件可按原内容重传，不匹配停止。completed不被普通重传修改。
- [ ] 清理先CAS到不可逆deleting；同一assetId/storageKey从不用于另一个上传。complete失去token后零ready写入；completed永不进入本批清理。
- [ ] deleting保留终态记录，反复核对可能由旧处理者迟到发布的残留；不得一次unlink后就假设永无迟到文件。显式测试两种竞态顺序。
- [ ] 初始宿主锁不是运行期互斥；不把它写成并发安全证据。文件I/O/解码不持SQLite写事务。

## 4. Web边界

- [ ] tRPC assets.beginUpload/getUpload/completeUpload；二进制PUT与GET复用本机认证/来源边界，但不用JSON解析器消费图片。
- [ ] 超时、取消、Content-Length不可信、分块流超过上限、body中断均关闭资源；客户端不可传私有路径。
- [ ] get只允许同owner ready/未删除图片，无引用的ready图片仍可预览。返回受保护字节，不给供应商内网文件路径。
- [ ] 新增固定资产错误白名单/HTTP映射；任何错误不得泄漏路径、连接码、原始异常内容。

## 5. 主仓验收

- [ ] 三格式→WebP真实字节→get→重启→现有角色portraitAssetId绑定。
- [ ] 伪MIME/截断/动画/像素炸弹/流式超限/hash错误，零ready资产。
- [ ] begin/complete丢响应重放，同命令异payload冲突，同内容独立上传允许。
- [ ] 临时写、发布、published落库、ready事务/回执各崩溃点恢复。
- [ ] complete核验后cleanup先取得deleting，complete必须失败；complete先提交则cleanup不删文件。
- [ ] 租约过期旧处理者迟到发布、再次清理，跨owner/dataset/无session/foreignOrigin/symlink竞争全部覆盖。
- [ ] 主仓全量、typecheck、独立规格与代码质量审查；只在新建的隔离宿主验收，不清用户目录。

完成后进入M1-C2原图片控件与角色绑定，再剧本聚合。测试通过仅表示对应服务切片，不发总体闭环完成通知。


## 执行拆分与文件所有权（2026-09-12）

B的原页面生产Chrome验收已通过（5f037bf），开始C1；下面是单一协议逐层实现，不是多套功能。

1. **C1a（进行中）**：严格公开契约、image-normalizer端口与sharp真实解码。写集runtime/contracts/asset*、ports/image-normalizer、infrastructure/media、相关tests、直接sharp依赖和lock；Feynman唯一实现者。最多2个活跃解码，不建立无界等待队列；超时后必须等真实处理结束/取消才归还容量。
2. **C1b**：私有无覆盖文件端口，安全目录/句柄/持久化故障测试。依赖C1a规范化输出，不修改Web表现层。
3. **C1c**：上传意图与receipt/CAS/租约/清理状态、Host及HTTP边界、全上传HTTP与重启验收。
4. **C2**：接原图片控件、角色绑定和原剧本聚合，全流程验收后删除旧页面路径。

每层由主仓重新验证；契约/decoder完成不等于文件持久化或上传API可用。主会话维护docs/CI，其余writer不并发修改这些文件。


## C1b 文件安全边界补充（Hegel只读核查）

纯Node22（macOS/Linux）不声称提供openat/dirfd或条件unlink原子语义。防御HTTP不可信输入、其他OS用户和合作worker；同UID恶意进程/管理员已属宿主失陷，不宣称受保护。

- 私有素材根与dataset目录运行期稳定，不允许应用重命名/替换/递归删除；reset须阻止新启动，并确认全部宿主/worker/在途文件操作停止。过期租约不是进程已结束。
- 验证整条祖先目录链：拒绝其他OS用户可替换路径分量的非sticky共享可写目录；OS临时根必须单独核实sticky及目录所有权。现有targetDirectory只检查直接父目录权限，不能拿它单独当整链证明；C1b补独立素材根验证，不扩张成旧数据兼容。
- 端口实例绑定初始目录身份，发现变化即失效，不自动采纳替代目录。反复recheck只是检测，不是无TOCTOU证明。失败worker仅关闭句柄，不自动unlink固定候选。
- `writeCandidate(assetId, normalizedBytes, expected, signal)`返回durable证据/exists/失败；O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW，短写循环、file sync、同handle读回核对、目录sync。EEXIST不等于成功，不覆盖、不补写。
- `verifyCandidate(assetId, expected)`从同一个被核验句柄返回实际Buffer/hash/宽高/字节数；不得检查后重新按路径读取。
- `removeDeletingCandidate(assetId, deletionPermit)`只由C1c不可逆deleting状态授予，cleanup同asset串行；只删除未完成意图残留，completed永不发许可。检查后unlink不是按inode原子删除；依赖合作进程命名空间规则，异常保留残留。
- partial、fsync失败和迟到writer创建的文件归原意图终态清理。删除失败保持deleting供重试；不恢复为reserved，不重用assetId，不由失败writer删除其他任务的文件。

测试包括整链权限、symlink/身份可检测变动、无覆盖竞争、短写/中断/file+dir sync故障、同handle返回、cleanup交错。不得用这些测试宣称抵御任意同UID恶意TOCTOU；macOS与Linux都需实际验证。当前HTTP入口核查未发现可由请求重命名素材祖先的路由。
