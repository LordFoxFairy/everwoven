# M1 原剧本聚合契约冻结

状态：实施基线，不表示已实现。

主会话只读冻结建议如下。未改文件、未跑测试。

## 1. 请求接口：原六操作直接替换

保留现有 `Draft*` 命名及 `storyDrafts.create/get/list/update/delete/restore`，不留旧请求联合。

```ts
// string在parser中严格校验UUIDv7；revision为1..2147483647。
type StoryProtocol = { protocolVersion: 1; datasetId: string };

type PortraitOverride =
  | { mode: "inherit" }
  | { mode: "none" }
  | { mode: "asset"; assetId: string };

type CharacterOverrides = {
  portrait: PortraitOverride;
  relationship: string; // <=4000，可空
  name?: string;        // <=120；存在且为空表示清空
  settings?: Partial<CharacterSettings>;
};

type StoryAssetSlots = {
  cover: string | null;
  opening: string | null;
  character: string | null;
};

type MainCharacterInput =
  | {
      kind: "library";
      templateId: string;
      expectedTemplateRevision: number;
      overrides: CharacterOverrides;
    }
  | {
      kind: "bound";
      characterVersionId: string;
      overrides: CharacterOverrides;
    }
  | {
      kind: "inline";
      name: string;
      settings: CharacterSettings;
      portraitAssetId: string | null; // 固定版本的基础头像
      overrides: CharacterOverrides;
    };

type DraftCreate = StoryProtocol & {
  commandId: string;
  title: string;
  settings: StorySettings;
  mainCharacter: Exclude<MainCharacterInput, {kind: "bound"}> | null;
  assetSlots: StoryAssetSlots;
};

type DraftUpdate = StoryProtocol & {
  commandId: string;
  id: string;
  expectedRevision: number;
  patch: {
    title?: string;
    settings?: StorySettings;
    mainCharacter?: MainCharacterInput | null;
    assetSlots?: StoryAssetSlots;
  };
};

type DraftGet = StoryProtocol & {
  id: string;
  includeDeleted?: boolean;
};

type DraftListInput = StoryProtocol & {
  limit?: number; // 默认20，1..100
  deleted?: "exclude" | "only";
  q?: string;    // <=120，建议仅搜索标题、按字面匹配
  genre?: string; // <=80，精确匹配；缺省不筛选
  cursor?: string;
};

type DraftLifecycle = StoryProtocol & {
  commandId: string;
  id: string;
  expectedRevision: number;
};
```

冻结解析规则：

- 六操作均先检查 `protocolVersion`，缺失/错误返回 `CLIENT_RELOAD_REQUIRED`；随后严格解析、dataset比对，之后才进入Store。
- `patch`至少一项；出现的settings完整替换，出现的mainCharacter完整替换该绑定描述及overrides。
- overrides中缺失文本项表示继承固定版本，不表示保留旧override；显式空字符串表示清空。
- 创建要求显式 `mainCharacter:null` 和完整三槽，避免创建默认值散落各层。
- 所有parser接收 `unknown`、拒绝未知字段，并返回固定字段顺序的新对象。

## 2. 一致详情与历史回执

```ts
type CharacterVersionDTO = {
  id: string;
  characterTemplateId: string;
  versionNo: number;
  sourceRevision: number;
  name: string;
  settings: CharacterSettings;
  portraitAssetId: string | null;
  schemaVersion: 1;
  createdAt: string;
};

type MainCharacterDTO = {
  version: CharacterVersionDTO;
  overrides: CharacterOverrides;
  effective: {
    name: string;
    settings: CharacterSettings;
    relationship: string;
    portraitAssetId: string | null;
  };
};

type StoryAssetView =
  | { state: "present"; data: AssetDTO }
  | { state: "missing"; id: string; datasetId: string };

type DraftDTO = StoryProtocol & {
  id: string;
  title: string;
  settings: StorySettings;
  mainCharacter: MainCharacterDTO | null;
  assetSlots: StoryAssetSlots;
  assets: StoryAssetView[]; // 按id去重、排序；至多4项
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
};

type DraftSummaryDTO = StoryProtocol & {
  id: string;
  title: string;
  genre: string;
  mainCharacterName: string | null;
  coverAssetId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
};

type DraftPage = StoryProtocol & {
  items: DraftSummaryDTO[];
  nextCursor: string | null;
  totalMatching: number;
};

type DraftCommandResult = { data: DraftDTO; replayed: boolean };
```

`assets`包括三槽及固定version的基础头像，故最多4项。它提供展示状态，不成为第二套可写引用。缺失资源保留明确missing项，不悄悄把引用改null；损坏/缺失CharacterVersion则报存储错误，不拼活模板补救。

### 固定绑定规则

