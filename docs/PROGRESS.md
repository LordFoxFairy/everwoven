# Everwoven · 实施进度

更新：2026-09-12。**这是实施真值台账，不用设计完成代替功能完成，不用commit代替验收。**

**当前执行入口：C1c-2显式资产生命周期已提交bd4b1db，最终主仓1090/1090、双端typecheck、生产三Chrome和独立复核通过。bd580f7 / 50d67cb均已推送且远程CI成功；Host/HTTP、原图片/剧本聚合及维护/reset仍待打通，不通知总体完成。**

## 当前决策（按最新用户指令）

- 一套T3应用、原页面接前后端；Prisma + SQLite、零外键、只保留真实唯一约束。
- **新基线直接重建，不做旧协议/旧回执/旧数据兼容或迁移。** 用户允许清空项目业务数据。清理不得包含源码、密钥、下载资料、其他应用数据。
- Demo仍由前端维护，正式数据只走后端；移除临时数据库编辑器和旧正式浏览器存储分支，不保留双轨用户入口。
- 用户要求完整闭环真正落地后才通知：普通推进只更新本文件，已设置当前任务的定时继续跟进（everwoven）；遇到必须由用户给出凭证/授权的真实阻碍才打断。
- 创作持久化与模型生成分批验收；尚未确认的模型ID/费用/实时能力不得包装成已接通。

## 五条主线

| 主线 | 当前状态 | 下一可验收结果 |
|---|---|---|
| 1 前端逻辑 | 原角色库正式异步CRUD与共享连接已接通；原剧本聚合/图片待接 | 原编辑器完整聚合保存；上传读取均经端口 |
| 2 后端逻辑 | 根CRUD单一StorySettings、角色模板六操作、owner/dataset/WriteGate/CAS/回执/共享会话；16表baseline及DDL门禁已实现 | 图片/聚合用例、受限reset（datasetId和角色六操作已接入） |
| 3 整体闭环 | M0临时面板闭环通过；原角色+图片+剧本尚未闭环 | 原页面创建→保存→清缓存→进程重启→相同内容读回，异常路径通过 |
| 4 技术方案 | M1详细稿已写，按新指令删除兼容设计；独立复核通过 | 接口/字段/事务/SQL/架构图/时序图/验收矩阵一致 |
| 5 推进记录 | 本文件建立 | 每批记录改动、测试、失败、未验证项、下一步、commit及发布状态 |

## 已有证据（历史验证，不冒称本轮新跑）

| 切片 | 代码/文档 | 验证 |
|---|---|---|
| M0-C1 存储端口 | fef8eb4 | 用例从Prisma抽离为事务端口；历史主仓验证见实施记录 |
| M0-C2/C3 本机真实草稿 | 6e4de7f；8c0b2c2记录 | [CI 34703786441](https://github.com/LordFoxFairy/everwoven/actions/runs/34703786441) 成功：361测试、typecheck/build、Docker与HTTP浏览器、CRUD重启/丢响应 |
| unknown外层导航保护 | bdf861f | RED复现卸载；低并发全量362/362；最终聚焦37/37和typecheck通过；默认并发曾4项超时，未放宽断言 |
| 原页面集成范围 | f0cf2ff | 规格已复核；后续用户要求取消兼容，本轮同步修订 |

发布边界：已发布版本仍为v0.1.0；当前这些创作切片不是旧镜像已有功能。此前确认远程开发分支到8c0b2c2；后续本地提交未在本轮核实推送状态，不声称已发布或已构建新镜像。

## 当前批次：M1-A0 端口与会话边界

- [x] 写明详细技术方案：[INTEGRATED-AUTHORING-M1](architecture/INTEGRATED-AUTHORING-M1.md)。
- [x] 建立[执行计划](superpowers/plans/2026-09-12-integrated-authoring-m1-a.md)。
- [x] 根据最新用户要求去掉兼容路线，定义项目业务数据定向重建边界。
- [x] 提取异步端口；所有类型引用直接依赖端口，不留组件re-export别名。
- [x] 校验session真实响应；畸形/状态矛盾不能显示连接或退出成功。
- [x] 主仓聚焦133/133、typecheck、规格和代码质量复核；详细设计复核通过（非完整M1验收）。
- [x] 记录本批精确文件；提交主题 `refactor(authoring): isolate ports and adopt clean baseline plan`（本地，不含发布）。

并行分工：Feynman处理聚焦前端端口/测试；Hegel只读复核后端契约和恢复边界；主会话维护详细方案、集成和进度。没有额外外部worker或第二应用。

## 后续队列（未实现，不打完成勾）

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
