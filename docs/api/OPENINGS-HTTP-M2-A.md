# M2-A4 · 本地正式开局 HTTP 契约

2026-09-13。**同一应用的 Host/tRPC 已接通，并在隔离 dev、production 的真实 Node launcher＋Next＋SQLite 验证。** 原准备浮层还未消费这些新方法；本片不是视频任务或 Player 验收。

## 1. 三个正式 tRPC 操作

| 操作 | 传输 | 输入 | 返回 |
|---|---|---|---|
| `openings.bindings` | GET query | `{protocolVersion:1,datasetId}` | `BindingDirectory` |
| `openings.create` | POST mutation | [严格CreateExperience](EXPERIENCE-OPENING-M2-A.md) | `{data:ExperienceOpeningDTO,replayed:boolean}` |
| `openings.getPreparing` | GET query | `{protocolVersion:1,datasetId,id}` | `ExperienceOpeningDTO` |

路径为既有 `/api/trpc/<operation>`；GET参数`input`为JSON URL编码，POST为JSON body。返回沿现有tRPC `{result:{data:...}}`，不新增REST客户端。机器基准为AppRouter＋runtime parser。全部要求原本机HttpOnly会话，包括binding目录；owner不在请求中。

### BindingDirectory

```ts
type BindingDirectory = {
  protocolVersion: 1;
  datasetId: string;
  status: 'ready' | 'empty' | 'unavailable' | 'not_initialized';
  items: VideoBindingChoice[];
};
```

- ready：有已配置的准备选择，返回公开key/version、供应商/精确型号、connectionId/region、operation、generation，以及`canPrepare:true,canDispatch:false,accountVerification:'unknown'`。
- empty：启动时文件缺失或有效空配置。没有自动MiniMax/fal默认项。
- unavailable：配置非法或与当前宿主身份不匹配；目录为空。不返回路径、解析错误、账号scope或credentialRef。
- not_initialized：没有通过本地launcher装配启动快照；请求不会自行读文件补初始化。

当前目录输出复用纯地区/模型generation约束，拒绝假ready、未知地区及不可能的型号/规格。历史PublicBinding只检查历史形态，不套当前模型限制。

## 2. HTTP与输出边界

- 复用同一监听器、AppRouter、Host鉴权和owner WriteGate；Web不打开Prisma。
- 校验精确本机Host/Origin、拒绝cross-site；POST必须同源Origin及`x-everwoven-request:1`。
- 禁止batch，单操作`?batch=1`也拒绝；混合story/opening请求不进入任何业务方法。
- GET URL≤8192 UTF-8字节，POST body≤16384字节；按实际流计数，不仅看Content-Length；POST严格UTF-8/JSON。
- `Cache-Control:no-store`、`X-Content-Type-Options:nosniff`。错误仅固定ID，不回显stack/cause/SQL/provider参数。
- 共享output parser校验完整快照、UUID/时间、story.dataset、setup/草稿关系和不可派发初始状态。create进一步核对请求来源/revision、binding版本、预算；getPreparing核对请求id。形态合法但属于另一请求的DTO同样拒绝。
- 路由返回CREATE的历史确认，不得拿它覆盖未来播放中的当前状态。初始准备查询仍保留`PREPARATION_NO_LONGER_CURRENT`语义。

## 3. 一次性宿主配置

配置位置固定为显式`RUNTIME_DATA_DIR`下的`providers.json`，形态见[registry说明](../architecture/VIDEO-BINDING-REGISTRY-M2-A.md)。它只有非秘密身份和credentialRef，不存实际API key。**本片不替用户创建、chmod或修复这个文件。**

启动器在Next.prepare前通过`createRequire(... )('runtime/host')`调用`initializeLocalVideoProviders`；与现有Next webpack `commonjs runtime/host` external指向同一个compiled模块。单进程一次快照，不同时加载src另一实例，不在HTTP请求中重读配置，更改需重启。

文件规则：同一FD以`O_NOFOLLOW`、只读方式打开；正常文件、当前UID、0600、单link、2–65536字节；实际有界读取、严格UTF-8、前后inode/大小/mtime/ctime和目录/manifest身份检查，finally关闭FD。只有真实最终文件缺失才empty，坏symlink/权限/目录/UTF-8/超限为unavailable；确定性replace/grow测试验证拒绝且FD关闭。这里没有宣称可防御同UID恶意程序的所有时序攻击。

快照固定directory/environment/owner/dataset。配置失败保留惰性失败resolver：**既有CREATE回执和getPreparing不查询当前registry，仍正常读回；新开局才失败并回滚。** 角色、图片、剧本不依赖provider配置健康。缺密钥不在这里探测、也不触发测试收费。

## 4. 状态与错误

| HTTP | 固定ID（主要） |
|---|---|
| 400 | INVALID_EXPERIENCE_COMMAND / INVALID_EXPERIENCE_QUERY |
| 401 / 403 | LOCAL_SESSION_INVALID / LOCAL_ORIGIN_DENIED |
| 404 | EXPERIENCE_NOT_FOUND / STORY_NOT_FOUND / PROVIDER_BINDING_NOT_REGISTERED |
| 409 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / STORY_ASSET_NOT_READY / STORY_ARCHIVED / PROVIDER_BINDING_CONFLICT / PREPARATION_NO_LONGER_CURRENT |
| 412 | DATASET_CHANGED / CLIENT_RELOAD_REQUIRED |
| 413 | EXPERIENCE_REQUEST_TOO_LARGE |
| 503 | PROVIDER_CONFIGURATION_UNAVAILABLE / PROVIDER_NOT_INITIALIZED |
| 500 | EXPERIENCE_INTERNAL_ERROR（包括不可信异常及坏持久事实/DTO） |

未知传输结果仍需保留同一command/payload再核对；不得靠重连、重开浮层或换model生成另一个command掩盖未知提交。该前端控制逻辑在下一切片实施，不因为后台幂等就假定UI已完成。

## 5. 实际时序与验证

```mermaid
sequenceDiagram
  participant L as 唯一本地launcher
  participant H as compiled runtime/host
  participant F as 私有providers.json
  participant W as Next tRPC
  participant D as SQLite
  L->>H: initializeLocalVideoProviders(directory,environment)
  H->>F: 一次有界只读并固定身份
  F-->>H: ready/empty/unavailable快照
  L->>W: Next.prepare与同一listener
  W->>H: 鉴权后bindings/create/getPreparing
  H->>D: 已验收开局事务或历史读取
  D-->>H: 固定事实/原回执
  H-->>W: 严格DTO
  Note over H,F: 请求不重读；配置坏不阻断旧经历
```

`scripts/smoke/local-openings.mjs`使用临时私有目录、原启动器和真实Chrome会话，在production/dev分别验证：未登录拒绝→自动会话→空目录→写配置但请求不热读→重启ready→真实开局→删配置后旧进程不变→重启empty且回执/get仍正常→坏配置unavailable且新命令503、原剧本可读→换账号同版本冲突且历史不变。脚本零模型请求，不是伪Provider或演示数据库。

下一步：原准备浮层的目录/选择/预算与异步unknown/epoch控制；之后Quote/执行Profile/持久任务/媒体/播后回应。两幕实际生成与恢复验收前，产品goal保持未完成。