| 分支 | 后端行为 |
|---|---|
| library | 校验同owner、library scope及expectedTemplateRevision，冻结/复用该修订；不接受客户端快照冒充模板内容 |
| bound | versionId必须等于当前root.main；仅改overrides，不重新读取活模板内容 |
| inline | 仅沿当前main.version追溯本root内部模板；当前不是该root的inline时创建新内部模板，禁止按sourceStoryDraftId任意找旧模板复活 |
| null | 移除main；按计划清character覆盖槽，不动cover/opening |

CharacterVersion复用必须比较固定内容；新versionNo与内部模板修改在同一WriteGate事务。根revision只加一次。

### 三槽与头像同真值

- inherit：effective头像来自固定version，character槽必须null。
- none：effective头像null，character槽必须null。
- asset：override.assetId与character槽严格相等。
- 最终校验对象是“当前聚合＋patch”合并结果，而非只校验请求中出现的片段。
- `mainCharacter:null`＋显式非空character槽拒绝；未提交assetSlots时才按计划清该槽。

### 同历史引用保留

不能仅用“旧聚合某处出现过这个assetId”放行：

- cover/opening：仅原槽同ID保留。
- character覆盖：还需仍属同一当前角色绑定。
- inline文本编辑：沿同一个当前内部模板保存，未更换基础头像可保留。
- 换模板、换角色来源或把旧图移到另一个槽，均属于新引用，重新校验同owner、ready、未删除。
- delete/restore不重写角色和素材关系。
- 历史receipt返回当时完整DTO；不以当前资产unavailable、软删或模板修订否定它。

## 3. 事务、错误与容量

### 后端与前端职责

**后端唯一负责：** owner/dataset、当前绑定归属、模板CAS、版本复用完整性、同历史引用判定、三槽一致性、根CAS及完整事务回执。事务内不调用文件、图片解码或资产HTTP服务。

**前端负责：** 完整工作副本、显式选择来源、字段反馈、上传结果消费、稳定命令及epoch隔离；不能自行宣布版本已冻结或用三个独立请求拼“聚合保存”。

建议纯前端端口：

```ts
interface StoryDraftClient {
  create(input: DraftCreate): Promise<DraftCommandResult>;
  get(input: DraftGet): Promise<DraftDTO>;
  list(input: DraftListInput): Promise<DraftPage>;
  update(input: DraftUpdate): Promise<DraftCommandResult>;
  delete(input: DraftLifecycle): Promise<DraftCommandResult>;
  restore(input: DraftLifecycle): Promise<DraftCommandResult>;
}
```

不再把session方法混进剧本客户端。原Editor的 `onSave: boolean` 改成确认DTO的Promise；A提交后继续输入B，响应只更新确认身份/revision/baseline，不覆盖B。旧unknown遇解析拒绝、过期或generic HTTP错误不解锁；`CLIENT_RELOAD_REQUIRED`也不能触发丢文本的自动刷新。

### 错误白名单

建议仅新增剧本专属纯协议表，不复用资产维护写集：

| 状态 | 固定标识 |
|---|---|
| 400 | `INVALID_STORY_COMMAND`、`INVALID_STORY_QUERY`、`INVALID_CURSOR` |
| 401/403 | 既有session/origin拒绝 |
| 404 | `STORY_NOT_FOUND`、`CHARACTER_NOT_FOUND`、`ASSET_NOT_FOUND` |
| 409 | `REVISION_CONFLICT`、`TEMPLATE_REVISION_CONFLICT`、`STORY_NOT_DELETED`、`REVISION_EXHAUSTED`、`IDEMPOTENCY_CONFLICT`、`STORY_ASSET_NOT_READY` |
| 412 | `DATASET_CHANGED`、`CLIENT_RELOAD_REQUIRED`，前端严格区分 |
| 413 | `STORY_REQUEST_TOO_LARGE` |
| 500 | 固定净化错误；存储损坏、版本冲突内容、坏receipt不外泄诊断 |

当前 `localError()`的前缀透传与任意TRPCError直接返回不宜照搬；story边界改成确切白名单，并正确处理 `next()` 返回的error结果。

### 完整receipt

当前故事receipt没有读取自身id，create响应也缺独立身份绑定。建议沿已验证的资产做法：

- create：服务端生成rootId，create receipt.id同rootId，原子写入。
- 其他写命令receipt独立生成id。
- 校验commandType/hash/schema/protocol/dataset及响应身份、动作对应的revision/删除状态、请求明确字段与聚合内部一致性。
- 重放不查当前root/template/asset来重建历史DTO；新写则完整DTO和receipt同事务提交。
- 不增加通用receipt框架或旧回执兼容。

### Unicode容量

按上述最宽请求：

- 根文本：58,700码点。
- inline基础人物：18,120码点。
- 全量overrides含关系：22,120码点。
- 合计：**98,940码点**。

四字节原文已约396KB；JSON还可能使用控制字符转义或代理对转义，不能仅乘4。全部补充平面字符写成代理对转义时约1.19MB。

