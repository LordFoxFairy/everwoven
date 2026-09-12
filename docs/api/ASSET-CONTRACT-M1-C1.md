# M1-C1 · 图片协议边界

**2026-09-12，资产契约与实现边界。C1a～C1c-2内部实现已验收；C1c-3真实Host/tRPC/二进制路由已注册，隔离生产HTTP与浏览器解码已实跑。主仓最终全量与质量门槛见PROGRESS。原页面上传控件和自动维护尚未交付。** 验收状态见[PROGRESS](../PROGRESS.md)。实现类型在runtime的`contracts/asset`与`contracts/asset-validation`公开导出；不接受旧结构、不补默认字段。

## 请求与身份

| 类型 | 精确字段 | 含义 |
|---|---|---|
| AssetBeginUpload | datasetId, commandId, inputSha256, inputByteSize, originalName, rightsDeclaration | 首次提交固定的原文件意图 |
| AssetGetUpload | datasetId, uploadId | 查询当前意图，而非把begin历史回执当当前状态 |
| AssetCompleteUpload | datasetId, commandId, uploadId | 新完成命令；稳定重放规则由C1c事务实现 |
| AssetGet | datasetId, assetId | 读取当前数据集的正式素材 |

所有ID为UUIDv7；dataset不是认证凭据，Host从真实会话取得owner后再比对dataset。未知字段严格拒绝，客户端不传owner、磁盘路径、storageKey、处理token或租约。

- SHA-256为64位小写十六进制；原字节数为规范十进制**字符串**，1..10485760，拒绝数字类型、前导零、指数形式或隐式转换。
- originalName最多255个Unicode码点，非空；拒绝斜线、反斜线、控制字符、单独`.`/`..`，仅作元数据，从不选取读取路径或发布路径。
- rightsDeclaration非空、最多2000码点，保存原文本；它是用户声明，不是所有权的外部验证。
- 协议校验错误固定为INVALID_ASSET_COMMAND / INVALID_ASSET_QUERY / INVALID_ASSET_DTO；没有原始数据库或解码异常cause。

## 公开DTO

UploadIntentDTO包含`id,datasetId,assetId,inputSha256,inputByteSize,originalName,rightsDeclaration,status,outputSha256,outputByteSize,outputWidth,outputHeight,createdAt,updatedAt,expiresAt,revision`。

- status只取reserved / processing / published / finalizing / completed / failed / deleting。
- 四项output元数据必须全null或全有效；reserved要求全null；published/finalizing/completed要求全有效。processing/failed/deleting可持有完整输出信息，供后续状态恢复使用。
- 这只是DTO结构不变量，不表示任意两个状态可以转换；实际状态迁移、租约、清理和回执由C1c在事务中限制。

AssetDTO包含`id,datasetId,sha256,mimeType,byteSize,originalName,rightsDeclaration,width,height,status,deletedAt,createdAt,updatedAt,revision`。

- mimeType固定image/webp，status为ready或unavailable；byteSize同样为正十进制字符串，宽高1..2048。
- 时间为规范UTC ISO8601，revision为1..2147483647；deletedAt为null或合法时间。
- storageKey、owner、绝对目录、处理token和lease不出现在DTO中。后续网络序列化使用严格解析器，不直接返回Prisma实体。
- `AssetCommandResult<T> = {data:T,replayed:boolean}`用于历史命令回执；C1c-2事务实现已本地验收，网络沿用同一严格结构。

## 真实图片处理端口

`ImageNormalizer.normalize(bytes: Uint8Array, expected: {inputSha256,inputByteSize})`只接收字节，拒绝路径/URL/流对象，不主动fetch。先快照调用者输入，校验实际长度与hash，再检查容器及完整像素。

| 层 | 限制 / 行为 |
|---|---|
| 原图 | JPEG/PNG/WebP，最多10MiB；每边256..8000，总像素最多24,000,000 |
| 格式 | 魔数与真实decode一致；拒绝动画、多页、SVG、截断及不一致容器 |
| 规范化 | EXIF方向归一、完整RGBA像素解码后重新编码，剥离源元数据 |
| 输出 | 最大边2048，不放大；静态WebP，quality80/alphaQuality100/effort4，非lossless/nearLossless/smartSubsample；最大10MiB |
| 元数据 | 来自实际产物的SHA-256、字节数、宽高与mime，而非沿用客户端声明 |
| 资源 | runtime进程共享最多2个活跃作业，无等待队列；默认10秒，可由服务端缩短，不能延长或关闭 |

