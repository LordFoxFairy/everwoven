# Everwoven · 实施进度

更新：2026-09-13。**这是实施真值台账，不用设计完成代替功能完成，不用commit代替验收。**

**当前执行入口：M1原角色、私有图片、完整剧本聚合与恢复已验收，远端开发分支d72c1cf的CI已成功。本轮已移除手动连接码并在当前3100验证自动会话，修复长连接阻塞停机；M2-A1内部不可变版本封存也已实现；最新主仓103文件1602项测试与双端typecheck通过。当前变更的提交/CI以文末实际记录为准。整体产品尚缺正式开局、持久模型任务、两幕真实交互与存档分支，下一切片进入M2，不再重复搭创作面板。**

## 当前决策（按最新用户指令）

- 一套T3应用、原页面接前后端；Prisma + SQLite、零外键、只保留真实唯一约束。
- **新基线直接重建，不做旧协议/旧回执/旧数据兼容或迁移。** 用户允许清空项目业务数据。清理不得包含源码、密钥、下载资料、其他应用数据。
- Demo仍由前端维护，正式数据只走后端；移除临时数据库编辑器和旧正式浏览器存储分支，不保留双轨用户入口。
- 用户要求完整闭环真正落地后才通知：普通推进记录在本文件。此前everwoven定时跟进在M1验收后暂停，本轮是用户主动继续的工作；未宣称暂停的任务仍在后台执行。凭据与付费授权仅在真实调用验收需要时单独确认。
- 创作持久化与模型生成分批验收；尚未确认的模型ID/费用/实时能力不得包装成已接通。

## 五条主线

| 主线 | 当前状态 | 下一可验收结果 |
|---|---|---|
| 1 前端逻辑 | 原角色/私有图片/完整剧本异步端口已接通；自动会话无取码步骤 | 正式开局和舞台使用持久运行态，而非旧demo快照 |
| 2 后端逻辑 | M1聚合、固定角色引用、私有资产、owner/dataset/WriteGate/CAS/回执与维护已验证 | 开局不可变版本、Connection/Binding、任务派发与预算 |
| 3 整体闭环 | 创作及重启恢复通过；真实视频游玩尚未通过 | 两幕真实视频→播完交互→持久恢复，之后合格节点分支 |
| 4 技术方案 | M1与自动会话契约已有实现证据；Provider专项仍为M2设计基线 | 逐切片同步真实API/SQL/架构/时序与异常验收 |
| 5 推进记录 | 本文件顶部为最新状态，以下各日期保留历史证据 | 不将旧CI、文档或测试fixture冒充本轮真实生成验收 |

## 已有证据（历史验证，不冒称本轮新跑）