建议冻结 **单个story create/update请求2MiB**，并用最大字段fixture计算真实UTF-8字节验证上界；测试原文emoji、控制字符、显式代理对转义和超限流。合法字段不意味着允许无限空白填充。

只提升对应剧本请求预算；其他JSON及图片通道不变。剧本客户端使用非batch请求，混合/多操作batch明确拒绝，避免“一个请求容纳无限个合法聚合”。list/get查询另保留有界URL预算。

## 4. 写集划分与待明确项

### 后端聚合写集

- [story-draft.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/contracts/story-draft.ts)
- [story-draft-validation.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/contracts/story-draft-validation.ts)
- [story-draft-store.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/ports/story-draft-store.ts)
- [story-drafts.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/application/story-drafts.ts)，按cast/DTO/receipt拆专属小模块
- [prisma-story-draft-store.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/infrastructure/db/prisma-story-draft-store.ts)
- [story-draft-service.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/composition/story-draft-service.ts)
- [host/index.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/runtime/src/host/index.ts)，仅故事组合与错误导出
- 专属契约、聚合、版本、回执及真实SQLite回滚测试；现schema已有所需表与唯一约束。

### Web传输写集

- [api/story-drafts.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/server/api/story-drafts.ts)
- [local-runtime.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/server/local-runtime.ts)
- [api/http.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/server/api/http.ts)
- [local-boundary.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/server/local-boundary.ts)
- [ports.ts](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/lib/authoring/ports.ts)
- 新 `story-client.ts`、纯story错误/容量契约及测试；删除被替代database-client，不留别名。

### 原页面写集

- [story-editor.tsx](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/components/story-editor.tsx)
- [platform.tsx](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/components/platform.tsx)
- 新story-controller/viewmodel/hook与原列表、导航测试
- 删除 [database-drafts.tsx](/Users/nako/Documents/ChatGPT/minimax%20h3研究/apps/web/components/database-drafts.tsx) 临时入口及替代测试
- 复用已冻结资产端口，不改Hegel资产maintenance文件。

**需在实施前明确的真实欠定义：**

1. **原Editor类型有损。** 当前`Story`没有playerRole/worldRules/tone；relationship也没有正式映射。正式viewmodel必须保留全部字段，relationship落cast overrides，不能复用旧转换补空覆盖。
2. **创建角色是否可省略。** 总方案写`mainCharacter?`，聚合计划未定创建缺省；推荐显式null。update仍按缺省保留。
3. **inline基础头像与覆盖图如何填写。** 推荐新inline基础头像显式null，原图片控件选图写override＋character槽；编辑已有inline保留其固定基础头像，不能每次重置。
4. **q/genre语义未定。** 推荐q仅标题字面搜索、genre精确匹配；count与列表过滤完全一致，count不带cursor条件。
5. **游标公开owner冲突。** 当前base64游标直接包含ownerId。若坚持owner不公开，改成包含dataset及owner/dataset/filter的scopeHash；在Store前校验，owner授权仍来自可信上下文，不把hash当授权。
6. **“保存并进入准备”不是本批生成授权。** 聚合保存不创建StoryVersion/Experience/模型任务；按钮应进入另行校验的准备流程，不能沿用浏览器假游玩成功。
## 主会话决定（替代上文“建议/待明确”）

采用上述单一接口，以下取舍已经冻结，不再等待用户重复设计：

1. 创建必须显式mainCharacter:null或library/inline及三槽；不补旧请求。保留Draft*名字，六操作无兼容联合。
2. 正式viewmodel独立保留playerRole/worldRules/tone；relationship归cast.overrides。原Editor组件复用布局，不复制旧有损Story当正式存储结构。
3. 新inline基础portrait=null，选图走override.asset+character槽；已有固定基础头像不擅自重置。文本override允许显式空，表示用户清除（生成校验另行判断）。
4. q标题字面contains，genre精确，totalMatching不带cursor条件；scopeHash替代游标里的明文owner，只是分页绑定不是权限。
5. 单个story mutation2MiB有界JSON，支持最大合法Unicode原文/转义；story客户端非batch。含story的多操作/混合batch明确拒绝。查询URL另有界，其他JSON及图片限制不扩大。
6. create receipt.id与rootId同值作为历史创建身份证据；其他receipt独立ID。固定角色、槽和Asset视图完整历史回执不拼当前数据。
7. 保存并进入准备仅进入正式准备校验/模型未就绪提示，不调用演示游戏、不创建发布/经历/任务、不发起付费请求。
8. 复用小型命令不确定性规则，不引入BaseController；首次可信确定拒绝与既有unknown后本次前置拒绝区分。

实施分批：runtime聚合先落唯一契约/版本/Store/用例；Web传输按实际导出的契约；原Editor/Library最终接线并删除临时DatabaseDrafts。主会话持有生产smoke，初始原Editor保存按钮disabled的生产RED已实证；不得把初始保存通过等同完整验收矩阵通过。