满槽返回IMAGE_DECODER_BUSY。超时可以先向调用者返回IMAGE_PROCESSING_TIMEOUT，但**仍在运行的原生处理继续占槽**，直到实际回调结束，绝不提前归还容量后无限启动新作业。sharp的原生timeout不是进程强杀；metadata处理长时间未结束仍占槽，pipeline timeout不提供metadata硬取消。两槽共享仅限当前进程中的该模块；输入/像素/并发上限也不等于OS级RSS硬限制。需要后续生产容量测量，不宣称这些限制已经提供隔离进程保障。

其余固定图片错误：INVALID_IMAGE_INPUT、IMAGE_TOO_LARGE、IMAGE_HASH_MISMATCH、IMAGE_SIZE_MISMATCH、UNSUPPORTED_IMAGE_FORMAT、INVALID_IMAGE_DATA、IMAGE_DIMENSIONS_INVALID、IMAGE_ANIMATED、IMAGE_OUTPUT_TOO_LARGE。公开错误不包含原图片、文件路径或原生诊断。

## 后续接入门槛

1. C1b：可信私有目录、无覆盖候选、文件与目录fsync、同句柄核验/读取。
2. C1c：认证/世代在读body之前；有界二进制HTTP；意图/回执/租约CAS、重启与终态清理。
3. C2：原图片控件经AssetPort上传和预览，保留dataset来源，正式角色/剧本绑定真实Asset；解绑不是删文件。

没有这些门槛的实跑证据，不把C1a解码成功描述为上传成功或创作全链路完成。


## C1b内部文件端口（本地已验收，非HTTP接口）

工厂为`createPrivateAssetStore(host, binding, coordinator, faults?)`。binding绑定可信owner/dataset，CleanupCoordinator必填；即便实例只供读取/上传，也不注入生产占位`work => work()`。工厂会创建私有目录，业务调用方必须在真实session、客户端dataset及owner/意图状态检查后才惰性调用。

| 操作/结果 | 证据与用途 |
|---|---|
| writeCandidate → durable | 完整核验、file及目录同步成功；尚未是DB ready |
| writeCandidate → exists | 名称已存在，不表示内容正确或已持久化 |
| verifyCandidate | 同句柄核验返回实际Buffer，供受保护GET；只读、不是durable |
| ensureDurableCandidate | exists/崩溃残留核验后补file及目录同步，不补写/覆盖/修复错误文件 |
| removeDeletingCandidate | 内部删除permit与必选协调器共同约束；仅终态残留，非用户资产删除API |

协调器必须在已提交deleting后取得实际SQLite writer lock，再复核身份和状态，同步调用删除callback并原样返回**同一个结果对象**；锁覆盖真实工作。T2失败不恢复已删除文件或上传状态。文件端口不查数据库，不证明其permit签发前真的发生过CAS；该职责属于C1c。

C1b共享输出验证器与normalizer的两槽预算，验证规范WebP不会再有损重编码，也不误用原图最小256边限制。同步cleanup临界段不包含图片读取/解码/网络/大Buffer。

私有文件异常均为固定标识，不附带path/cause。网络如何映射这些异常由C1c用例与Host白名单实施后补写；实际映射见下方C1c-3。


## 有界接收器（内部，非HTTP路由）

`ImageBodyReceiver.withBody(source, expected, work)`；source提供惰性openBody与可选AbortSignal，调用前由用例完成准入。两个共享槽覆盖接收与实际work，无排队；接收最多30秒，实际长度/原hash核验后才调用work。槽不是在返回Buffer时释放。每次只注册当前read的中断处理，不随微chunk累积Promise订阅。

接收中止/超时先返回固定错误、尝试cancel和释放reader锁；cancel一直pending时隔离保留该槽，最多两处，不宣称底层已取消。work内部领域错误原样交应用/Host，source异常净化为固定IMAGE_BODY错误。HTTP内容长度仅作提示；实际接收仍检查原意图大小/hash。浏览器上传控件属C2。

## C1c-2应用生命周期（已通过真实Host暴露）

