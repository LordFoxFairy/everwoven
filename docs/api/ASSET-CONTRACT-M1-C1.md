# M1-C1 · 图片协议边界

**2026-09-12，C1a源码契约。HTTP上传/读取、私有文件与数据库意图服务尚未注册，本文不是可调用接口公告。** 验收状态见[PROGRESS](../PROGRESS.md)。实现类型在runtime的`contracts/asset`与`contracts/asset-validation`公开导出；不接受旧结构、不补默认字段。

## 请求与身份

| 类型 | 精确字段 | 含义 |
|---|---|---|
| AssetBeginUpload | datasetId, commandId, inputSha256, inputByteSize, originalName, rightsDeclaration | 首次提交固定的原文件意图 |
| AssetGetUpload | datasetId, uploadId | 查询当前意图，而非把begin历史回执当当前状态 |
| AssetCompleteUpload | datasetId, commandId, uploadId | 新完成命令；稳定重放规则由C1c事务实现 |
| AssetGet | datasetId, assetId | 读取当前数据集的正式素材 |

所有ID为UUIDv7；dataset不是认证凭据，未来Host从会话取得owner后再比对dataset。未知字段严格拒绝，客户端不传owner、磁盘路径、storageKey、处理token或租约。

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
- `AssetCommandResult<T> = {data:T,replayed:boolean}`只定义结构；本批没有伪造已实现的回执服务。

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
