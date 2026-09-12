# Everwoven · 实施进度

更新：2026-09-12。**这是实施真值台账，不用设计完成代替功能完成，不用commit代替验收。**

**当前执行入口：M1-A2源码已提交并推送3c0c9dd，主仓604测试/typecheck通过，CI 34711146356已成功；M1-B正式角色服务与原角色库正在按已审核计划实施。普通阶段进度不通知用户。**

## 当前决策（按最新用户指令）

- 一套T3应用、原页面接前后端；Prisma + SQLite、零外键、只保留真实唯一约束。
- **新基线直接重建，不做旧协议/旧回执/旧数据兼容或迁移。** 用户允许清空项目业务数据。清理不得包含源码、密钥、下载资料、其他应用数据。
- Demo仍由前端维护，正式数据只走后端；移除临时数据库编辑器和旧正式浏览器存储分支，不保留双轨用户入口。
- 用户要求完整闭环真正落地后才通知：普通推进只更新本文件，已设置当前任务的定时继续跟进（everwoven）；遇到必须由用户给出凭证/授权的真实阻碍才打断。
- 创作持久化与模型生成分批验收；尚未确认的模型ID/费用/实时能力不得包装成已接通。

## 五条主线

| 主线 | 当前状态 | 下一可验收结果 |
|---|---|---|
| 1 前端逻辑 | 原页面仍是浏览器创作；临时面板有真实CRUD。端口提取/会话校验已完成 | 原角色库异步CRUD；原编辑器完整聚合保存；上传读取均经端口 |
| 2 后端逻辑 | 根CRUD单一StorySettings、owner/WriteGate/CAS/回执/本机会话；新16表baseline及DDL门禁已实现 | 角色/图片/聚合用例、受限reset（datasetId本批已接入） |
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