- begin/getUpload/process/complete/getBytes/cleanup均绑定可信owner/dataset；按严格公开输入执行，文件工厂与正文保持惰性。
- begin同事务意图+回执；24小时意图TTL，processing/finalizing租约120秒。新claim在TTL后拒绝；有效期内已领取且租约仍有效的token可完成。completed历史回执仍可重放。
- output元数据提交后才发布文件；exists不是成功证据，必须ensureDurable。complete在有效token/revision/lease条件下同事务ready+completed+回执。
- 显式complete可恢复完整候选未published；缺失可process原hash/大小重传；partial/损坏不覆盖修补。清理先提交deleting再T2同步删除，重复deleting保持可重试。
- 当前没有启动扫描/自动调度，不能把这些显式用例描述为自动恢复服务。真实Host/HTTP另有认证、撤销、身份替换及进程重启测试；内部可信上下文测试本身不作为认证证据。

回执身份设计增量见[ADR0010](../architecture/adr/0010-asset-begin-identity.md)：begin采用服务端uploadId与receipt主键共享创建身份，不以response.id自证；complete维持独立receipt身份，首次写入与重放均核对固定意图/素材字段。当前已通过本地最终回归，HTTP严格沿用此回执协议。


## C1c-3 · 已注册的网络入口

所有入口同源、Node运行时，复用既有本机会话cookie，不在URL传token。不存在演练数据或匿名文件fallback。

| 入口 | 输入 | 成功响应 |
|---|---|---|
| `POST /api/trpc/assets.beginUpload` | 严格AssetBeginUpload | tRPC封装AssetCommandResult<UploadIntentDTO>；首次reserved |
| `GET /api/trpc/assets.getUpload?input=…` | JSON编码AssetGetUpload | tRPC封装当前UploadIntentDTO |
| `PUT /api/local-assets/uploads/:uploadId` | `x-everwoven-dataset-id` + 原始二进制 | 200，严格UploadIntentDTO，status=published；不是ready资产 |
| `POST /api/trpc/assets.completeUpload` | 严格AssetCompleteUpload | tRPC封装AssetCommandResult<AssetDTO> |
| `GET /api/local-assets/:assetId?datasetId=…` | 单个datasetId query，不接受其他query | 200，已完整核验的WebP字节 |

写请求沿用`x-everwoven-request: 1`及合法Origin。普通GET可以不带Origin，但存在时仍校验，另查Host、cross-site、cookie和真实session。二进制路径不经JSON/formData接收器；PUT准入后惰性打开body。Content-Type可缺省，或application/octet-stream / image/jpeg / image/png / image/webp；客户端名称/type不能代替真实解码。Content-Length可缺省，存在时须十进制且≤10MiB，实际接收长度/hash始终以意图为准。GET忽略Range并返回完整200，不伪装206，不重定向到裸磁盘文件。

二进制错误为`{error: 固定消息}`；tRPC保留标准错误封装。成功及错误都带`Cache-Control: no-store`和`X-Content-Type-Options: nosniff`。错误清单以`apps/web/server/asset-errors.ts`为精确白名单，不按字符串前缀透传。

| HTTP | 含义 |
|---|---|
| 400 | 严格参数失败、hash/意图大小不符、无效图片、正文中止或读取失败 |
| 401 / 403 | 会话失效 / 来源拒绝 |
| 404 | 当前owner不可见或记录/私有文件不存在 |
| 405 | 二进制路由不支持的方法，Allow仅PUT或GET |
| 409 | 状态/租约/意图过期/幂等冲突，需读取当前意图并显式处理 |
| 412 | 数据集已变化，禁止继续旧引用或旧命令 |
| 413 / 415 | 超过大小限制 / 格式或Content-Type不支持 |
| 503 | 容量占满、处理/接收超时、资产暂不可用或owner不可用 |
| 500 | 未知或内部异常，固定“服务暂不可用”，不包含path/SQL/native cause |

Host在同一受限生命周期内绑定owner/dataset、宿主及父目录身份、manifest内容与runtime.db inode；关键阶段重新验证原session，而非接受替换后的新库。文件工厂再次重验且保持惰性。会话检查与SQLite事务不是跨资源原子操作；撤销不会回收已发送字节或回滚已提交命令。

生产证据：合成PNG→真实HTTP规范化→complete→GET实际hash/尺寸及Chrome Image.decode；头像ID写入角色、进程重启后同图/同引用读回；begin/complete原命令响应丢弃后重放、错dataset、foreign Origin及登出撤销。脚本为`scripts/smoke/local-assets.mjs`，使用临时宿主/端口3196并自行清理。它验证HTTP与浏览器解码，**不等于原角色页已支持选择文件**；C2另验。格式矩阵、租约/故障/跨owner由专属集成与下层真实解码测试覆盖，不将它们说成该单一浏览器脚本都跑过。
