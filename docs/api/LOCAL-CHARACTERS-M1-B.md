# M1-B · 本机角色模板 API 契约

状态：2026-09-12角色服务及原角色页六操作已通过主仓与真实Chrome验收；远程CI状态见PROGRESS。正式角色库复用此契约，不新建“数据库角色”页面。

## 边界

- 单一T3应用，`/api/trpc/characters.*`；会话与剧本共用`/api/local-session`。
- 正式本地启动模式、明确Origin、HttpOnly/SameSite会话；客户端不传ownerId、scope、数据目录。
- POST必须有正确Origin、`content-type: application/json`、`x-everwoven-request: 1`。请求体经既有统一上限校验。
- 所有命令均携带首次提交时固定的datasetId和commandId。不是认证凭据，不决定开哪个数据库。
- 只管理scope=library。其他owner或story内部模板ID等同不存在，不泄漏名称/是否存在。
- 无自动mutation retry、无演练数据回退；缓存不作为保存成功凭据。

## 数据

```ts
type CharacterSettings = {
  personality: string;   // <=8000 Unicode码点
  appearance: string;    // <=4000
  speakingStyle: string; // <=2000
  boundaries: string;    // <=4000
};
type CharacterDTO = {
  id: string; name: string; // name 1–120码点，草稿唯一必填内容
  settings: CharacterSettings; portraitAssetId: string | null;
  schemaVersion: 1; revision: number;
  createdAt: string; updatedAt: string;
  deletedAt: string | null; archivedAt: string | null;
};
```

四项settings键必须存在，但值允许空字符串。姓名只存顶层，不再在settings重复。所有正式业务ID为UUIDv7；时间是ISO UTC，来自服务端。姓名、内容哈希不唯一；同名角色允许共存。

## 操作

| 名称 | tRPC方式 | 输入 | 结果 |
|---|---|---|---|
| create | mutation | datasetId,commandId,name,settings,portraitAssetId | `{data: CharacterDTO,replayed:boolean}` |
| get | query | id,includeDeleted? | CharacterDTO |
| list | query | limit?,deleted?,cursor?,q? | `{items,nextCursor,totalMatching}` |
| update | mutation | datasetId,commandId,id,expectedRevision,patch | 命令结果 |
| delete | mutation | datasetId,commandId,id,expectedRevision | 命令结果（软删除） |
| restore | mutation | datasetId,commandId,id,expectedRevision | 命令结果 |

- `patch`只允许name/settings/portraitAssetId；至少一项，settings为完整四字段替换，不做隐式merge或旧字段转换。
- `list.limit`1–100；`deleted`默认exclude，可选only；q最多120码点。分页游标绑定owner、dataset和过滤条件，改变筛选必须从首页读取。
- `totalMatching`是当前过滤范围总量，不是这一页条数，也不承诺跨多次请求的快照隔离。
- 非null头像必须是本owner ready、未删除的正式Asset。浏览器IndexedDB ID、文件路径、任意URL均不是头像契约。
- update/delete/restore用expectedRevision进行CAS；模板更新不更改任何已冻结CharacterVersion。
- 幂等命令固定命名空间`authoring.character.*.v1`。同命令同有效payload返回原DTO；同命令不同payload为409。

## 错误与界面恢复

| 状态 | 典型原因 | 界面行为 |
|---|---|---|
| 400 | 字段/头像/游标无效 | 保留输入，指出校验失败 |
| 401 | 未连接或会话失效 | 同页连接，不卸载编辑器，不把旧unknown判定失败 |
| 403 | 来源/请求边界拒绝 | 保留输入与原命令，不自动重试 |
| 404 | 不存在/不可见/默认读取已删除 | 保留编辑副本，可回列表重新读取 |
| 409 | revision/幂等冲突或未删除对象恢复 | 保留当前输入，明确冲突，不覆盖他人版本 |
| 412 DATASET_CHANGED | 首次命令的dataset已不匹配 | 停止旧命令重放，重连后显式从保留文本新建 |
| 网络断开/5xx/非领域412 | 本次提交结果不明确 | 保存固定命令，允许确认同一命令，禁止另发create |

所有错误不返回SQLite语句、路径、会话、连接码。只根据明确领域拒绝清理unknown，不能根据一次网络/权限失败推断先前事务未提交。

## 与UI的关系

原角色库采用编辑副本+确认DTO；提交A后继续编辑B，A成功只更新确认基线及正式ID/revision，B保留dirty。会话Provider位于页面导航层之上，连接控件位于AppShell内容区或Editor连接槽；正式未连接不改用localStorage。保存锁与图片处理锁分离后组合。角色图片上传/读取由M1-C完成前，不接受本地演练图片为正式头像。

原角色UI的创建、全字段修改、删除恢复、丢响应确认、刷新与宿主进程重启已通过Chrome验收；图片上传、剧本版本绑定与真实生成不在此通过范围。

角色来源携带datasetId/templateId/revision/portraitAssetId，不等于已冻结版本。Editor首次另存前也检查来源世代；跨库后零自动写入，显式恢复清旧身份和头像、保留文本，再在当前dataset新建。