| 切片 | 代码/文档 | 验证 |
|---|---|---|
| M0-C1 存储端口 | fef8eb4 | 用例从Prisma抽离为事务端口；历史主仓验证见实施记录 |
| M0-C2/C3 本机真实草稿 | 6e4de7f；8c0b2c2记录 | [CI 34703786441](https://github.com/LordFoxFairy/everwoven/actions/runs/34703786441) 成功：361测试、typecheck/build、Docker与HTTP浏览器、CRUD重启/丢响应 |
| unknown外层导航保护 | bdf861f | RED复现卸载；低并发全量362/362；最终聚焦37/37和typecheck通过；默认并发曾4项超时，未放宽断言 |
| 原页面集成范围 | f0cf2ff | 规格已复核；后续用户要求取消兼容，本轮同步修订 |

发布边界：已发布版本仍为v0.1.0；当前创作切片不是旧镜像已有功能。开发分支d72c1cf已确认推送且CI成功；本轮自动会话改动的提交/CI另记，未合并main、发tag或发布新镜像。

## 历史批次：M1-A0 端口与会话边界

- [x] 写明详细技术方案：[INTEGRATED-AUTHORING-M1](architecture/INTEGRATED-AUTHORING-M1.md)。
- [x] 建立[执行计划](superpowers/plans/2026-09-12-integrated-authoring-m1-a.md)。
- [x] 根据最新用户要求去掉兼容路线，定义项目业务数据定向重建边界。
- [x] 提取异步端口；所有类型引用直接依赖端口，不留组件re-export别名。
- [x] 校验session真实响应；畸形/状态矛盾不能显示连接或退出成功。
- [x] 主仓聚焦133/133、typecheck、规格和代码质量复核；详细设计复核通过（非完整M1验收）。
- [x] 记录本批精确文件；提交主题 `refactor(authoring): isolate ports and adopt clean baseline plan`（本地，不含发布）。

并行分工：Feynman处理聚焦前端端口/测试；Hegel只读复核后端契约和恢复边界；主会话维护详细方案、集成和进度。没有额外外部worker或第二应用。

## 历史推进队列（当时未实现；M1现已验收，M2待推进）

1. **M1-A1 新契约/新库：** 单一Story/Character/Asset字段、服务用例、baseline/schema gate；用临时库验证，不建设旧JSON/旧回执适配。
2. **M1-B 原角色库：** 新建/读/改/删/恢复、owner/CAS/幂等、异步表单、重启验证；不新增专用数据库角色页面。
3. **M1-C 图片与剧本：** 私有文件上传/读取/崩溃核对；inline/library角色快照、portrait三态、三图槽、聚合保存；原编辑器接通。
4. **M1-D 切换验收：** 定向清旧业务库与项目浏览器缓存，原页面成为唯一正式入口；删除旧面板/旧协议/旧存储分支；端到端与错误矩阵验证。
5. **M2 真实视频：** 官方精确supplier-model、凭证与预算、持久任务/worker/媒体/下一幕；真实付费验收另记录。

## 当前限制与未做动作

- 没有执行数据删除、SQL重建或浏览器业务缓存清理；先让新基线通过隔离验收再切换。
- 原角色库/图片/剧本编辑器还未接通正式后端；本批提取端口不等于这条用户链路完成。
- 本轮未调用付费模型、未打tag、未更新发布镜像。
- 原DB类型、上传恢复、完整角色路由仍待后续代码实现。文档DDL是拟定结构，不是已部署清单。

## 追加记录格式

每次收尾追加：日期 / 小批次 / 改动文件与commit / 主仓实际命令和结果 / 失败及修复 / 未验证项 / 下一最小交付。失败保留原因，不以“重新跑过”删除记录。

### 2026-09-12 · M1-A0 本轮验证

- 改动：ports.ts移出组件接口，所有消费方直接导入，无兼容别名；session请求校验真实布尔状态并统一安全错误，CRUD行为不变。新增adapter 103测试。
- 首次主仓聚焦：`pnpm exec vitest run apps/web/lib/authoring/database-client.test.ts apps/web/components/database-drafts.test.tsx apps/web/components/authoring-navigation.test.tsx --maxWorkers=2`，129通过/4失败：2项5秒超时，2处在DOM更新后立即读取effect回调的竞态。
- 修复：两处原精确pending断言用waitFor等待effect完成；不改生产行为、不放宽断言、不增加timeout。
- 最终主仓：相同三文件 `--maxWorkers=1`，**133/133通过，退出0**。`pnpm typecheck`通过；`git diff --check`通过。未重跑全仓测试/生产构建/Docker，本轮无全量或发布验收声明。
- 文档核验：相对链接、代码围栏通过；设计SQL摘录仅在内存库解析验证3表零FK，**不是新Prisma baseline已生成或通过验收**。
- 设计复审修正：增加datasetId防reset后旧unknown命令跨库重放；complete与清理共用finalizing/deleting token协议防文件/DB竞争；角色绑定输入明确bound分支。Hegel复审三项关闭。Dewey规格及Cicero代码质量审查通过。
- 下一最小交付：M1-A1单契约与新baseline的服务端测试，再原角色库；替代原页面闭环通过后定向重置并删除旧路径。不实现旧数据转换。

- TDD补充：实现者报告首次新增adapter测试在旧实现上64失败/39通过（退出1）；之后才改实现。上述133/133为主仓独立验证结果。

## 当前批次：M1-A1 单契约 / 新baseline（2026-09-12）

实施记录：[M1-A1](implementation/M1-A1-CLEAN-BASELINE-2026-09-12.md)。源码已直接替换StorySettings与Prisma baseline，没有旧字段适配；主仓先全量548/548及typecheck通过，追加同名trigger门禁回归后DB26/26通过，最终全量结果在下方补记。

下一优先级固定为datasetId贯通（manifest→会话→稳定命令→HTTP→用例→跨重置零写入）；之后角色CRUD接原页面、上传/聚合接原编辑器、定向reset及删除旧路径。不继续加临时面板功能。

### M1-A1 最终主仓证据

- Story TDD（实现者报告）：验证器旧实现10失败/55通过；命令回执6失败；六字段UI往返1失败；实现后分别GREEN。
- 最终全量前一次549中548通过/1失败：退出连接后的effect上报尚未完成。修复同类6处异步pending精确断言的等待，保留同步unmount断言，不提高timeout/不削弱断言。Dewey复审通过。
- 最终主仓命令：`pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck`，**38文件549/549通过，类型检查通过，退出0**。
- 基线指纹`--check`、smoke脚本`node --check`和diff空白检查通过。Hegel基线规格、Dewey字段规格、Cicero最终代码质量复核通过。
- 本轮未执行生产Next构建或浏览器smoke；对应脚本已同步新字段，但语法检查不是浏览器验收。没有清用户库、reset、tag或付费模型调用。
- 本批提交主题：`feat(authoring): replace legacy contract and database baseline`。接下来按[datasetId执行计划](superpowers/plans/2026-09-12-dataset-bound-commands.md)直接实施，不等待用户再次确认。

远程状态：8c1552a已推送开发分支；[CI 34710192907](https://github.com/LordFoxFairy/everwoven/actions/runs/34710192907)已成功（含生产构建、Docker六环境/端口组合、HTTP浏览器、六字段本机创作及重启smoke）；publish/anonymous-pull因非tag跳过，非发布镜像。M1-A2正在实施，随后按[原角色库计划](superpowers/plans/2026-09-12-original-character-library.md)继续。

M1-A1 CI证据补齐：34710192907成功，verify耗时4m28s。Node20版GitHub Actions兼容警告不影响本次成功；后续独立更新CI actions，不在dataset变更里顺手改依赖。官方H3文档核验已记录于[研究增量](research/MINIMAX-OFFICIAL-RECHECK-2026-09-12.md)，仅确认官方索引，不宣称付费生成验收。

## M1-A2 代码及主仓验收完成

[实施记录](implementation/M1-A2-DATASET-COMMANDS-2026-09-12.md)。主仓首次全量603/604通过，旧压力用例最后的认证返回断言尚缺datasetId，已交给实现者按新契约精确修正；未减少并发检查。最终复验与审查尚未标完成。

### M1-A2 最终证据与下一步

- 实现者报告已执行三批RED（9/22/3项失败），后聚焦12文件338/338及类型检查通过；主仓独立复跑第一遍603/604，修正旧fixture精确断言后**40文件604/604 + runtime/Web typecheck通过**。未降低压力次数、未改变异步精确期望。
- Hegel后端规格、Dewey前端规格、Cicero代码质量复核通过；无剩余本批P1/P2。
- 新manifest/credential/会话/command/cursor绑定dataset，异库零自动重放，原文本显式另建。没有旧manifest/字段兼容，没有reset或数据删除。
- 当前新代码提交主题：`feat(authoring): bind local commands to dataset identity`。原角色/图片/原Editor尚未闭环，继续按角色库计划，禁止发送总体完成通知。
- M1-B计划已独立复核并补共享sessiongate、Editor另存角色async调用、角色草稿必填/上限一致与正式头像不走IndexedDB等边界。

远程追加：3c0c9dd已推送，[CI 34711146356](https://github.com/LordFoxFairy/everwoven/actions/runs/34711146356)在执行；此CI仅验证M1-A2切片，不等于角色/图片/视频闭环或镜像发布。

M1-A2远程复验：2026-09-12读取GitHub实际结果，CI 34711146356 status=completed/conclusion=success；未打tag。M1-B已启动，角色HTTP边界先RED（7项中6失败，现有未注册route返回404），源码尚在实施，未宣称原角色库接通。

## M1-B 当前实施证据（原页面尚未接通）

角色Runtime六操作、Host与tRPC实际HTTP、CharacterClient，以及共享连接Provider/组件已实现；[接口契约](api/LOCAL-CHARACTERS-M1-B.md)、[实施记录](implementation/M1-B-CHARACTERS-2026-09-12.md)已同步。首次主仓全量51文件699/699及类型检查通过；独立角色规格78/78通过。连接模块三处世代/迟到回调P2均有RED→GREEN回归，最后完整复验待补。下一直接落地原CharacterLibrary异步CRUD与共享gate，随后图片/聚合；用户不接受仅接口可用即称闭环，继续保持静默。

M1-B接口/连接切片主仓最终证据：51文件700/700 + runtime/Web typecheck通过（exit0）；角色DB/Store/HTTP补验37/37。Feynman确认runtime写入已停止，Hegel规格通过。Cicero代码质量复核进行中；原角色页面、正式图片与原剧本聚合仍未完成，继续推进而非给用户发送阶段完成通知。

独立复核收口：Hegel角色接口规格、Dewey共享连接规格、Cicero角色/连接代码质量通过；Cicero明确确认同client epoch P2关闭。当前接口/连接切片可提交，下一步直接改原角色库，不请求用户重复批准。

远程5759e32：[CI 34712457449](https://github.com/LordFoxFairy/everwoven/actions/runs/34712457449)正在执行，尚未标成功。原角色Web写集已交给Feynman，主会话不并发修改其components/controller文件。新增[角色架构与时序](architecture/CHARACTER-AUTHORING-M1-B.md)记录已实现后端及原UI待验收边界。

5759e32远程CI已成功（34712457449，verify 3m50s）：生产构建、Docker六环境/端口、HTTP browser、既有创作/重启smoke全部通过；非tag，发布跳过。新增M1-C1私有图片上传执行计划记录Hegel的只读安全核查，待原角色页验收后直接实施。

原角色Web切片首次主仓：55文件731/731及双端typecheck通过；隔离production build抓到运行时误导入runtime/src验证器的P1（.js依赖未解析），Feynman正在改公开package export路径。浏览器尚未到GREEN，未提交此Web切片。规格review同步进行。


原角色页最终规格：Hegel控制器通过；Dewey最后复核5文件47/47，关闭直接角色卡→Editor从未另存→跨dataset旧头像来源P2，恢复前零写入，恢复后清来源和头像保留文本。此前主仓745/745与两项Chrome smoke已通过；最后修复后全量/生产浏览器再次执行，Cicero代码质量审查中。尚未提交此Web切片；M1-C/D继续待实施，不发总体完成通知。


最后来源修复后的主仓验收：`pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck`退出0，**55文件746/746、runtime/Web类型检查通过**。隔离Node22生产`pnpm build`退出0；Chrome `local-characters.mjs`和`local-authoring.mjs`均通过，零模型调用。主会话复看1440×1000角色页截图，原sidebar/连接状态/卡片与编辑栏正常，姓名必填星号和筛选active/命中区修复可见。代码质量审查尚待结果，未提前写总体完成。

M1-B最终代码质量：Cicero只读审查PASS，无确认P1/P2（其未重跑测试，不以审查报告替代主仓746/746与Chrome证据）。本切片提交主题`feat(authoring): connect original character library to local services`。无用户数据重置、tag或付费模型调用。

M1-B已提交并推送`5f037bf`（23文件），原角色浏览器smoke已加入CI。M1-C1a已交Feynman独立实现图片严格契约与真实解码规范化器；只写runtime边界/媒体/tests/直接sharp依赖，不并发编辑其写集。下一C1b私有文件、C1c意图/事务/HTTP恢复，再C2原图片和聚合。主会话继续维护文档与CI证据，未重置用户数据。

远程原角色切片CI：[34715019332](https://github.com/LordFoxFairy/everwoven/actions/runs/34715019332)，head=5f037bf，当前in_progress；非tag，未发布镜像。

角色架构图/时序图已在隔离Mermaid12.0.0+真实Chrome渲染，并人工复看两张图；未向外部站点上传文档，未把渲染工具加进项目依赖。

C1b只读设计复核：明确纯Node22文件系统威胁模型与局限，补整条祖先权限、稳定私有命名空间、失败worker不unlink、终态cleanup拥有删除权；不为不承诺的同UID宿主失陷引入native addon，不把recheck写成原子防护。详细修订已记私有图片执行计划；源文件端口尚未实现。

远程5f037bf CI34715019332失败：verify 4m47s，测试/typecheck/生产构建/Docker六组合通过，旧HTTP演练smoke仍按已变更placeholder定位性格框超时；原角色smoke因此未执行。主会话核对失败日志后更新测试可访问名称和新浏览器保存状态，并加强重载字段与demo零正式写入断言；正在同隔离生产构建Chrome复验，不改产品代码迁就旧文案。

HTTP演练smoke修订后同隔离5f037bf生产构建的真实Chrome已通过（退出0），Dewey聚焦review PASS；测试继续验证非安全HTTP环境crypto、原导航、浏览器角色重载和零正式角色写入。仅提交smoke/docs修订，C1a进行中的runtime源码不混入。

2caaec8已推送，远程修订CI34715399381已成功；C1a尚在TDD实施，未混入该提交。总技术方案阶段表与当前批次已同步真实进度，不保留角色后端尚未接入的过期描述。

远程最终核实：2caaec8 [CI34715399381](https://github.com/LordFoxFairy/everwoven/actions/runs/34715399381)status=completed/conclusion=success；全量/typecheck/生产构建/Docker六环境端口、HTTP演练、原root和新增原角色重启smoke全部通过。publish/anonymous-pull非tag跳过，没有新镜像发布。

C1a实现者停止写入；主仓58文件853/853及双端typecheck通过，隔离生产构建+三Chrome smoke通过，主仓compiled-dist三种合成图输出hash/尺寸/字节核验通过。Dewey契约规格67/67、Hegel解码规格107/107通过；Cicero质量review中。新资产契约和C1实施记录已更新，未把decoder成功称为HTTP上传/文件持久化完成。

C1a Cicero最终代码质量PASS，无确认P1/P2；未以只读review替代主仓实跑。提交主题`feat(assets): add strict contracts and bounded image normalization`。本切片不改schema、不接HTTP、不重置业务数据或调用付费模型。

C1a 88f5940已推送；[CI34716208568](https://github.com/LordFoxFairy/everwoven/actions/runs/34716208568)尚在运行。Feynman已接下一C1b唯一写集：private-asset-store端口、私有文件实现与tests，必要时共享normalizer/verifier两槽预算；不得并发改其源码。仍未有上传HTTP/原图片绑定，继续静默推进。


## 当前继续入口（C1b，勿与实现者并发写同一文件）

- 88f5940远程CI34716208568实际成功，verify 4m40s：853项基础回归所在测试步骤、类型检查、生产构建、Docker六环境端口、HTTP演练、原root及原角色进程重启smoke通过。非tag，镜像publish/anonymous-pull跳过，不是发布新镜像。
- **Feynman `01a09684-1393-7002-b9d4-e6016dd1e988` 正在实现C1b**。先通过原生wait_agent确认是否已停止，再读diff并独立验证；未返回完成时主会话不编辑其private-asset-store端口/私有媒体文件/tests及必要共享decoder预算变更。
- 后续规格审查可复用Hegel `01a09686-30d5-7931-8a5c-d6b9854653a5`（熟悉文件威胁模型）；接口契约审查Dewey `01a09645-827c-70a0-b25a-30abc5fbc39e`；规格通过后质量审查Cicero `01a09636-f45c-7450-9a1f-710ff2a6328c`。主仓必须重新跑，不能只信agent GREEN。
- 下一顺序不变：C1b文件→C1c上传意图/事务/HTTP/恢复→C2原图片控件和剧本聚合→D移除临时面板/受限reset/原创作完整验收。没有HTTP/assets服务或剧本聚合就不宣布创作全链路完成。
- 同一任务heartbeat `everwoven` 已实际读取本地配置为ACTIVE；保持普通阶段静默，不新建第二automation，不用空状态冒充完成。
- 主仓仍有用户原有未跟踪研究markdown；禁止`git add .`或删除这些资料。当前无用户业务库重置、无模型付费调用、无发布tag。

2026-09-12 20:14 UTC heartbeat继续：已先核对当前进度/总方案/Git和Feynman原生状态（仍running）。C1b已出现private-asset-store真实TDD测试，主会话未碰写集。Dewey完成下一C1c只读边界核查，惰性资产工厂、认证/世代/owner在图片body与资产文件创建之前、有界接收容量、tRPC JSON和SQLite sidecar证据边界已记专属执行计划。

C1b已停写并进入规格复核；主仓60文件907/907通过，类型检查待最后退出确认。重点未闭合问题：O_EXCL cleanup进程崩溃残锁无恢复工具，主会话要求评估自动释放协调端口而非把永久busy记为闭环。暂不commit C1b、不启动C1c源码。

C1b首次主仓907/907及runtime/Webtypecheck已确认退出0。Hegel规格指出两项恢复缺口：永久cleanup空锁、exists后verify无补fsync。已采用ADR-0009并派实现者先RED修订为必选协调端口+同步终态删除临界段、ensureDurableCandidate；当前保持未验收，不把测试数当闭环。

C1b第二轮主仓923/923+typecheck+生产三Chrome通过，但Hegel独立复现wrapped async hook未处理拒绝导致进程退出，以及随机非法UUID构造改错版本位。Feynman修private资产；Dewey独立两契约测试修相同fixture（各自写集不重叠）。修完必须主仓再跑及复审后commit，不发送阶段完成通知。

独立fixture修复：Dewey只改角色校验/dataset命令两测试，固定含第二组7的v7重现旧replace仍合法，报告RED4失败/42通过→GREEN46/46；改固定版本4非法样本并断言isBusinessId=false，未改生产校验器。主仓将在private资产修复停写后统一复跑。

C1b最终证据：主仓62文件928/928+runtime/Web类型检查退出0；最终隔离生产构建及三Chrome退出0。额外两次独立Node进程使用真实initializeLocalHost/validatedHost和compiled文件端口，写入→进程结束→同dataset读回hash/metadata→ensureDurable通过；测试协调器明确拒绝cleanup，未宣称生产SQLite清理协调已实现。Hegel最后P2复核通过，Cicero最终只读质量PASS。

C1b 08de822已推送（20文件），下一C1c-1真实SQLite CleanupCoordinator已交Feynman独立实现，写集仅DB适配器/必要内部端口错误/专属测试与fixtures，不触碰已验收private文件端口或HTTP/UI。必须真实两个Node进程、SIGKILL、超过事务timeout的同步临界段证明；若实验失败先报告，不增大timeout假装解决。当前C1b CI结果待核实。

08de822的push已确认成功，但GitHub CI列表读取先TLS握手超时、后unexpected EOF；当前不能记录该commit Linux CI成功。已改为只读查询精确commit check-runs核实，未改网络/凭证配置。C1c-1实际coordinator与tests已出现，继续代码工作，不把暂时网络故障当用户授权阻碍。

08de822远程结果已通过精确commit check-runs核实：[CI34718307948](https://github.com/LordFoxFairy/everwoven/actions/runs/34718307948) verify=completed/success，publish和anonymous-pull=skipped。前两次TLS/EOF未变更配置，后续只读查询成功；当前C1b Linux CI已确认，而不是由push推断。

C1c-1主仓新跑 `pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck` 退出0，63文件956/956。新增四路径已实读，包含真实两Node进程、两处SIGKILL与同步3400ms/3000ms事务timeout排他；Hegel独立复核中，尚未提交，不以此替代上传T1/HTTP闭环。Dewey只读准备下一生命周期边界。

C1c-1最终本地门槛通过：956/956、类型、隔离生产构建/三Chrome全部退出0；Hegel独立28/28规格PASS、Cicero只读质量PASS。另Dewey开始独立有界图片接收器写集（新port/media/tests），和后续生命周期不重叠；不把未完成HTTP写为可用。

C1c-1 bd580f7已实际推送成功，无发布tag。Feynman接C1c-2应用/Store/composition；Dewey接有界接收器（两个共享槽覆盖接收+work），均只写各自新增文件，主会话不改其写集。恢复入口/lease/失败补偿和正文容量决定已补执行计划；Host/HTTP/UI依然后续。

远程bd580f7 CI只读查询连续两次TLS handshake timeout；push已成功但当前尚未核实CI，不动网络/凭证配置，不把该问题扩大为用户阻碍。Hegel完成Host/HTTP下一片只读接线审查，记录pinned DB身份/真实session重验及错误映射，未提前修改接线文件。原图片控件C2计划已依据当前源码记录端口替换、未知命令和跨世代图片隔离验收。

有界接收器独立规格发现真实P2：每chunk race同一pending interruption累积reaction，Hegel单字节100k/200k挂读GC复现约35.2/70.5MB堆增长，原39测试仍过。Dewey已接RED修订当前pending read单订阅与真实微chunk堆回归；不因39/39称接收器验收。Feynman生命周期继续独立写集，签名不变。

隔离快照仅接收器初版（不含在途生命周期）新跑61文件952/952+双端typecheck退出0。与主仓956基数的差异已核对：主仓额外扫描Git忽略的assets/prototypes三文件43项，而隔离只包含版本管理源码；952 = 956 - 43 + 39。没有复制或发布用户私有prototype文件。该GREEN仍不覆盖Hegel发现的reaction累积P2，修复后重跑。

Receiver P2已修复：Dewey先RED2失败/原39通过→41/41；主会话独立41/41，Hegel再审41/41及50万微chunk GC常量保留堆通过，abort/严格未处理拒绝模式无回归。Cicero只读质量审核中；最终接收器切片在隔离稳定源码做全量/类型验证，生命周期仍由Feynman实施。

Receiver稳定切片主仓41/41+独立规格/质量PASS；隔离版本管理源码61文件954/954+双端typecheck退出0。计划单独提交这四个新增文件与实际证据，不混入在途生命周期，不将隔离全量误写为主仓全量。

Receiver50d67cb本地commit成功，但git push退出128（GitHub443 SSL_ERROR_SYSCALL），不写已推送；bd580f7 push先前成功，CI查询多次TLS timeout未证实结果。未改凭证/代理/网络配置，继续生命周期实现；网络问题不阻塞本地可做的闭环工作。

C1c-2 Feynman已停写14个新增文件，报告聚焦55/55及runtime build/typecheck通过；TTL新claim24h后拒绝、显式恢复和T1→T2已实现，但启动扫描/自动调度/真实HostHTTP未实现。主会话正在主仓全量验证；Hegel规格/并发、Dewey契约/Store独立只读审核。生命周期源码已显式复制到隔离快照用于生产回归，不复制用户数据。

C1c-2首轮主仓独立全量：68文件1052/1052，runtime/Web类型检查，exit0（含receiver修复及主仓本地prototype43项）。隔离生产构建/三Chrome仍在执行，Hegel/Dewey规格审核未结束，不提前提交或宣布总体完成。

C1c-2主仓1052/1052与生产三Chrome已通过，Hegel生命周期/质量Cicero原审PASS，但Dewey额外确认P2：结构合法回执response可与原命令/意图错配，begin原hash/文件名及complete assetId被改仍重放成功。已交Feynman RED补固定输入与upload→asset不可变语义绑定校验；需保留历史回执不依赖当前ready/删除状态。未提交此生命周期切片，修后重新审核与主仓验证。

bd580f7远程已通过精确check-runs实际核实：[CI34719283402](https://github.com/LordFoxFairy/everwoven/actions/runs/34719283402) verify=completed/success，publish/anonymous-pull skipped。此前TLS错误没有改配置，后续只读重试成功。正在重试50d67cb push；未确认结果前不写已到达。

50d67cb重试git push已确认退出0，远程bd580f7→50d67cb成功；未发布tag。C1c-2新增asset-service-receipts.test.ts正在RED/GREEN修复，保持不提交未验收源码。

回执第一修订主仓1082/1082、生产三Chrome通过，但独立再审仍2个P2：合法同内容A/B意图整份begin DTO互换；completed新command写入错配Asset回执后自身重放失败。Feynman继续RED修固定绑定与首次提交检查；拟begin receipt.id复用server uploadId作为独立于response的1:1创建身份（无新schema/FK），Hegel正独立评估。保持未提交生命周期，不通知完成。

50d67cb远程精确check-runs确认[CI34720501448](https://github.com/LordFoxFairy/everwoven/actions/runs/34720501448) verify=success，发布/匿名拉取非tag跳过。Hegel认可begin回执与upload共享服务端创建ID，无新schema/FK；约束和未来保留成本记ADR0010，代码修复仍待验收。

第二回执修订Feynman已停写：RED9失败/39通过→48/48，生命周期93/93、runtime类型通过报告。主仓再次全量与隔离生产三Chrome执行中；Dewey/Cicero分别复核两项P2。identity共享规则采用ADR0010，无schema/其他业务回执兼容修改。

C1c-2最终主仓69文件1090/1090及双端typecheck退出0；最后修订隔离生产build和三Chrome退出0。Dewey48/48、Cicero双向原repro拒绝+质量PASS，关闭两项追加P2。准备提交本切片；未发生用户数据删除、模型调用或tag发布。


## 当前继续入口 · C1c-3真实Host与HTTP并行接线

- **Hegel `01a09686-30d5-7931-8a5c-d6b9854653a5`** 独占runtime Host入口/必要host模块/host-assets专属测试。扩展现withLocalDatabase提供pinned host/db identity及真实revalidate，组合AssetService，不改已验收生命周期或Web。
- **Feynman `01a09684-1393-7002-b9d4-e6016dd1e988`** 独占Web local-assets、二进制handler/route、assets tRPC及现root/http/context和专属tests。不改runtime源码/UI/schema。
- 固定协作接口`withLocalAssets(directory,environment,token,work:(service:AssetService)=>Promise<T>)`，service已绑定owner；runtime/host导出AssetService类型。Hegel先runtime build，Feynman先fakeaccess RED测试再真实Host接线，避免并发写generated/dist。
- PUT的dataset header统一`x-everwoven-dataset-id`，既有请求标记和来源校验继续；只有真实Host/session/dataset/意图与容量准入后才读body。GET返回已核验字节、固定WebP/no-store/nosniff。三个assets tRPC操作，不新建另一站点/上传管理页。
- 主会话先native wait确认两个writer均停写，再统一主仓回归/生产HTTP/独立规格与质量审查。Dewey可审Web契约，Cicero最终质量；不编辑任何活跃writer写集。
- 本片不实现自动扫描/调度；后续bounded maintenance入口仍须实际落地或明确收敛，再做C2原图片/原剧本聚合与D移除临时面板/reset。没有原页面完整闭环不通知用户。
- 同一任务hourly heartbeat `everwoven` 本轮实际读配置仍ACTIVE；未新建任务/站点/automation，未调用付费模型、发布tag或重置用户数据。

bd4b1db已实际推送成功（50d67cb→bd4b1db，exit0）；下一轮只读核实精确commit CI。C1c-3两个writer已获分离写集与固定接口，普通阶段继续静默。

bd4b1db首次精确CI读取返回EOF，尚未核实该commit的CI结果；已推送事实不受影响。后续先查原生两个writer状态，源文件出现不代表完成。当前主会话没有留存运行中的验证命令，用户3100未停止；隔离验证树仍为/tmp/everwoven-verify.zRVKTD（固定Node22 PATH），不把用户忽略的assets/prototypes/研究文件加入Git。

2026-09-12 21:54 UTC heartbeat继续：已先实读PROGRESS/总架构、Git及两writer原生状态（均未完成）。按分离写集继续，不编辑在途Host/Web；当前不把派发或接口约定当已接通。

bd4b1db远程精确check-runs已确认[CI34721124228](https://github.com/LordFoxFairy/everwoven/actions/runs/34721124228) verify=completed/success，publish/anonymous-pull skipped；此前EOF后只读重试成功。

C1c-3A Hegel已停写真实Host入口/组合/专属fixture，报告RED23→34/34及旧Host回归合74/74，runtime build/typecheck与compiled Node真实认证读图。主会话聚焦Host34/34退出0，Dewey独立规格审查中；Feynman Web切片仍在写，尚未整体主仓验证/提交。本片实际无启动自动清理，不能将显式cleanup称为后台维护。

C1c-3A Host独立规格Dewey74/74与Cicero质量PASS；主会话34/34实际通过，待Web停写后一并全量。主会话另持有scripts/smoke/local-assets.mjs生产HTTP验收脚本（不属两worker写集），复用隔离浏览器/临时Host harness；旧production实际认证后assets.beginUpload返回404而期望200，正确RED已确认。后续新构建须真实上传/浏览器WebP解码/头像绑定/重启/撤销通过，不拿模块内Request测试替代Next路由实跑，也不把此脚本称为原图片UI已实现。

C1c-3恢复验证：上轮7544/9461输出未保留，未据此认定成功；本轮重新将主仓与隔离生产完整命令输出保存在/tmp专属日志。Dewey Web规格独立7文件93/93 PASS；隔离生产最终build及新资产HTTP/原演练/原角色/原root四Chrome实际exit0。新smoke覆盖真实Next begin/PUT/complete/GET、Chrome图片解码、头像绑定、服务进程重启、错dataset与会话撤销；它没有声称原图片上传UI已实现。CI新增同一资产smoke步骤，Cicero正在最终Web与smoke质量审核；主仓全量仍在运行，尚未提交本片。

主仓C1c-3完整验证已退出0：74文件1202/1202及runtime/Web类型。Cicero确认新生产smoke撤销证据P2：清cookie后的匿名401不证明旧凭据已作废，Web实现本身未发现确认漏洞。主会话已补内存保存旧cookie并显式携带它验证401、不输出凭据；隔离树先故意省略服务端revoke做mutation RED，后恢复真实源码再跑GREEN，不以原四smoke成功掩盖该缺口。

C1c-3生产撤销证据修复：隔离仅清cookie、不执行revoke的mutation实际RED 200≠401；恢复真实源码后production build与四Chrome最终exit0，旧凭据显式请求401。不修改服务端撤销逻辑。

提交前发现.gitignore的通用**/uploads/隐藏真实PUT源码路径。主会话先加真实临时Git source-boundary.test.ts，RED1→精确route例外GREEN1；uploads其他媒体继续忽略，.dockerignore既有apps/web白名单包含路由。没有强制添加用户文件。再次运行最终主仓全量（新增1条打包边界测试）及typecheck，完成后记录最终计数；Cicero最终复核中。

C1c-3最终本地门槛闭合：最后主仓75文件1203/1203、双端typecheck exit0；恢复真实revoke后的production build/四Chromeexit0；Dewey规格PASS、Cicero Web/脚本/精确Git例外最终质量PASS。所有PUT源码将普通add纳入，不包括用户研究/图片。自动维护、C2原图片UI及聚合依然待做；下一计划已写明，不发送创作完成通知。

## 当前继续入口 · C2原图片控件接线

C1c-3已commit `95cd68f`（34文件），最终1203/1203、双端types、生产四Chrome、独立规格/质量通过；push结果待确认。精确PUT route已正常Git收录，用户研究/媒体未收录，无发布tag。

- **Feynman `01a09684-1393-7002-b9d4-e6016dd1e988`** C2A唯一writer：纯asset-http常量、AssetRef/AssetClient端口、formal/demo adapters、上传controller及读取hook/专属tests；只在常量搬移时改server import，不改UI/角色controller。
- **Hegel `01a09686-30d5-7931-8a5c-d6b9854653a5`** C2B唯一writer：原story-assets/character-library/story-editor/platform、character-controller/viewmodel与对应样式/组件/导航tests；依赖A冻结接口，不发明另一adapter，不改服务端/schema。
- 主会话持有docs/原角色生产smoke/CI，待两writer停写后统一主仓与真实Chrome；下一生产用例必须原file input选择+权利确认+保存/禁浏览器存储/重启/换图清除/角色软删除恢复，不能用API脚本冒充UI。
- 原剧本聚合、显式维护、删除临时面板与定向reset仍后续。Dewey已只读核对聚合风险并记录新执行计划，不另开第二接口/编辑器。
- 继续静默，仅完整原页面创作闭环后通知。同一heartbeat已实际读取仍ACTIVE。

95cd68f push已确认退出0，bd4b1db→95cd68f；精确GitHub check-runs当前verify=in_progress，[CI34722926560](https://github.com/LordFoxFairy/everwoven/actions/runs/34722926560)。未从push推断CI通过。C2两writer已启动分离切片，主会话新增原图片UI验收脚本，不改其组件。

C2主会话原UI验收脚本`scripts/smoke/local-asset-ui.mjs`已加入未提交写集：原角色页setInputFiles、每张图重新权利确认、上传完成后保存角色、禁localStorage与IndexedDB、进程重启读图、替换/软删恢复/clear仍保留资产。旧production已真实RED（缺“选择角色参考”控件导致超时exit1），不是静态断言假RED。使用临时3195/harness自清理，不影响主入口3100。新UI未完成前不记GREEN、不改CI加入尚失败脚本。

A纯AssetRef/AssetClient类型已落在apps/web/lib/authoring/asset-ports.ts：demo/formal判别，正式ref带dataset，上传result带operationId/editingKey；B依赖该唯一接口。两writer仍在实施，勿将源码出现当完成。

95cd68f远程已通过精确commit check-runs实际核实：[CI34722926560](https://github.com/LordFoxFairy/everwoven/actions/runs/34722926560) verify=completed/success；publish/anonymous-pull=skipped，未发布新tag或镜像。C2两writer仍运行，当前新增asset-client/demo-client测试和原控件变更尚未验收，主会话不对活跃写集跑合并结论或提交。

后续继续先native wait Feynman/Hegel完成，再实读A/B diff、聚焦/主仓全量/双端类型与隔离生产。隔离树/tmp/everwoven-verify.zRVKTD当前仍是95cd68f的生产逻辑（加主会话新UI smoke文件），真实session撤销源码已恢复；新UI smoke正确RED，必须复制两writer最终稳定文件并重build后运行GREEN。固定Node22.22.2 PATH，所有主会话本轮验证进程均已结束，无未取回exitcode；未停止3100。旧role smoke末尾0file-input断言待真实正式picker接入后改为真实控件/禁IndexedDB证据，由主会话负责，不能留一边UI成功一边旧CI必失败。

2026-09-12 22:55 UTC heartbeat继续：先实读进度/总架构/Git及两writer原生状态，A/B均已停写。A报告55/55及相关67/67、Web types通过；B报告84项/Web types通过。主会话重新跑全量/类型，Dewey整体规格审查，Hegel补B证据并交叉只读A。隔离树以95cd68f Git归档+明确的最终C2源码列表覆盖，未复制用户资料；生产build和新原UI/原HTTP/旧三Chrome已启动。主会话原角色smoke将旧“0fileinput”换为原正式picker存在，并同时禁IndexedDB；真实上传由新原UI脚本验证。尚未计GREEN/提交。

C2初轮主仓82文件1277/1277及双端types exit0；隔离production build/五Chrome（新增原图片UI、已有图片HTTP、演练/原角色/原root）exit0。主会话实际查看截图，权利checkbox与文字被全局样式拆成竖列；B正在局部样式修正，主会话补实际computedStyle回归。另发现候选丢失后complete404重试是否恢复原process的潜在缺口，A先RED核实。以上初轮GREEN不等于最终门槛，Dewey规格尚在进行，不提交。

A候选恢复已确认RED3/24通过：未completed候选丢失后只重复complete，过期仍泛化提示重复请求；A获授权修精确缺候选→显式原File恢复和终态操作指引，不重传completed资产。主会话原UI脚本另扩充真正丢弃已提交begin/complete响应→“确认上次图片命令”→原ID/原payload重放，并检查unknown禁止换图与保存角色；尚待新production重跑，不用模块mock代替。

Dewey追加规格P2：非协议代理400会被按definitive invalid解除unknown，可能丢失已提交原命令。已要求A补最小RED并系统覆盖无可信协议标识的400/404/413/415，不能仅凭HTTP状态断言写失败；本地未发验证仍可rejected。当前1277与五Chrome初轮GREEN不覆盖此追加风险，不提前提交。

代理400真实production RED已复现：仅将B CSS覆盖隔离树重build，保留旧A；第一张图begin已提交丢响应→原UI确认成功，第二张complete已提交后代理返回非领域BAD_REQUEST400，页面没有“确认上次图片命令”，超时exit1。checkbox实际computedStyle已row通过；待A修复后用完全相同生产UI脚本复跑，不改测试绕过unknown。

C2修订后主仓83文件1307/1307+双端types、production build/五Chrome均exit0；原UI丢begin响应及complete提交后代理400→原命令确认已GREEN，截图权利checkbox横排/disabled按钮外观已复验。但Dewey独立追加P2：已有unknown的原命令确认收到精确INVALID_ASSET_COMMAND400（参数解析早于receipt查询），仍错误解除unknown。A获授权按原命令/阶段保存不确定性，不能将后来的本次请求拒绝当原提交失败；保持首次明确拒绝可结束。此次GREEN不掩盖追加P2，未提交。

另HTTP错误表客户端与服务端完全相同的复制已实核，A获授权移入纯web/contracts/asset-http.ts统一维护，server/asset-errors.ts直引，不引入服务端依赖到浏览器或兼容re-export。两项修完再整体复审/验证。

第二精确400的production回归首次RED时暴露主会话smoke helper问题：waitForResponse promise在click等待期间先超时，未及时观察reject，Node提前退出而残留自有3195测试launcher。已将click与response用Promise.all同时观察（新原UI及原角色helper同修）；初次只读观察到PID92168监听自有3195，尝试进一步核对/终止时进程已自行退出（kill返回no such process、端口已空），没有实际终止任何进程，也未据此声称cwd核实成功；用户3100/其他Next未改动。重新运行相同RED以确保正常finally清理后再计证据，不以测试自身未处理拒绝作产品验证。

修正helper后的精确400 production回归仍因原确认控件消失/无后续complete而失败，作为真实产品RED；Promise.all避免独立等待promise未处理拒绝，harness按正常异常路径清理。最终新A源码尚未覆盖隔离树，等待writer停写后再build验收。

A最后修订已停写：原命令分阶段uncertainty及单一纯HTTP错误表，报告RED21/53通过→9文件182/182、Webtypes通过。主会话正在再次全量/类型与production五Chrome（现在含精确400再确认）；Dewey独立复审中。CI已增原图片控件同一脚本，只有本地最后GREEN及审查通过后才提交，远程结果另核实。

C2最后一轮主仓84文件1334/1334、双端types及production五Chromeexit0，精确400先拒绝确认再重放成功已实证。但Dewey真实SQLite/Controller交错指出新过期例外P2：原finalizer有效lease跨TTL仍能提交，暂无receipt+EXPIRED不证明原请求失败。A已获最小修复授权去掉该例外，已有uncertainty保留，首次明确过期仍终止，并固化真实并发回归。未以1334GREEN提前commit或通知。

TTL最终修订A已停写，真实SQLite+文件+Service+Controller回归RED2/56通过→58/58；Dewey独立58/58并完整C2规格PASS，所有已确认P2关闭。现交Cicero最终C2代码/脚本/CI质量审查，主会话最后全量/生产结果另记，不因规格PASS省略质量门槛。

C2主仓最终1335/1335及双端types、最后production五Chrome均exit0。主会话额外实际原UI“用TA创作→换第三张图→另存模板”也exit0，断言新模板第三图、独立GET原模板仍第二图；不是组件stub。

Cicero质量追加Demo恢复P2：缓存已拒绝的demoImport Promise使后续显式重试无法恢复。A获授权先RED再修真实已失败Promise与仍pending/已fulfilled的区分，维持后两者不重复导入，不伪造demo后端receipt。未提交C2，不把正式上传GREEN遮盖演练退化。

C2最后两小修订均停写：A Demo明确rejected缓存允许显式重试，pending/fulfilled仍保留，RED2/60→64/64；B成功后只禁再次上传、允许新选择/clear，新文件须再声明，RED2→16/16。主会话成功态按钮生产RED false≠true已确认。开始同一最终源码主仓全量/类型及五Chrome（含Studio复制与按钮），Dewey聚焦增量规格复核后交Cicero关闭Demo质量P2。没有提交未验收代码。


C2最终本地验收已闭合：主会话取回最后两个完整进程exit0，85文件1340/1340及双端types；隔离production build/五Chrome（含Studio复制与ready防重复按钮）exit0。Dewey最后增量独立80/80规格PASS，Cicero独立78/78最终质量PASS，当前P1/P2均0。精确提交/CI另核对，不称整体M1创作闭环。用户3100未替换、业务数据未重置、无付费模型调用。

C2已commit `3cbad61`（44文件），实际本地验收见上；push正在核对，未发布tag。下一切片开始：Hegel `01a09686-30d5-7931-8a5c-d6b9854653a5` 为显式有界资产维护唯一writer（runtime维护/Host CLI/必要非唯一索引与fresh baseline门禁/专属tests）；Feynman `01a09684-1393-7002-b9d4-e6016dd1e988` 只读准备原剧本聚合严格契约及后端/前端分工，未获写入授权。主会话持有docs和生产smoke，不触及活跃parallel cut。资产维护先真实RED再实现，待双review/主仓核验；聚合仍未实现。

3cbad61 push已实际退出0；精确check-runs为[CI34725829207](https://github.com/LordFoxFairy/everwoven/actions/runs/34725829207) verify=in_progress，尚未认定远程通过。Cicero追加只读核对角色命令unknown是否有同类早于receipt拒绝问题，要求最小复现，不凭推测扩大重构。

角色unknown聚焦发现已确认P2（不是C2新增回归）：Cicero真实Controller内存提交/receipt复现saveCopy提交丢响应→精确INVALID_CHARACTER_COMMAND400早于receipt→错误清pending→再saveCopy同文本创建第二行。任意INVALID_CHARACTER_前缀也误判；普通generic400当前正确，不泛化报告。主会话原角色生产smoke追加真实提交丢响应后精确400，旧production实际RED（确认控件消失，下一确认无请求超时exit1）。新spawn达原生上限而未创建，实际复用已停止的Einstein `01a09639-298c-75c1-81e9-f6ee63897f9f`，唯一writer仅角色controller/viewmodel/专属tests；维护writer/runtime、聚合只读、主会话smoke/docs均不重叠。不以已通过C2掩盖新发现。

3cbad61精确CI34725829207的jobs已实际读取：verify=completed/success，publish/anonymous-pull=skipped。没有新镜像/tag。另只读确认用户3100监听PID83321为本项目apps/web下next-server16.3.4，HTTP元信息APP_ENV=demo；未读取密钥/整进程环境、未停止服务。最终正式启用仍后续，不把当前演练称为已落地正式创作。新增原创作验收矩阵，并更新本机部署说明中已过时的“人物/图片未实现”范围。

原聚合冻结已记录2026-09-12-story-aggregate-contract-freeze.md：采用Feynman只读严格请求/DTO建议，主会话定显式null/完整槽、全量正式viewmodel、标题字面q、scopeHash、不batch的2MiB故事请求、独立create身份回执、非演示准备路径。主会话新scripts/smoke/local-story-ui.mjs初始真实原Editor保存门槛RED（button disabled true≠false，exit1），完整字段/图片/重启/生命周期断言待实际DTO与原UI落地扩充；未接CI，不冒称完整测试已写好。

Feynman `01a09684-1393-7002-b9d4-e6016dd1e988` 已从只读转为M1-D runtime聚合唯一writer：故事contracts/parser/store/application/composition及专属tests、必要exports；先报告实际纯契约，再供Web接线。明确排除Hegel持有的Host index、schema/baseline/资产维护，排除Web/主会话docs-smoke。Host故事错误调整需等维护停写后协调。Einstein角色修复仍独立Web三文件。当前均未整体验收。

Pascal `01a0963a-4e45-7940-aa97-30aa76dc2070` 现为M1-D Web传输writer，唯一写集story tRPC/local-runtime/HTTP预算与纯story协议、StoryDraftClient端口/适配器及tests；不改runtime或原组件。依赖Feynman已落的唯一纯types，非batch单story2MiB，角色/图片共享batch保持。旧database-client/ports待原UI替换时统一删除，不先造旧签名兼容。主会话和runtime协调公共DTO parser实际导出，避免两套校验。

角色恢复修复主会话聚焦4文件86/86 exit0；稳定C2隔离源码+明确三文件修复全量82文件1332/1332、类型、生产build与五Chrome exit0，其中原角色精确400生产RED已GREEN。当前runtime聚合/维护并行写入，不把隔离结果称为活跃主仓全量；Dewey规格复核中，尚未提交角色修复。

角色修复Dewey规格独立64/64 PASS，三文件无确认P1/P2；已交Cicero质量关闭原报告，主会话生产证据与隔离范围已明确。Hegel维护内部54项聚焦GREEN，实际EXPLAIN按assetId从SCAN变非唯一索引SEARCH；尚未最终停写/主仓验收，未记录维护完成。

角色恢复最终Cicero独立64/64质量PASS，指定三源码/测试及smoke当前P1/P2均0。仅此修复与主会话文档准备提交；活跃维护/聚合源码不纳入该提交。新增原剧本smoke仍是未完成RED门槛，不加入CI或此提交。

角色恢复已commit264af31，仅三文件/原角色smoke与主会话文档，push待取回。Einstein `01a09639-298c-75c1-81e9-f6ee63897f9f` 转为原UI唯一writer：原Editor/Platform/共享预览/列表、story controller-viewmodel-hook及tests；删除临时DatabaseDrafts及旧database-client/ports由他统一处理，Pascal只持新story transport。正式完整form不用旧有损Story补空；图片三槽/固定角色/异步保存/unknown/跨库保护；保持一个界面及原天空主题，不假游玩。两writer已通知对接唯一端口；主会话继续docs/smoke，等源码稳定后完整主仓验证。

Hegel维护已停写，完整15文件清单保存/tmp/everwoven-maintenance-paths.txt，主会话逐路径复制到稳定隔离树（保留C2+角色修复，未复制在途故事）。报告55聚焦、合旧Host/gate/T2共143通过；主会话同8文件重新验证与隔离全量/类型/生产五Chrome正在跑，Dewey规格审查中。Hostindex维护终稿先冻结复制，再将故事白名单部分写权交Feynman，不让两writer同时改同文件。预览只保证不写业务/图片，security兑换/撤销仍写；候选上限非SQL CPU硬上界，SIGKILL不运行finally，临时会话沿既有8hTTL，文档如实说明。

264af31 push已实际退出0，精确[CI34726396899](https://github.com/LordFoxFairy/everwoven/actions/runs/34726396899) verify=in_progress；未由push推断通过。维护新增实施边界文档明确stdin/退出码/SQL额度/预览security写入/SIGKILL期限，未预先写验收成功。

维护初轮主会话8文件143/143 exit0，稳定隔离87文件1387/1387、双端types、production build/五Chromeexit0，另实际root pnpm两条命令stdout码→stdin验证默认空页preview/exit0/零asset目录（内部传递，无凭据输出）。Dewey独立55/55后真实SQLite追加P2：首候选非法v7 ID在逐行catch前整页throw，无cursor导致后续正常行饥饿。Hegel获仅维护分页/逐行处理写集修复授权，不动已交Feynman的Hostindex；此次GREEN不作为最终维护验收。

264af31精确CI34726396899已确认verify=completed/success，publish/anonymous-pull skipped；未发tag/镜像。

主会话独立扩原Studio生产smoke至真实角色基础图+故事覆盖/封面/开场四图、全部世界设置/关系、固定版本与源模板不被修改、服务重启原列表/原Editor字段读回；node语法检查通过。它仍未在新聚合生产运行，unknown/源模板后续编辑/生命周期/跨库及最终actual selectors待UIwriter稳定后补齐。明确不将已写脚本视为已通过，未加CI。原UIwriter已获告知测试语义而非要求为测试增加大按钮。

维护P2修订已停写，新增第16文件asset-maintenance-position.test.ts；非法业务UUID但有界无损分页键逐行error/计数/cursor，不cleanup；UTF8 BINARY排序及原始hex/时间核对避免有损重绑定。真正超界/控制/非法编码/非规范时间键fail-closed，非任意坏库修复工具。Dewey独立69/69规格PASS、当前P1/P2=0；主会话最后9文件157/157 exit0，隔离最后全量/类型/build/5Chrome仍运行。已交Cicero全片质量，Hostindex以冻结副本限定维护范围，未把在途故事白名单混入。

维护最终主会话157聚焦、冻结隔离88文件1401/1401/双端types/build/五Chrome已全部实际exit0；Dewey规格69/69、Cicero质量69/69 PASS，当前P1/P2均0。准备仅提交维护16文件及主会话文档。Hostindex在工作树已有Feynman故事白名单增量，将从已验收冻结副本仅暂存维护版本，保留工作树故事变更不覆盖；其余维护15文件已逐字节核对与冻结副本一致。未将并行原UI/聚合或新RED smoke混入该提交。

维护已commit0481b8e（24文件含16实现与主会话文档），push实际exit0。仅Hostindex暂存冻结维护版本，工作树故事白名单增量完整保留；其余未完聚合/UI均未被提交。

M1-D原UI Einstein已停写：33文件403tests+Webtypes报告，单一Story端口/完整form、原库/原Editor/三槽、移除临时DatabaseDrafts及旧database-client/ports，session类型直接迁移无旧别名。Pascal传输也停写，最后报告被消息覆盖正补回；Feynmanruntime仍在收尾。Dewey开始Web+UI规格审查；主会话更新原smoke实际labels（打开剧本、叙事语气），尚未声称新生产通过。

主会话定位M1-D真实Web集成遗留fixture：apps/web/server/local-runtime.integration.test.ts仍为旧协议，实际RED5fail/3pass，已授权Pascal直接更新当前协议正例与旧协议412/当前协议缺dataset400/错dataset412分离反例；不在请求helper自动补旧payload、不删除原认证/重启/净化证据。Dewey已获告知stub传输161与真实SQLite并非同一证明，另核对正式准备modal键盘边界。

Feynman runtime已停写，报告15文件361/361及runtimebuild/源码与测试types通过；全部runtime未提交变更归本片，Host只故事白名单。Hegel开始独立runtime规格，Dewey继续Web/UI规格。实际EXPLAIN仍有临时排序B-tree，未声称所有查询免排序。要求Feynman把native wait不可见的RED/路径工具历史补进最终报告，不仅引用旧输出。主会话等Pascal真实集成fixture修订停写后整仓与新生产验收。

Pascal真实Web集成已停写：原5fail/3pass→12/12，正例显式新DTO、六操作旧协议412/当前缺dataset400/foreign412分离；真实SQLite完整inline/get/list/history、独立Node重开同会话、固定500净化，累计8文件173+Webtypes通过（其中仅12为实库，不混称161stub）。三writer现均停写，主会话开始主仓runtimebuild→完整vitest→types；隔离树以0481b8e归档+全部明确apps改动/新增/6个删除同步，删除旧面板路径而非仅覆盖文件，生产build→新原Studio/原图UI/图HTTP/演练/原角色五Chrome。旧根smoke待新完整原Studio通过后移除并替换CI，未提前取消CI门槛。

原Studio脚本现含create提交丢响应→精确400→原确认/新标题不覆盖，update丢响应→原确认/新世界文字保留、固定源修改独立、四图/重启/根删恢复/跨dataset；语法检查通过，实际生产结果待取回。

M1-D初轮主会话完整97文件1503/1503及双端types exit0。真正production build已RED：Web runtime/src值导入使Webpack找不到Node ESM规范的.js目标（output→validation/asset-validation/primitives）；已派Pascal改回public runtime/contracts compiled exports，不用解析alias或改Node后缀掩盖。生产浏览器尚未运行，不称1503代表可用。

Hegel runtime spec独立306聚焦及types后确认create回执资产动作不变量P2：创建时所有新引用必须ready未删，但篡改历史asset view为missing/unavailable/deleted仍过重放。已派Feynman只强化create动作签发/重放检查并真实DB3RED+原Asset后来失效仍可重放原ready快照正例，不收紧通用读取或update/delete/restore历史。未提交聚合源码。

Dewey Web/UI规格确认P1（同生产Webpack导入失败，Pascal已修中）及两个P2：完成列表删除残留editing状态→401回首页/跨库重连后导航死路；正式准备原生modal缺初始焦点/Tab约束/ESC/焦点恢复。已派Einstein原UI切片TDD修复，保持真正unknown保护，使用成熟模态原语而非自写陷阱，并轻量去除新面板工程术语。不把初轮1503+types冒充UI达标。原Studio完整smoke仍未生产通过。

远端维护提交0481b8e的CI34727374385实际失败：原图片UI smoke第144行从Studio→我的剧本→角色库后等待原角色编辑按钮超时，页面留在我的剧本。此前本地主仓/冻结生产通过不等于CI通过，未声称该远端成功。Cicero正只读核查导航时序与产品状态，主会话负责smoke，不用增加timeout或跳过门禁掩盖。

三项规格修复已停写：runtime create-only receipt真实DB RED3→GREEN65；Web public compiled parser包边界RED4→183聚焦含12实库；原UI列表操作状态及Radix Dialog RED4→408组件/lib。Hegel/Dewey复审中。session-client剩余isBusinessId源码值导入再交原writer处理。主会话下一轮生产验收尚待此包边界修订稳定，不把局部GREEN冒充M1闭环。

最终规格复审：Hegel runtime PASS，独立15文件313/313及真实SQLite原3反例复现已拒绝，正常历史失效正例仍重放；Dewey Web/UI全部P1/P2关闭，另session包装16/16。Cicero进入全聚合质量审查，尚无最终质量结论。

主会话第二轮实际主仓runtimebuild→99文件1533/1533→双端types exit0。隔离生产build已通过；原Studio首次Chrome完整链路直到准备modal关闭的即时focus断言失败，Radix卸载后焦点恢复异步，改为Playwright toBeFocused有界自动等待后整条原Studio实际exit0（无产品跳过/固定sleep）。涵盖4张真实PNG→WebP、完整世界/角色覆盖/固定来源、create丢响应+精确400、update丢响应与新文字、真实Next进程重启、列表删除/恢复、foreign dataset拒绝、准备modal初始焦点/Tab/Shift+Tab/Escape/焦点返回。无模型请求。

同一冻结生产后续原图片UI、图片HTTP、原角色UI、insecure HTTP demo四Chrome也全部exit0。旧CI的DatabaseDrafts挂载busy导致可点击导航被丢弃，Cicero用0481b8e真实导航函数确定性复现；旧面板现随单一聚合直接删除，不另建兼容。新原Studio已有完整生产GREEN后，主会话移除obsolete local-authoring.mjs，将CI门禁换成local-story-ui.mjs。这些更改尚未提交或获得新CI，不把0481b8e失败改写为通过。当前3100仍未切正式宿主，M1未整体通知。

为独立覆盖旧CI暴露的“可点击但无导航”时序，主会话在新原图smoke增加真实storyDrafts.list响应暂缓：实际点刷新→读中→点角色库→断言aria-current确已切换，再释放真实响应。未伪造列表、未API seed、未加sleep或延长timeout；同冻结生产再次实际exit0。这证明新聚合导航在慢列表读期间可用，不声称旧提交CI重跑通过。

Cicero全M1-D质量复审独立22文件426/426后发现新P2（P1=0、P2=1）：原Editor保存A请求长期pending，session epoch失效/同dataset重连，Controller已允许unknown确认但Editor自己的saveLock/storySaving仍等旧finally，确认按钮被禁用。已派Einstein只修Editor锁的session/attempt世代及真实controller deferred DOM反例，同时证明旧finally不能解锁新确认。不把此前1533/五Chrome视作该恢复场景通过，暂不提交/切用户3100。

单入口启用准备：只读取现3100监听PID/父PID/cwd及公开app-environment元信息，确认仍是本仓demo，未读整份环境/密钥。此前不存在$HOME/.everwoven，已新建并核验当前用户0700父目录；通过现有正式CLI初始化全新$HOME/.everwoven/local-dev，实际exit0。未覆盖旧库/清浏览器数据，未写验收角色/剧情到用户库。因Editor会话锁P2仍修订中，未停止原3100或切正式启动，初始化不等于当前应用已启用。

Editor会话锁P2复审已关闭：Cicero独立3文件30/30，当前全M1-D P1/P2=0；保留前轮22文件426及纯compiled依赖核验。主会话最终runtimebuild、99文件1536/1536、双端types实际exit0；包含最后锁修复的隔离production重新build与五Chrome均实际exit0。

当前单入口已实际启用，不再只是/tmp：再次核验83312为本仓Next demo父进程、83321为唯一3100监听后，仅向该父进程SIGTERM，确认端口释放。使用APP_ENV=dev、RUNTIME_DATA_DIR=$HOME/.everwoven/local-dev通过pnpm local启动同一应用，仍仅127.0.0.1:3100。真实Chrome在这个用户入口取得当前Host一次性码（仅进程内存，不写日志/聊天），经原连接表单兑换，禁用浏览器业务存储后实际打开原角色Editor与原剧本Editor全部世界字段，dev元信息与JS无错误通过。验证未向用户库写测试角色/剧本/图片，结束撤销测试会话；用户首次进入仍须用终端一次性码连接，不隐式登录或伪造空库。

全片源码/文档准备提交；精确新GitHub CI仍待触发与核验，尚不发送M1完成通知。不打tag，不称旧v0.1.0镜像已更新，也不称模型生成已接通。

聚合最终实现已commit ca6bc55（74条明确源码/测试/文档路径），push实际exit0。新CI34729115312确认headSha为ca6bc5541aa78a09359683493eaab5b6ec33ec6d，当前in_progress；未提前声称通过。当前3100正式监听PID62129，启动exec会话70783需保持运行，不清理为测试进程。所有3195–3199生产验收子进程已由各harness清理。用户根目录研究MD保持原有untracked，不混入提交；正式Host在Git外，没有录入测试实体。

ca6bc55精确远端CI34729115312已completed/success，verify103648521549所有源码/类型/Next/Docker/环境/五Chrome步骤成功；publish/anonymous-pull因无tag跳过，未称镜像发布。为严格核对验收矩阵“关闭浏览器”而非只重启服务，再补test-only门禁：关第一Chrome进程→全新Chrome/无cookie→同Host新一次性码原表单重连→完整DTO一致与世界/角色字段、图像读回，不写业务。第一轮闭旧page后的harness诊断掩盖原失败，已加isClosed；第二轮发现已填textarea的getByLabel精确文字包含值而定位失败，改实际textbox可访问名后实际冷浏览器GREEN，无产品改动/断言删减。

Cicero对新test-only增量指出fill参数可能进入Playwright失败日志，已集中fillConnectionCode固定净化异常并替换四smoke所有码输入，保留原UI兑换、不输出cause/log。新增测试实际RED1/1→GREEN2/2，最后审查与包含冷浏览器的全正式Chrome/主仓100文件验证进行中。未因此重新打开或修改已验收产品实现；最终门禁增量与文档确认后再通知。

最后test-only门禁修订完成：Cicero独立凭据净化2/2复审PASS，当前P1/P2=0；所有正式四Chrome在同一验收生产产物再次实际exit0。冷浏览器最后还增加独立GET完整DTO严格相等与所有世界设置、角色覆盖字段读回，真实再跑exit0；封面/开场图片均重新从私有HTTP解码。主仓100文件1538/1538、双端types实际exit0，应用源码仍为ca6bc55（其精确CI已成功）。准备提交仅test-only门禁与最终验收文档，新提交CI仍会完整执行，不跳过失败检查。

## M1 原创作闭环最终验收 · 2026-09-13

实现ca6bc55与最后test-only/document提交d72c1cf均已推送远端当前开发分支。最终CI34729732094精确headSha=d72c1cf29210401752370499f6f54e366d773744，verify103650182361已completed/success；publish、anonymous-pull无tag正常跳过。途中gh watch因GitHub API EOF退出不代表CI失败；随后直接查询确认最终success，未重跑或跳过测试。证据：https://github.com/LordFoxFairy/everwoven/actions/runs/34729732094 。main仍为既有v0.1.0发布线，未擅自合并或更新镜像。

验收结果：原角色→真实图→原剧本完整聚合→同一原列表编辑/软删/恢复，100文件1538/1538与双端types、实际production五Chrome、服务进程重启及独立冷Chrome重新连接读回、未知命令/精确400/后续文字/跨dataset、固定角色与图片引用、正式准备键盘、规格与质量复审均通过。用户同一3100已启用正式dev Host；只读式实际原连接/Editor核验通过，零测试业务seed；当前用户仍须用现有一次性码机制连接，未代为保留测试会话。

本次M1原创作持久化闭环完成。持续跟进将在本验收点暂停，仅发送此完整闭环通知。完成不包含：真实模型任务/视频、StoryVersion发布及Experience分支、Tauri安装包、公网多人持久化、旧库兼容或备份工具。未调用模型、未花费生成额度、未发新tag/镜像。用户研究资料与浏览器演练数据未清除，私人Host/凭据未进入Git。

## 用户纠偏：移除手动连接码门槛 · 2026-09-13

用户明确要求删除截图中的本机连接码表单，后续再次强调全面闭环。本轮直接把该操作从用户路径移除，而非只隐藏表单让保存失效：专用loopback启动器的同源浏览器自动建立私有HttpOnly会话，失败只提供轻量重试；demo/普通Web不开放本地能力，业务unknown命令不自动重发。主会话负责server/scripts/实际验收，Cicero负责前端及既有UI测试，原scope代码不互相覆盖。整体产品（两幕真实视频与恢复）仍未完成，不再用本轮登录体验/创作底座完成冒充整体交付。

后端新增strict POST {mode:'local'}，要求现有Host/Origin/customheader与Sec-Fetch-Site:same-origin；已有cookie只复用，缺失/失效时内部生成并兑换一次性码，码不返回JSON或前端。GET继续只读，旧code仅保留维护/HTTP工具用途。真实SQLite自动接入15用例RED5→GREEN，与原integration/boundary共31/31通过。另针对自动接入后的clickjacking风险，专用启动器文档响应加DENY+frame-ancestors none；旧3100实际header断言RED，待重启后的实际GREEN。不取消来源/会话/数据库隔离，不把公开Web设置APP_ENV就冒充本地宿主。

本轮主仓自动会话版本全量100文件1563/1563、runtime/Web types实际exit0；稳定源码隔离production build及五Chrome实际exit0，原角色/真实图片/完整剧本/unknown恢复/冷浏览器/重启均改为自动建立会话，未靠CLI填码通过。当前用户3100也已独立新Chrome核验：自动一次POST、刷新复用cookie、无连接码字段和连接本机按钮、原角色与剧本编辑器可用、禁用浏览器业务存储、零业务seed/零模型调用、DENY/CSP实际响应GREEN；截图人工检查确认表单消失。独立后端复审31项通过，无确认P1/P2。未将header断言称作真实iframe攻击试验。

实际重启发现旧launcher收到SIGTERM后监听虽关，仍有3条已建立TCP，server.close回调被长连接阻塞，旧进程占Next开发锁。仅清理经cwd/PID核验的已停监听旧进程，未删.next/数据库、未换端口。新增local-shutdown职责模块：幂等信号处理，先等待在途请求，5秒后关闭该server持有socket（含upgrade），应用收尾仍卡住时10秒以失败退出；不会把失败退出称作干净关闭。真实HTTP/upgrade/挂起收尾3用例RED3→GREEN3；加入后主仓101文件1566/1566与双端types实际exit0。稳定隔离dev真实Chrome持HMR连接，两次SIGTERM分别约5035/5036ms正常exit0，同端口重启后原cookie可用于新页面。首次临时验证脚本与HMR自动换页竞争导致Page.reload协议错误，未把这次脚本失败当成功；修为关掉测试旧页、同context新页核验，完整脚本通过。正式smoke进一步要求停机code0且无signal，SIGKILL兜底不再可被算作通过。

官方复核也已推进：9月13日创建/查询及国际按量价格详情成功读取，已更新既有research记录，历史“详情不可取得”不再用作实现阻碍。当前已实现与待实现继续区分：本轮连接与创作验证不包含官方视频生成、两幕交互或存档分支；不将接口文档、测试fixture与真实付费回执混为一谈。

停机独立复审Cicero发现P2：server.close仅证明socket关闭，异步业务handler可能仍未完成，原3项GREEN漏掉此情形。主会话追加真实HTTP deferred handler两反例，实际RED2（提前exit0），已接入shutdown.track覆盖真实Next handle Promise；断socket后等待在途请求全部settled才做app.close，硬截止未完成仍exit1，停止后不接新工作。当前5项聚焦GREEN，重新跑全量与实际dev/production smoke中；前一版1566和约5秒停机不作为本次修订的最终验收。未发现或声称数据库已损坏。

停机P2修订最终验收：主仓101文件1568/1568及双端types实际exit0；独立Cicero5/5并补停止后不执行新工作/清理顺序，原P2关闭、当前P1/P2=0。稳定隔离真实dev两次持浏览器停机分别5037/5040ms exit0，重启后自动会话读回；最终production原Studio/图片/资产HTTP/角色四Chrome全部exit0，且harness明确拒绝SIGKILL或非零停机伪装通过。应用页面源码的production build与HTTP demo此前本轮已通过，后续修订仅启动器及文档/验证逻辑，不将未发生的重构造成本次build。实际用户入口仍为同一个3100和原数据目录，无测试业务数据、未调用模型。

M2只读复审已完成并归并到既有CLOSURE-AUDIT第8节：明确原准备页没有开始用例，官方任务原语没有产品调用方，舞台同步boolean与正式异步回执不匹配，完整任务/媒体/播放/回应恢复尚缺。保持播后情境建议+自由回应要求，不采纳为了赶进度只留无引导输入；保留既有单宿主任务调度设计，不因首期而把任务责任绑定浏览器存活。下一正式代码切片为不可变开局及任务链；这里没有把审计建议写成已落地功能。

本轮28文件已commit36daec9并push当前开发分支成功；精确CI34741214751（headSha36daec9becdb8b242e8cb40294cc43eef2082c05）已启动，尚未取回最终结果，不将push视作CI通过。用户当前3100最后独立Chrome自动接入/无表单/原编辑器/刷新复用全部exit0，最终launcher已加载请求追踪修订。main/tag/镜像未改变，未纳入根目录私人研究资料。

按用户此前“设置goal并推进”和本轮“全面闭环”要求，已建立产品级持续目标，不再在M1验收点将整个工作停止；目标明确包括正式开局、官方持久任务、播后引导/回应、两幕真实生成、重启续玩及合格节点分支，且无密钥/付费授权不调用模型。当前M1通过但整个goal未完成。旧heartbeat仍暂停，不同时建立第二个调度器。

## M2-A 持续目标第一轮 · 2026-09-13

上一goal轮为progress：36daec9已改变真实入口并通过当前3100、1568测试及生产验证；本轮精确CI34741214751仍live，继续观察原handle而不重启CI。已读取当前schema/端口/源码，准备实现正式开局最先需要的不可变封存事务原语；现有schema足够此步，不迁移/清空用户库。执行计划2026-09-13-formal-opening-m2-a按既有数据/Provider设计细化，Cicero并行只读复核账户/预算/封存不变量，主会话持有新封存代码唯一写权。不是新发布入口，也不宣布整体范围缩小。

自动会话提交36daec9的精确CI34741214751已查询为completed/success，verify成功、无tag的publish/anonymous-pull正常skipped；不再等待或重启该已结束作业。

M2-A封存已开始实码：新增严格冻结DTO、事务端口、Prisma version scope和同事务freeze/read原语，原draft adapter只导出既有readScope。首次模块缺失测试RED后，空实现行为RED12fail/16pass；实现后真实SQLite/契约28/28及runtime源码/测试类型通过。封存覆盖完整角色版本/覆盖/有效值与三图槽，复用必须校验封口hash和源revision内容，asset当前失效阻止新开局但不伪改历史版本，任意后续外层事务失败回滚全部。无schema变更、无用户库seed、无模型调用、无假开始按钮；原语等待与Experience/Binding/预算在同一事务组合，并非公开独立发布API。新增更多owner/身份/服务错误/回滚反例与原聚合回归正在跑，未作最终验收声明。

封存规格Cicero独立33/33 PASS（只读源码hash一致）。主会话继续发现低层insert孩子端口缺少sealed父检查：封口之后可向空槽追加使摘要失效。新增真实SQLite反例实际RED1（promise被resolve），已加同事务owner/header存在及unsealed双字段检查；不只依赖回读时发现坏摘要。此次无公开接口、写scope必须外层持WriteGate。最终聚焦及全量继续重跑，未将规格早期PASS当作修订后质量验收。

已关闭6个经工具确认完成的历史agent释放资源，但fresh reviewer spawn仍报告thread limit；实际没有新代理创建，不记录虚构worker。继续由主会话作者与Cicero独立审查，后续结果如实记录。

M2-A1最终质量Cicero已PASS34/34，封存父追加孩子反例关闭；独立补验跨owner/缺失header/同事务封口后追加回滚、正文/身份/hash/键序、子记录时间与非法序号等符合预期，当前确认P1/P2=0。主会话最后全量/类型与隔离production build+原Studio仍运行，尚未提交本片。该片ready仅数据库元数据，不冒充文件内容或供应商素材已检查。

Chunk2不变量已复核：沿现有Binding.parameters严格版本JSON固定connectionId、region、endpointProfileId、providerAccountScopeId、操作协议/生成参数；顶层credentialRef仅宿主秘密引用，客户端不传任意URL/key。CreateExperience在同一Gate封存/绑定/经历/setup/空稿/回执，保存预算上限不等于授权调用；Quote必须服务器固定ExecutionProfile、价格/素材用途/次数和上限，未知费用不能补零。保留后台任务与播后建议职责。上述内容作为下一实码切片输入，不提前宣称已实现。

M2-A1最终主仓103文件1602/1602、runtime/Web types实际exit0；六个明确runtime源码复制到稳定隔离树后production build和原Studio完整聚合/图片/unknown/进程重启/冷浏览器实际exit0。当前用户3100独立Chrome仍自动连接、无取码框、原角色/剧本编辑器可用、刷新复用cookie，零业务seed、零模型调用。Cicero规格与质量独立34/34及补充反例通过；计划Chunk1完成，Chunk2正式经历/绑定/预算入口未实现。文档与内部时序已更新，准备仅提交该片源码/测试/文档，不包含root私人研究资料、不改main/tag/镜像。

M2-A1已commit d78a0ab（12文件）并push既有开发分支成功；精确CI34742077431，headSha=d78a0ab6460db1369482cc84631466a8e81b48fd，当前in_progress，下一轮先查询原作业，不因等待重启。上一36daec9 CI已success。用户研究文件仍未跟踪，未改main/tag/镜像。本goal轮为progress（正式封存源代码、真实SQLite测试、文档、提交与原页面回归均完成），不是仅计划或等待；整体goal保持active，下一步沿计划Chunk2实现CreateExperience/Binding/预算/setup/回执原子事务，再接原tRPC准备入口。

M2-A1精确CI34742077431已completed/success（head d78a0ab），不再等待。M2-A2主会话开始内部CreateExperience事务代码；Cicero独立只读核对确认既有schema足够，并要求回执除自身DTO外核对真实Experience固定引用、预算和来源，覆盖整体互换反例。主会话负责唯一写入；该切片仍零调用，未开放假开始按钮。

M2-A2实际RED：契约模块缺失后18契约GREEN；数据库用例空实现22条全部行为失败，再实现单Gate开局和持久事实回执验证，40/40 GREEN。主会话额外发现JSON规范器数组getter未被拒绝，新增反例实际RED1→改descriptor遍历及整个binding先规范化；现46/46和runtime源/测试类型通过。新增composition、真实SQLite断开重连、并发同command、共享版本后续失败保留、历史softdelete不复活、错误owner/clock/id和全部写点after-write回滚。Cicero独立只读审查中，主仓全量/双端types与隔离productionbuild+原Studio正在跑，未将聚焦GREEN宣布整体完成。

M2-A2独立Cicero发现并确认P2：低层insertResponseDraft仅检查自身owner，允许内部端口给另一owner节点插入影子草稿，破坏原历史；不是公开接口越权证明。主会话新增4条实际SQLite反例RED（跨owner/缺失经历/缺失setup/同owner错绑），修订两个孩子插入端口在同事务检查父经历归属/初始状态、setup所属经历及创建时间，当前50/50和runtime typesGREEN。先前1648全量及production原Studio虽通过，因P2修订不作为最终验收；正在主仓重新全量/双端类型和最终隔离build/原Studio，不停在早期PASS。

M2-A2最终独立Cicero复核PASS50/50，原parent关系P2关闭；额外七类非初始/删除/归档父状态均拒绝并回滚，当前确认P1/P2=0。主仓最终105文件1652/1652、runtime/Web源码和测试类型实际exit0（/tmp/everwoven-opening-final-main.log）。最终Prisma适配复制到稳定隔离树后production build+原Studio完整内容/角色/四真图/unknown/重启/冷浏览器再验exit0（/tmp/everwoven-opening-final-production.log）。用户当前唯一3100仍原PID84490/原目录，Chrome自动会话/无连接码/原编辑器/刷新复用再验exit0且零业务seed、零模型调用（/tmp/everwoven-opening-current-entry.log）。

本片真实新增内部CreateExperience/getPreparing/固定Binding事务及50条测试，源码10文件、测试3文件，原schema无变更，未开新端口。API/架构图/时序/计划/审计同步明确：历史CREATE确认不是当前播放快照，opaque capability不是准入，保存预算不是付费授权；原tRPC和准备页面尚未对接。下一步实际宿主Connection/Deployment登记与capabilitypolicy、同页面异步开局入口，再进入Quote/持久操作/官方视频/播后回应链。不把这片内部事务当整体产品完成；goal持续active。准备只提交本片明确路径，保留所有私有research未跟踪，不改main/tag/镜像。

M2-A2已commit80c2632并push既有开发分支成功；精确CI34743112327，headSha80c2632ddadf249bd60799ed8da13efad8cc11cf，当前in_progress。下一轮查同一作业，不将push当CI通过或重启CI；上一d78a0ab及36daec9均success。当前goal轮有实码/50反例/独立复核/主仓1652全量/生产与原页面验证/提交，不是仅计划。Cicero已转只读核查下一宿主登记+能力policy+tRPC复用点（submission01a09978-f9de-7ea2-857c-5ea1edf369c8，当前尚未返回），主会话继续持唯一写权。用户3100原服务保持运行，未修改main/tag/镜像，私人研究资料仍未跟踪。整体goal保持active，直到真实两幕/恢复/分支验收再作产品完成通知。

上一goal轮归类progress：80c2632真实新增原子经历和50测试，并主仓1652与原页面验证/提交。当前精确CI34743112327仍in_progress，原作业live继续观察。Cicero下一接线审查确认复用withLocalDatabase、原tRPC来源/标记/batch/大小边界及原保存后准备浮层，不能只加router就算接通。本轮推进统一runtime部署目录/非秘密connection-binding登记和MiniMax输入能力策略，避免再维护第二份模型数组；之后原入口使用这一登记，不启用fal fallback。官方CN/io创建文档本轮再次实际读取，支持分段job规格；文档证据不是账号权限或实时流。

M2-A2精确CI34743112327已completed/success，head80c2632匹配。M2-A3本轮实码将Web部署目录/纯MiniMax构造迁入runtime，旧请求实现删除并直改import，共用规格constraints；新增非秘密CN/io连接登记、同步不可变BindingResolver、脱敏选择列表和严格已知capability输入兼容策略。未读key/调用模型、不改变当前live/fal available语义。聚焦5文件127/127及双端types实际exit0；新增真实SQLite证明具体registry开局固定地区账号，换账号同版本冲突而旧command历史回放不变。独立Cicero质量审查中，主仓全量与隔离build/原Studio进行中。

M2-A3独立Cicero发现P2：合法HTTPS超长query能通过原请求构造并超过官方body上限。主会话补3条实际RED（长URL/多字节/双帧+转义body），改为URL解析前8192 UTF-8字节、最终JSON65536 UTF-8字节保守限制；保持纯TextEncoder，无Node Buffer。新增调用方零fetch反例，旧结构未改语义/未回显私密URL。修订前全量1688和原Studio/build已exit0但不作为最终验收；当前聚焦130与类型GREEN，最终测试/构建重新跑，独立复核未结束。

M2-A3最终独立复核PASS（Cicero4文件111/111及超长URL/UTF-8/body边界独立反例），原P2关闭、确认P1/P2=0；主仓最终106文件1692/1692及runtime/Web types实际exit0（/tmp/everwoven-registry-final-main.log）。最终请求边界源码复制到隔离树后production build+原Studio完整四图/unknown/重启/冷浏览器exit0（/tmp/everwoven-registry-final-production.log），当前唯一3100自动会话/原角色剧本编辑器/无连接码/刷新复用亦exit0且无业务seed（/tmp/everwoven-registry-current-entry.log）。纯请求包出口未引入Node/Prisma，旧Web请求实现已删除，runtime和Web现共同使用单一约束目录。

本片新增纯registry和兼容策略、公开投影、40个净新增反例并落实际SQLite绑定漂移验证，非模型付费或UI开局验收。官方CN/io任务原语仍未与新Host binding/持久Worker接上；原状态码分类等已知任务准入待M2后续修订，不作为现有registry可派发宣称。下一Chunk2-C计划已列output parser、固定启动登记、Host+tRPC全HTTP边界及原准备浮层；Cicero只读查启动模块桥接最少hook，主会话继续唯一写入。goal保持active。

M2-A3已commit c8f711a并push开发分支成功；精确CI34743836566，headSha=c8f711a89b2549a0464d6d891aad516e112e0a53，当前in_progress；下一轮查询同作业，上一80c2632 CI已success。不改main/tag/镜像、不纳入根目录私有研究。

Cicero完成下一Host启动只读方案：runtime/host编译模块内保持单次配置快照，launcher按现有external入口createRequire读取同一模块，不用Web模块或重复src实例；固定providers.json缺失为空、坏格式/权限为provider配置不可用（不禁用角色剧本/旧经历读回），每请求禁止重读。读取用同FD类型/owner/0600/NOFOLLOW/有界严格UTF-8，文件缺失才empty，不chmod/修复用户文件。resolver惰性抛固定错误，create回执仍优先、getPreparing不访问配置；真实dev/production HTTP必须验证共享实例与重启才更新，不能仅靠单元测试。Chunk2-C仍未写代码，下一goal轮直接沿已记录方案推进原Host/tRPC/准备入口。本轮为实码+测试+生产证据+提交progress，goal active。

上一goal轮为progress：c8f711a统一模型部署/请求及非秘密registry，主仓1692+生产/原页面验证并提交；本轮原CI34743836566仍live，继续原作业。开始Chunk2-C：严格公开output parser与一次Host配置快照/认证opening wrapper，随后按同一计划接完整HTTP和原浮层。主会话唯一写入，Cicero继续独立只读验证，不因没有付费凭据停下可完成的实现。

M2-A3精确CI34743836566已completed/success（c8f711a）。M2-A4实码新增纯output/目录parser、同FD只读一次providers启动快照、复用双认证/DB gate的opening Host wrapper、三条受认证tRPC与完整来源/标记/非batch/字节/错误/输出关联边界，launcher使用compiled external共享实例。HTTP初始真实RED18fail/2pass→GREEN20；补来源响应错配RED，已加create请求来源/revision/binding/预算及getid核对。独立Cicero P2目录假地区/规格反例RED后复用纯constraints修复，不影响历史binding读取。

当前聚焦72及双端typesGREEN；独立56/56+额外非法预算零service调用PASS、确认P1/P2=0。启动配置替换/增长确定性race两个新增测试通过，FD均关闭。最关键compiled边界已实际验收：隔离production build+local-openings完整HTTP/SQLite/重启，及同脚本SMOKE_DEV=true均exit0；同一launcher/Next确实共享startup实例。文件后来删除/坏格式/换账号时历史回放/getPreparing仍可用，新命令拒绝，原剧本可读且零模型调用。主仓全量正在跑，原准备UI尚未改，不把新路由当产品完成。

M2-A4最终证据：主仓109文件1750/1750与runtime/Web源码及测试类型实际exit0；稳定源码production build已exit0，最终增强断言的production/dev opening HTTP以及原Studio完整聚合/四图/unknown/重启Chrome均exit0。新增明确empty新create=404/PROVIDER_BINDING_NOT_REGISTERED，换account新create=409/PROVIDER_BINDING_CONFLICT；非仅检查泛错误。配置文件替换/增长race注入位于打开FD后首次fstat返回前，不宣称已覆盖两次metadata检查之间的所有竞态。独立Cicero当前P1/P2=0。用户原3100使用同目录温和停机exit0后重新启动以加载compiled Host，自动会话/无取码框/原编辑器/刷新复用及受认证provider目录非not_initialized全部实测通过；不打印配置、不写用户业务数据、不触发模型。Chunk2-C Host/HTTP完成，准备UI与正式任务链仍待实码，不将1750测试当作整个产品完成。

M2-A4已commit cbec5ef0e94da89c7d8e18cce2b579d804764770并push既有分支；精确CI34744937914 completed/success。未改main/tag/镜像。

M2-A5原准备UI实码推进：新增窄OpeningClient/Controller/Hook、原Editor浮层及恢复按钮，仍一个3100/T3应用。client行为RED34→GREEN34；controller RED22fail/2pass→GREEN24；组件RED4→GREEN4；原导航RED缺radio→接入后发现测试fixture返回未保存字段造成既有dirty确认，修正fixture如实echo已保存字段（未绕过生产导航保护），随后通过。未知请求关闭浮层仍保留，重连不自动重发、导航重新打开原请求，dataset/epoch和原command隔离；保存预算不是付费授权。

Cicero独立发现两个P2并已关闭：1)256KiB成功响应上限小于合法大聚合，新增真实SQLite中文与JSON转义astral最大字段create/replay/get，两项实际RED后推导并改为2MiB有界流；另有非结束超限流取消反例。2)历史CREATE回放错误地标当前preparing，新增实际RED后所有CREATE确认current=false，只读get才确认当前。独立7文件73/73与补充非结束流PASS，当前确认P1/P2=0。没有读密钥或调用模型。

本片主仓首次114文件1816/1816及双端types实际exit0；稳定树首次build发现漏复制既有runtime测试fixture，补齐显式fixture后真实production build exit0，原准备UI HTTP/SQLite提交后丢响应/收起重入/导航守卫/宿主重启/同命令回放/独立读状态全部exit0，原Studio四图/聚合/unknown/冷浏览器/重启回归也exit0。新流取消测试和截图检查后的标题层级小修后，正在最终重验；不把首次结果冒充最后版本。准备UI smoke只保留同浏览器内存，不宣称冷浏览器unknown恢复；后续Quote/Worker/媒体/两幕/经历目录待继续。

M2-A5最终验收：主仓114文件1817/1817、runtime/Web源码及测试types实际exit0；最后production build、原准备UI（含1024×768桌面边界和1440窗口截图人工检查）、完整opening HTTP恢复、原Studio四图/聚合/重启/冷浏览器全部exit0。当前用户3100原入口再次Chrome验证自动会话、无取码框、原编辑器、刷新复用、shared provider目录初始化，零业务seed和模型调用。Cicero最终PASS，两个P2已关闭，撤回其旧oversize读旧行意见；当前开放P1/P2=0。CI新增两个已实测opening脚本，不发tag或改main。

下一有限序列经只读复核：先用既有Experience表补有界列表/按ID重入原准备UI（冷浏览器发现已提交事实，不冒充丢失内存command恢复），然后主线Profile/Quote→原子接受/根BudgetScope预留与Outbox→planner/PreparedGeneration/一次submit及unknown查询恢复→私有媒体/校验→播放证明/事实/存档节点/情境建议→下一幕。按实际事务逐批迁移与登记真唯一，不一次预建全部远期表，也不把更多CRUD替代视频生成链。第一付费发送前这些门锁必须齐全；仍未获付费预算授权，不调用模型。

本goal轮完成两次实码提交：M2-A4 cbec5ef已CI成功；M2-A5 1488aa5944afd8811965f335e7a9bb42861be11a（21文件）已push既有开发分支，精确CI34745838317当前in_progress，下一轮查询同一作业，不重新触发。主仓1817/双端types与最后production/UI/HTTP/Studio证据已收取exit0。当前3100继续运行原用户目录，本轮未创建用户业务数据；私人根研究文件仍未跟踪。整体goal保持active，下一步按已记录的短恢复入口＋M2-B生成主链继续，不以准备UI闭环冒充整个产品完成。

M2-A6本goal轮上一轮判定progress；精确CI34745838317已completed/success（1488aa5）。实施已提交开局目录与只读重入：无新表/CRUD，以原Experience索引、owner/dataset/排序过滤作用域cursor、默认20最大50页读取同scope封存事实；status来自实际根行，不读取现行draft/registry。runtime首次RED7→GREEN7；HTTP/client新增list实际RED4→GREEN；前端reentry RED7→GREEN7，原Platform冷重入RED后接入，修正测试的弹窗内文本范围（背景也有同额预算，不改产品）。

主会话自检发现null limit被默认吞掉、只读GET迟到跨页面弹窗两个缺口；实际RED2后，严格拒绝null，navigate/edit/openStory统一关闭并推进读取序号。原pending/unknown仍保留，不因关闭原浮层丢意图。既有开局origin=existing、source=null，仅展示真实confirmed.story，不伪造DraftDTO；重入不触发CREATE/当前binding目录/业务写入。51次真实开局的50+1分页、删除游标锚点、原索引EXPLAIN无临时排序、封存关系错误、源草稿删除和权限隔离均已覆盖。

M2-A6最终主仓116文件1839/1839及runtime/Web源码和测试types实际exit0。稳定树最终production build、完整opening HTTP、原Studio四图/unknown/重启/冷浏览器均exit0；扩展原准备UI smoke关闭整个原Chrome进程，另启新Chrome，原草稿改名/删除和provider配置移除后，原我的游玩发现同一开局、封存世界/预算只读打开、焦点返回，业务POST与当前binding目录请求均为零。这证明发现已提交事实，不证明尚未提交的内存意图或视频播放恢复。列表截图已人工检查。Cicero独立4文件43项通过，当前确认开放P1/P2=0。

原用户3100经PID/cwd核对，温和SIGTERM exit0后在同一个数据目录启动，加载compiled list服务；当前Chrome只读验证自动会话、原我的游玩/list返回200、模型目录已初始化、原编辑器/无取码框/刷新复用全部通过。未创建用户业务记录、未读模型密钥/调用付费接口。下一主线明确M2-B执行Profile/Quote/预算授权→持久Operation/Worker/私有媒体，停止扩展更多列表CRUD；整体goal active。

A6已commit74f9eede8b6de13ced2dcae03a85a9ceae3261e5（30文件）并push既有开发分支；精确CI34746646130当前in_progress，下一轮只查询该作业，不另开CI。上一1488aa5已success。当前用户3100使用同一原数据目录运行新compiled list服务，最新只读原页面验证exit0。没有改main/tag/镜像，根私人研究未跟踪。上一goal轮为实码progress（真实冷浏览器发现/重入＋1839测试＋生产和独立证据＋提交），整体goal保持active；A6到此收束，下一主线M2-B执行Profile与Quote/预算/持久任务，不再扩展列表CRUD。

M2-B1开始：按executing-plans/TDD落实已批准的下一主线。Cicero只读确认最小完整切片为Profile契约+一表迁移+in-scope存储，严格text/video判别与模态，阶段限额不是报价；完整迁移链校验不能移除。storeEpoch目前缺宿主来源，明确在Quote开放前补齐，不使用dataset/writeEpoch冒充。A6不再扩展CRUD。

A6精确CI34746646130 completed/success（74f9eed），对应计划已勾验。M2-B1真实RED15项（先建未实现接口骨架后执行行为断言）→纯契约12通过/SQLite3明确被旧单migration拒绝→完整迁移链与Profile存储GREEN。自检video操作族遗漏，新增structured-generation混入video的RED后严格限制当前t2v/i2v，旧parseBindingSpec保持拒绝text。聚焦5文件132及双端types已exit0；补共享多模态binding/零fetch/底层不可覆盖/缺引用/已删除owner反例19项通过。无损增量升级测试通过，原migration未改、17表14真唯一、零FK；未知能力快照不是准入。

production build、原准备UI冷浏览器、完整opening HTTP已通过；Studio调用时误写不存在脚本名local-studio.mjs，未执行产品测试，已更正为仓库真实local-story-ui.mjs重跑，不把该错误当通过。主仓全量与独立Cicero还在进行。用户库尚未升级/未删除数据，没有读key或调用模型。

Cicero发现Profile hash envelope的P2（合法65500长度/深度snapshot被再次包裹后超过相同canonical边界），主会话补两项真实RED并改固定tuple只单独规范化snapshot，保留输入限额；pin/复用/断开重读均GREEN。独立2文件50/50复核PASS，当前P1/P2=0。原首次主仓/production证据不当作修改后版本验收，最终全仓和生产重跑中。

用户库升级过程已如实记录：确认原3100 PID/cwd后SIGTERM退出0；使用私有SQLite backup API备份。首个临时维护脚本忘记显式close Python连接（with不关闭连接），Prisma报database locked、没有完成迁移；错误后提前重启造成短暂authoring读取500，已立即停机纠正，不作为可用状态。临时脚本修为关闭所有备份句柄后重跑，增量迁移成功；16张原业务表值摘要完全相同、原migration记录完全相同、0条新Profile、integrity_check=ok、所有表FK为空。正式runtime --check实际exit0，之后才重启同目录同3100。备份位置受限记录于/tmp/everwoven-profile-upgrade.json，不写入仓库或公开数据；原图片目录未动。当前Chrome只读验证进行中。

M2-B1最终主仓117文件1863/1863＋runtime/Web源码/测试types实际exit0（/tmp/everwoven-profile-final-main.log）。修正后稳定树production build、原准备UI真实提交/丢响应/重启/冷浏览器恢复、完整opening HTTP、原Studio四图/聚合/unknown/重启/冷浏览器均exit0（/tmp/everwoven-profile-final-*.log）。当前唯一3100在用户原目录运行，迁移后原自动连接/无连接码/原我的游玩/原角色剧本编辑器/刷新复用真实Chrome只读通过、业务seed/模型调用为0（/tmp/everwoven-profile-current3100.log）。独立Cicero P1/P2=0，Profile合法边界hash问题已RED/GREEN关闭。此片只完成固定执行身份，不宣称Quote/视频/两幕/整个产品完成；下一主线storeEpoch+Quote及预算/任务依赖继续。无main/tag/镜像发布。

B1已commit753c928b5e4fa7e5853deb7b67537d94a491e18b（23文件）并push既有开发分支。精确CI34747523380当前in_progress，下一轮查询同作业，不重新触发；上一74f9eed CI34746646130已success。唯一3100运行PID30345（session56847），用户库已审查增量升级并保留私有备份，业务行/owner/dataset未改。当前goal保持active；本轮实码progress，不将1863测试/内部Profile当全产品完成。

Cicero下一B2具体切口已读码确认：host/store-epoch独立严格状态文件，旧库停机显式登记/新库ready前写入，普通启动缺失不自动生成；恢复标记与file+dir持久化、authority从Host注入而非body或writeEpoch。首幕Quote仅收protocol/dataset/command/experience/revision/kind=opening，复用真实preparing封存事实。沿现有provider-startup同一快照补Profile解析和窄quote-evidence端口，不新建第二registry。价格能力/artifact任缺阻断，整数/有理数向上取整覆盖三阶段总调用；Quote一表+receipt同Gate，历史回放不续期/不代表可接受。随后首次接受一次实现BudgetScope/双预算/TurnRun/Reservation/Quote消费/Outbox，不扩展报价管理CRUD。未有付费授权继续仅实现与有界fixture验收，不读key/付费。

上一goal轮为实码progress（753c928/Profile、正式增量迁移、1863/生产/当前3100验证并push）。本轮读当前worktree，CI34747523380仍in_progress，继续原作业。按已记录B2切口开始storeEpoch实际宿主来源，不把它冒充dataset/writeEpoch；随后首幕Quote主线，不扩展管理CRUD。

2026-09-14用户纠偏：基础设施拆分过细，必须优先真正可玩的主流程。收紧实施，不再新增管理CRUD/通用抽象或长方案评审；同3100、已存配置、官方任务、私有媒体、播后回应为主线。此前epoch实码13RED→17GREEN、既有host集57GREEN、独立复核PASS保留并收尾。B1精确CI34747523380 success已核验。

当前直接处理实际阻点：旧Web minimax-jobs无正式调用点且硬编码CN、仅凭HTTP状态声称拒绝，迁到runtime统一固定BindingVersion，CN/io明确路由、回执带operation/binding/account/region/model/hash、按原ref查询，同账户换key可查而跨账号拒绝；完整保留官方8个usage字段、响应有界、不自动重发POST。官方query文档本轮重新读取核验task_type/modality/usage/最近7天，create页本次timeout未假称成功。新15行为RED→GREEN；删旧无人使用实现，不保留兼容包装。仍未读密钥或调用付费模型，尚未完成持久worker及UI。

transport自检补adapter版本RED，改为复用已有validateMiniMaxBinding/minimaxEndpoints统一约束，不再维护第二套地区/型号判断或兼容参数别名。测试直接由真实registry生成绑定，16项transport＋17项epoch及双端types通过。独立agent服务两次返回认证失败（外部审查服务故障，非MiniMax任务故障）；停止重复派发，不读取凭据修复，transport独立审查标记待补，不能声称已PASS。epoch上轮独立PASS保持其已审范围。

当前原3100启动句柄已不存在且端口无监听，权威检查确认服务停止后才执行旧host显式init-epoch，实际exit0且不打印epoch/凭据，runtime --check通过，然后启动同目录同3100。上次完整主仓/production+原开局UI已通过，adapter约束最后小改后聚焦/类型也通过；最后全量/构建及当前原页面验证在继续。没有视频付费调用、没有新增用户剧情/图片业务数据。

本轮最后主仓118文件1866/1866及runtime/Web类型exit0（/tmp/everwoven-transport-final-main.log）；最后production build及原开局/unknown/冷浏览器重入UI smoke exit0，当前3100原页面只读检查exit0。原连接码表单仍不存在。真实视频尚未在原页面播放，明确未闭环。transport独立复核因外部agent认证错误待补，不把主会话自检当独立PASS；现有epoch独立PASS限其范围。下一步按用户纠偏以完整纵向切片直接接start/任务/播放器/播后第二幕，不继续增加孤立管理能力。


上一提交 f6fdef07bdd50bc8e2135f89d218459faaa30d01 已 push 既有开发分支；精确 CI34812426859 completed/success。transport 的独立复核仍因外部 agent 认证失败待补，不把主会话验证当独立 PASS。整体 goal active，未合并 main、发 tag 或发布镜像。

2026-09-14 主线推进：首幕/回应报价、同事务 Quote 消费＋根/经历预算＋Turn/Reservation/Outbox、一次提交与恢复查询、播放后决定节点、下一幕 parentTurnId 已加入 runtime。schema 增量为五表和 Experience.budgetScopeId，共22表15业务唯一零FK；尚未应用到用户库。定价9项首轮真实RED→GREEN；随后SQLite生成/Worker测试覆盖事务注入失败回滚、进程重开、未知提交不重发、租约过期与迟到结果、播前无选项和两幕自由回应。最后聚焦检查进行中，未拿前一1866结果替代。

实现边界明确：这是内部应用链路，尚未注册原页面/Host的正式 executor，也未落地私有视频传输和真实付费调用。测试的HTTP响应、导演和媒体检查是测试替身；没有写用户剧情或读取密钥。预算当前保守持有，实际费用结算/释放、存档fork和回应草稿编辑API继续待做，不能声称全面闭环。上次 f6fdef0 的精确CI34812426859已success。


本轮最终验证：主仓完整测试与 runtime/Web 类型均 exit0（/tmp/everwoven-generation-final-main.log）；隔离源码生产构建、原准备UI/冷浏览器重入 smoke exit0（/tmp/everwoven-generation-isolated-build.log、*-ui.log）。主仓原有大页图片维护测试完整并行时超5秒，单独原断言约2秒通过；仅将该127次真实宿主检查的单例上限调为15秒，未改维护实现或断言。其他测试没有放宽。

用户原3100 PID94510/cwd确认后温和停机exit0；独立SQLite backup完成并关闭所有句柄后执行第三个增量迁移。原17业务表按旧列逐行摘要相同、前两次migration记录相同、五个新表为空、integrity_check=ok、零FK。私有备份位置仅存/tmp/everwoven-generation-upgrade.json。正式 runtime --check exit0 后，同目录同3100已重启（session74220/PID4287）；当前Chrome自动会话、原角色/剧本编辑器、我的游玩目录、刷新复用只读验证exit0（/tmp/everwoven-generation-current3100.log）。没有写入用户剧情、图片或生成测试数据。

最新用户约束：用户已有 API Key；明确要求实现写完之前不做昂贵测试。所有本轮已运行验证均为本地/测试替身，付费调用为0；后续先写完正式组合，再核对明确预算与用户授权。用户截图只显示 OPENROUTER_API_KEY、POLLO_API_KEY、POLLO_BASE 名称和截断URL，不能当作MiniMax官方凭据证明。已异步询问不含凭据的完整POLLO_BASE、服务名和模型ID；不要请求/记录Key值，也不要把POLLO Key发送给官方MiniMax或反过来。截图可能表示文字与视频两个独立供应商，须以真实端点协议确定适配器。先前cn/io提问可由实际供应商信息取代。

下一步仍围绕同一原页面：正式执行器（文字规划/视频/私有媒体/内容结果）、Host/tRPC、原准备费用确认和单视频舞台；随后实际结算、草稿编辑和存档fork。内部两幕测试已经覆盖playback后才给选项和parentTurnId，但原页面尚未播放真实生成视频，未声称完成。维持无付费调用；provider具体协议等待用户提供公开地址，不凭变量名猜接口。

本轮已本地提交 57d327b（22文件，持久生成/播放后续幕内部链路），尚未推送或触发新CI。最新约束下先继续写完正式供应商组合和原页面；不进行付费API测试。当前公开供应商地址/模型ID的异步提问待回复，Key值不请求、不采集。原3100保持session74220/PID4287运行。

2026-09-14 生成播放 API 实施：上一轮截图澄清没有实码，本轮继续推进可独立完成的代码，不等待公开供应商地址。按已批准执行计划，新增 GenerationPlayback 服务，将历史读取/播放完成从需要现行 GenerationPolicy 的生成服务分离；原 Host 注入认证 owner/dataset 与 storeEpoch、固定 SQLite 文件身份。原 `/api/trpc/generation.get`、`generation.completePlayback` 和浏览器 PlaybackClient 已实现；报价/接受尚未暴露到 HTTP，不会接受没有正式调度器的付费任务。没有读取 Key 或调用付费接口。

新增严格 PlayDTO/SceneResult/PlaybackResult 输出校验，worker 与 API 共用建议规范。状态必须匹配当前 turn；媒体只给私有 ID/时长；选项只在 awaiting/viewed 返回。播放通知事务前验证候选内容，损坏数据不写决定节点/草稿/回执。历史播放回执按原命令的经历、修订、回合、媒体校验，后续 GET 读取真实当前状态。HTTP 限 origin、cookie、marker、非batch和有界输入；浏览器有界流与错误脱敏，不自动重发 mutation。此接口仍是客户端播放完成通知，尚不证明观看覆盖率；正式媒体/播放凭据门锁待接入。

独立只读评审 Aquinas（01a09ec1-0b3d-7e01-a667-751663c4b717）发现 P2：按 createdAt 排序会在系统时间回拨后选中上一幕。已新增 currentGenerationTurn，以已接受报价的逻辑 experienceRevision 定位、核对 acceptedTurnId/quoteId/owner/经历/interactionEvent 双向关系。播放 get/complete、回应 quote/accept 共用规则；没有新增 schema/迁移或假唯一。真实 SQLite 三幕回拨测试证明第二幕时间早于第一幕仍能正确读取/播放/选择，第三幕 parent 指向第二幕。Aquinas 复核关闭 P2，4文件50项及17个内存探针通过，当前该切片开放 P1/P2=0；此评审不等同于旧正式 executor/整个产品已通过评审。

验证记录：聚焦6文件63项通过；主仓完整125文件1939项、runtime/Web源码及测试类型检查均exit0（/tmp/everwoven-playback-main.log、*-types.log）。初次类型检查发现测试 Header fixture 推导带 undefined，修为显式 HeadersInit[] 后通过，未放宽断言。独立稳定树 /tmp/everwoven-verify.zRVKTD 覆盖当前显式源码，production build exit0（/tmp/everwoven-playback-production.log）。原3100核对PID4287/cwd后温和退出exit0，同数据目录重启为session30446/PID9207，无迁移/用户业务写入。真实Chrome原入口、自动会话、原角色/剧本编辑器、我的游玩、刷新复用与认证 generation GET 到真实Host全部exit0（/tmp/everwoven-playback-current3100.log）；该GET验证不冒充浏览器已播放视频。

API文档与技术方案已更新架构/时序/状态/回执边界。仍待落实：正式供应商执行与价格准入/调度、私有媒体与播放凭据、原准备费用确认及舞台绑定、响应草稿编辑、实际费用结算、合格存档与fork；然后在明确预算授权后验收两幕真实生成和重启恢复。POLLO完整公开地址/文档/模型ID仍待用户提供；不得凭截图变量名把POLLO当官方MiniMax。全程付费调用0，goal保持active。

本切片已commit并push eb2bd816b878fe7af02100b28dc152b30b0ea9ea（同时带上此前本地57d327b），精确CI34817574585已启动，watch会话14921仍在运行；没有发tag/发布镜像。后续只跟踪该作业，不重复触发。

接供应商前的只读检查另确认一个下一步工作：GenerationExecutor.jobs 目前直接使用 createMiniMaxVideoJobs 返回类型，Worker.planning 调用 buildMiniMaxRequest，ProviderTaskReference/model/ratio/resolution也来自官方适配器。正式POLLO接入前须抽出供应商无关的视频任务port，由各适配器负责prepare/submit/read与固定账户引用验证，Worker保留预算/持久阶段/unknown语义；不能把官方适配器仅改baseURL冒充POLLO。此项尚未实施。

公开资料复核（2026-09-14，仅匿名网页）：Pollo的 https://api.pollo.ai/minimax/minimax-h3 明确存在MiniMax H3提交API，文档展示pollo.ai域名、x-api-key及taskId；https://docs.pollo.ai/llms.txt 也列H3与H3 Ref。本轮未取得H3 Max同等API证据，尝试对应Max页面未成功，不能据此断言Max无API，也不能用H3价格/接口替代Max。用户截图POLLO_BASE仍被截断，实际账号供应商/协议待确认。未下载/使用页面skill或执行其示例命令。

2026-09-14 视频供应商端口切片：上一goal轮为实码progress（eb2bd81）；精确CI34817574585已completed/success。继续解除Worker对MiniMax枚举/请求构造器/结果类型的直接依赖：新增 VideoJobAdapter 端口，prepare/validatePrepared/reference纯操作由供应商实现；submit/read保留单次提交及原任务查询。MiniMax官方适配器实现该端口，端点和请求规格仍严格受原官方binding限制；没有添加POLLO假实现或回退供应商。

每个适配器携带bindingId/hash，Worker在执行/恢复前核对封存绑定；任务reference显式providerId并双重校验operation/binding/account/region/model。归一化结果独立校验，成功才带视频，保留usage缺失，不将其当0；下载恢复时重新校验任务与报价规格、落地时长。真实SQLite测试用仅测试目录的第二供应商/model/1080p/8s驱动同一Worker完成，证明业务流程无MiniMax枚举限制；不代表注册第二个生产供应商。补错配adapter在planner前阻断、prepared篡改不提交、错误task不下载、坏持久结果不落地。

Aquinas独立先提出旧reference兼容与无限10秒重试。按用户明确“不做旧协议兼容”不加入旧格式分支；只读核实原用户库generation_turns为0，正式生成入口本来尚未发布，不迁移/删除用户数据。无限重试意见采纳：固定身份错误和materializing坏持久结果转unknown/blocked，暂停经历、清租约、持有预算，之后不自动重试；临时query错误仍只重查原任务。坏引用测试推进60秒后仍无传输；Aquinas复核撤回不适用兼容建议，3文件35项通过，当前该切片P1/P2=0。

最终验证：主仓126文件1948项、runtime/Web源码及测试types均exit0（/tmp/everwoven-video-port-final-main.log、*-types.log）；稳定树当前源码production build exit0（/tmp/everwoven-video-port-final-build.log）。早期1947项是新增坏引用用例前结果，不作为最后版本。原3100真实Chrome自动连接、角色/剧本编辑、我的游玩、认证generation GET与刷新复用只读检查exit0（/tmp/everwoven-video-port-current3100.log）。没有新迁移、用户业务写入、Key读取或付费调用；原站保持运行。

下一具体实施为生成视频的私有落地/读取：当前AssetDTO固定image/webp、10MB图片限额和Sharp归一化，不能把视频塞进图片流程。需要视频独立元数据与下载/文件验证/恢复，复用宿主owner/dataset与私有目录身份边界；浏览器只拿媒体ID，经已认证的受限流式读取供单video播放。随后接正式executor/调度、费用确认UI、播放凭据及回应草稿/存档fork/结算。POLLO公开base/协议与model仍待确认，不能凭变量名猜地址。整体goal active，尚无真实两幕验收。

视频端口切片已提交并push b0f3dc94e87ac45644c06f1b577a0597b832495c。精确CI34818989885当前in_progress；此前eb2bd81的CI34817574585已completed/success。下一轮核验同一作业，不重新触发；main/tag/镜像未改。主仓代码已提交，仅这条后续进度记录留待下一次同步。


2026-09-14 私有视频落地/读取切片：上一goal轮主要回复截图供应商映射，未新增实现，按no-progress重新核验；b0f3dc9精确CI34818989885已completed/success。本轮继续代码：独立VideoDownloadSource/VideoProbe/PrivateVideoStore，严格MP4元数据，不复用WebP图片管线。目录身份复用，owner/dataset绑定；128MiB流限额、固定公网IPv4/HTTPS主机白名单、不跟随重定向或发送供应商Key、下载/DNS取消及response关闭。文件独占UUID/0600、同FD完整hash与ffprobe、sync后原子发布非权威hint；重启优先复核文件/视频轨，DB最终media决定播放授权，候选清理未实现。

新增原应用/api/local-generation-media/[turnId] GET/HEAD/Range，以及严格query和浏览器URL构造器。真实Host会话、owner/dataset/经历/ready或viewed回合/accepted quote双向关系授权后，返回同一已校验FD；HTTP负责完成/取消/超时释放，不保留SQLite连接。元数据/源URL/私有路径不传前端，GET不会提交生成、触发选项或播放回执。支持200/206/416/If-Range，强ETag但no-store，每次请求完整hash。默认本地读取维持同站；HEAD按只读方法校验，不要求mutation头。

Aquinas独立评审发现并修复三项：1)低像素视频不能只凭resolution标签通过，probe必须从受信封存规格获取精确width/height，未安装尺寸映射拒绝；2)不能用长音轨/容器时长掩盖短视频轨，校验视频轨duration/start_time及容器/音频一致性；3)坏hint的UTF8/JSON/字段错误归一为PRIVATE_VIDEO_CACHE_INVALID，使实际Store→Worker暂停unknown/blocked并保留预算，不每10秒反复读取。真实坏hint测试覆盖字段/JSON/UTF8三种且60秒后无再次执行，确定错误不自动重试。最终独立复核49/49，所审范围P1/P2=0。

主仓最新验证130文件2039测试exit0、runtime/Web及测试types exit0，证据/tmp/everwoven-private-video-final-main.log与*-types.log。isolated当前源码production build exit0（/tmp/everwoven-private-video-final-build.log）。原3100Chrome自动连接、认证读取及剧本/角色/MyPlay与刷新复用只读验证exit0（/tmp/everwoven-private-video-current3100.log），没有业务seed/用户库写入。媒体专用真实浏览器smoke使用同一应用生产构建+一次性host，验证本地ffmpeg视频解码/seek/ended、HEAD/Range/来源拒绝、应用进程重启和原文件hash；明确是测试素材，不是模型结果或正式Stage接线。CI新增ffmpeg依赖及该smoke。技术方案/API架构和时序同步于PRIVATE-GENERATION-MEDIA.md。

实施中隔离验证的临时根node_modules软链被pnpm拒绝，改用已有独立依赖树；一次并行pnpm任务触发auto-install竞争导致types启动失败，任务结束后顺序执行types成功。没有通过删除用户目录解决；最终以实际exit0结果为准。

剩余主链保持原范围：生产供应商/文本/媒体执行器组合、受信价格与精确尺寸/CDN准入、调度、原页面费用确认及Stage绑定、播放覆盖凭据、回应草稿编辑、费用结算、合格存档及fork，最后明确预算授权下两幕真实生成/重启验收。POLLO完整公开base/协议/model仍待确认；没有请求或读取Key值，付费模型调用0。整体goal保持active，不能宣称产品闭环。

本切片已commit并push fce0afd147e45f43e7f3b63857a2f32d5c08663a（feat(runtime): persist and serve private generated video）；精确CI34822086173当前in_progress，watch跟踪同一作业，日志/tmp/everwoven-private-video-ci.log。最终本地production媒体浏览器smoke再次exit0（/tmp/everwoven-private-video-browser.log）。尚不将本切片CI标成功；下一轮核验此作业，不重复触发。不合并main、不发tag、不发布镜像。


2026-09-14 有界导演/文字供应商实施：fce0afd的精确CI34822086173已completed/success。本轮安装@langchain/core 1.2.11，加入单次Runnable导演、固定prompt/schema/hash、供应商无关StructuredTextModel、官方OpenRouter结构化请求适配器，以及GenerationExecutor组合与已授权私有视频FD采样。模型ID允许合法publisher/model命名空间，内部连接/账户ID规则保持独立。OpenRouter固定模型和端点偏好、不fallback、不自动修复或付费重试；模型输入token上界计算器必须显式安装。成功文字观察要求注入observe持久完成，正式观察/结算服务尚待落地，无生产no-op默认。未读取Key或调用付费供应商。

视觉核验按实际视频JPEG样本生成summary和2–4个回应候选，拒绝不确定结果、错媒体/错hash/越界帧、无证据和重复建议；不将未核验音频或未采样事件作为事实。候选仍遵循原Worker：视频ready不产生decision，播放完成回执后才出现交互。内部测试以明确的HTTP/模型替身覆盖，尚未接入原舞台生产操作。

Aquinas独立评审修复：遗漏LANGSMITH_TRACING_V2可能使LangChain自动导出剧情，现五个tracing/verbose标志均前置阻断；采样90秒+文字60秒可能跨越120秒租约，现Worker整个阶段共享100秒期限并扣除领取耗时，传给采样/文本/observe。进一步复现身份重校验/事务等待后的迟到成功，现writer事务入口和最后写入后检查signal与时钟，超时推进回滚、unknown独立落库、预算held。真实SQLite两类提交窗口回归通过；独立只读复核已关闭该P2，所审范围无遗留阻塞。

本轮主仓132文件2079测试与runtime/Web源代码及测试类型检查均exit0（/tmp/everwoven-director-final-main.log、*-types.log）。隔离独立依赖树更新lock后production build exit0（/tmp/everwoven-director-final-build.log），原3100真实Chrome自动连接/认证generation GET/角色剧本/MyPlay及刷新复用只读检查exit0（/tmp/everwoven-director-current3100.log）。无新迁移、用户数据seed或原站重启；采样使用一次性本地视频素材，付费模型调用0。

架构/执行时序/供应商限制记录于docs/api/SCENE-DIRECTOR-V1.md。下一实施仍为持久文字观察与结算、受信模型计量/价格/尺寸/CDN与凭据解析、Host executor/scheduler、原页面quote/accept/单视频Stage/异步草稿及播放覆盖凭据、存档fork。POLLO完整公开base/协议/model仍待确认，不能将截图变量名推断为MiniMax官方API。总goal active；当前组件和通过的离线验证不构成完整产品或两幕真实生成验收。

隔离production媒体浏览器smoke也已exit0（/tmp/everwoven-director-media-browser.log）：真实Chrome解码/seek/ended、HEAD/Range、进程重启和hash保持，测试fixture清理完成；不代表正式舞台或模型内容验收。
