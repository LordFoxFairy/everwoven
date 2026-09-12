# M1 · 原剧本聚合接线（实施前冻结，待验收）

依据Dewey实读16表/现root用例的审查，直接替换storyDrafts六操作，不加同义REST、不保留根CRUD兼容层、不另建编辑器。本文件补充总方案的可执行语义，未表示后端/UI已实现。

## 聚合与不可变版本

- 父StoryDraft.revision控制root+main cast+图片槽，一次写只加一次；get与list分别同一只读事务，禁止拼多个服务的非一致读取。
- mainCharacter：null移除main并清character覆盖槽；library核对expectedTemplateRevision并固定该修订；bound必须等于此root当前main版本，只改覆盖，不读最新模板；inline仅沿当前root/main绑定追溯内部story模板，缺当前inline则创建新内部模板，不findFirst(sourceStoryDraftId)复活旧角色。
- CharacterVersion只插入/复用不可变行，不update；同template/sourceRevision复用时核对owner、模板身份、schema及固定内容。versionNo分配在同一WriteGate事务，依赖现有真唯一兜底。
- 模板scope=story由聚合内部创建，不进入角色库CRUD；不以deleted/archive字段隐藏。
- 本批草稿保存不写StoryVersion/Experience/模型任务。

## 图片与历史读取

- overrides包含严格portrait三态：inherit→固定version图且character槽空；none→无图且character槽空；asset→ID必须等于character覆盖槽。矛盾输入拒绝，不让两个字段各自成为真值。
- assetSlots若出现就是完整cover/opening/character三槽对象，null清除；整个字段未出现才保留。mainCharacter:null同时显式提交非空character槽属于矛盾，拒绝而非悄悄覆盖；未显式提交槽时移除角色会清当前character槽，cover/opening不变。
- 新引入/替换的引用须同owner、ready、未删除。完全相同的既有引用可随标题/文本修改保留，即便文件后来unavailable；详情返回素材明确状态，不让编辑器因图片失效丢掉文本。该保留规则不允许借旧ID绑定另一槽/另一角色。
- 根delete/restore不重写固定角色或图片，历史回执不因模板删除/资产失效改变。进入生成准备需另行验证有效引用；不把可编辑历史等同可生成。

## 协议与容量

- 本次聚合六操作请求统一必填protocolVersion:1单字面量及datasetId；详情/摘要也带protocolVersion:1和datasetId。持久DTO的schemaVersion:1继续表示存储结构，不复用作网络握手。没有旧结构联合或缺字段补齐；缺/错protocolVersion明确CLIENT_RELOAD_REQUIRED，非法当前结构用固定参数错误。同步全部调用者/fixtures，不留隐藏旧入口。
- 角色现独立契约不在本片再次兼容变更；新的聚合契约独立明示版本，命令命名采用authoring.story.*.v1，不注册旧root命令别名。
- JSON接收预算按各严格字段上限与UTF-8最坏编码实际计算，单纯256KiB不足以覆盖全部合法四字节Unicode。实施时给出有界预算常量与最大合法/超额测试；不无限arrayBuffer，不扩大图片二进制通道。
- list返回轻量摘要、q/genre/分页与totalMatching；get返回一致聚合与固定version/overrides/有效角色/AssetDTO。owner/path/storageKey不公开。

## 事务与回执

严格解析→dataset→WriteGate→原命令回执→根CAS/新引用校验→版本/inline/cast/slots→完整DTO→回执→一次提交。历史回执先于当前root/template revision和素材状态验证，不读当前对象拼历史结果；同command异payload拒绝。根/内部模板/版本/关系/回执任一步故障全部回滚。DB事务内不做文件/图像/网络/模型工作。

## 实施切片与验收

1. 严格契约/完整DTO/列表/协议标识与容量（RED→GREEN）。
2. Store与版本聚合六用例，真实SQLite原子回滚/CAS/跨owner/bound注入/固定版本与历史回执。
3. 原Host/tRPC/客户端直接换协议，精确错误白名单；真实HTTP重启恢复。
4. 原Editor异步controller保存及图片端口，去掉DatabaseDrafts临时入口、删除被替代正式浏览器存储分支；未知命令与跨dataset保护保留。
5. 原角色→选图→原剧本→保存→禁浏览器业务缓存→重启→完整读回→修改/删除/恢复，加失败/隔离；主仓、生产、CI与独立审查后才通知M1创作完成。

## 最终单入口实际启用（不是只跑测试服务器）

完整M1源码/原页面回归后，检查用户当前3100所属进程和本项目环境配置，只读取必要的APP_ENV/RUNTIME_DATA_DIR/APP_ORIGIN，不打印模型密钥或整份环境。将同一应用的本地正式启动流程落到3100，使用核实范围的新基线私有Host；若需替换现演练进程，仅操作该项目/端口，禁止再留3103或另一个长期入口。

通过既有一次性连接流程在原页面连接，实际检查正式列表/创作能力，而不拿/tmp验收实例代替当前可用应用。测试目录和模拟合成图保持测试隔离；用户私有库若有旧资料，仅按已授权且核实的项目范围重建，不清源码/密钥/研究文件。没有完成此激活核验前，通知中不可写“当前3100已可正式使用”。开发与演练仍由环境选同一套应用，前端Mock不落正式服务。
