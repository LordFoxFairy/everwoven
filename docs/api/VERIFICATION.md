# 技术方案/API1.0 · 评审与验证记录

2026-09-10。本次交付是**文档、契约和审核样本**；没有实施47个API操作，没有迁移用户数据库，没有付费调用模型。

[技术方案](../architecture/TECHNICAL-SOLUTION-V1.md) · [API语义](CONTRACT.md) · [机器契约](openapi.json)

## 1. 本次实际执行（自审修订2更新）

环境：macOS；Node22.22.2；Python3.13.5。文档验证依赖安装于独立临时目录，不加入应用依赖。Prisma审核CLI7.10.0与Mermaid CLI11.17.0来自既有工具缓存。

| 验证 | 本轮结果 | 证明范围 |
|---|---|---|
| OpenAPI3.1.1校验 | openapi-spec-validator0.7.2通过 | OpenAPI结构/规范约束，不是路由上线 |
| JSON Schema正反样本 | 51项通过；jsonschema4.26.0，启用format检查 | 字段、类型、互斥分支、setup/建议降级、报价参数/控制摘要等 |
| 引用及结构断言 | 1483次断言通过，含51样本 | 内部ref、操作ID、鉴权/幂等/删除前置条件、生成物确定性；不等同1483个业务场景 |
| 接口盘点 | 36路径、47操作、87schemas | 全部x-implemented=false，M0–M3明确分期 |
| Prisma schema validate | 通过 | 现有15模型审核schema可解析 |
| Prisma migrate diff | 通过且输出非空，与审核DDL逐字一致 | DDL可重复生成；没有执行正式迁移 |
| 无外键/应用协议样本 | 24测试通过 | Python SQLite3.49.1、DELETE journal临时文件；不是Prisma驱动/WAL认证 |
| 图册 | 6份源与内嵌代码核对；本轮改动的ER/恢复图重新渲染 | 图源可追溯；回合PNG已目视检查，无明显截断/重叠 |
| 现有工程测试 | 14文件、137测试通过 | 现有Web/domain/适配器测试，无新增runtime功能 |
| 现有typecheck/build | 均通过 | 当前工程构建；产物仍是原有路由，不含本契约全部端点 |

样本包含：无owner注入、空patch拒绝、settings整体替换、金额/序号精度、Quote需版本、布尔confirmed不足以开始、控制接管前置条件、旧cursor拒绝、音频模式必填、建议失败保留自由回应等。**对象归属、真实报价上界、跨窗口竞争、事件恢复和费用仍需运行时集成测试。**

## 2. 独立只读复核

复核者：原生子代理Helmholtz；主会话负责全部文件写入与主仓验证，不以子代理的完成状态代替测试。

首轮发现五个协议缺口：快照/cursor同一读快照及恢复世代、各层revision与历史回执、可绑定的费用确认、控制续租与播放实例、删除后可见性/恢复。均已写入CONTRACT与同步架构。

第二轮发现并修正：

| 问题 | 修正 | 样本/契约位置 |
|---|---|---|
| 新窗口不知道接管epoch | Experience.controlSummary提供无秘密的epoch/client/expiry | ControlSummary；CONTRACT§6.1 |
| 报价只返hash/ID，不足知情确认 | GenerationSummary公开素材用途、处理摘要、有效媒体规格与声音模式并纳入hash | GenerationSummary/QuotedInput；§5.2 |
| 建议失败没有合法自由回应节点 | suggestionState=unavailable保留节点/草稿；空建议但自由输入；只允许本地建议恢复 | Interaction条件schema；§6.2 |

最终复核：Helmholtz确认上述3项可关闭，限定于文档与机器契约；本轮限定范围内未发现修正引入的直接冲突。主会话已重新运行45项样本/结构验证，不以子代理回执代替实际实现验收。

## 3. 尚未通过、不能被本轮替代的门槛

- **M0：** 精确依赖安装组合，真实Prisma/native SQLite引擎与WAL，HTTP身份/CSRF/ETag，WriteGate实际连接锁行为，正式迁移/备份/恢复/磁盘故障。
- **M2：** Quote/ControlLease等专用持久结构、秘密保护与租约重放例外、派发门锁、崩溃未知提交、费用原子预留/结算、cursor世代隔离与流重连。
- **官方模型：** 精确供应商/modelId/端点/素材路径/价格与音频能力的官方资料及有预算实测；现有候选名不是验证证据。未发出付费调用。
- **M3/M4：** 真实视频语义评测、两轮参与后果、用户体验与Tauri真机。不把静态原型或Mock通过称作实时生成完成。

设计基线建议批准进入M0；以上门槛按阶段阻断上线，不在本次承诺全部完成。

## 4. 复现

从项目根目录执行。依赖只供审核，不是应用运行时依赖：

```sh
python3 -m venv /tmp/weiwan-api-review-env
/tmp/weiwan-api-review-env/bin/pip install -r docs/api/requirements-review.txt
/tmp/weiwan-api-review-env/bin/python docs/api/verify_contract.py
python3 docs/architecture/data/verify_m0.py
pnpm test
pnpm typecheck
pnpm build
```

脚本会检查OpenAPI/ENDPOINTS与生成器输出一致；若故意调整契约，先更新生成器、生成文档及样本，再运行验证。Prisma审核命令与边界见[data/README](../architecture/data/README.md)。

## 5. 本次文件范围

新增：TECHNICAL-SOLUTION-V1交付入口、API CONTRACT/OpenAPI/接口表/正反样本/审核生成与校验工具/依赖清单/本记录。

同步：ARCHITECTURE§9及回合准入、DATA-DESIGN的传输映射/新状态规划、M0–M4计划、图册04/06及对应渲染、README与技术选择入口。自审修订2在15模型审核SQL中新增Experience初始预算字段；新状态是后续迁移任务，不能直接把当前审核schema称为全量API数据库。

## 6. 自审修订2

新增Connection显式选择、Quote执行profile与动态像素语义、recoveryTarget、初始预算字段/重开连接测试。Provider规范明确输入场景、账户地区、完整计量、7天查询窗口与最终请求准入。详见[自审报告](../architecture/SELF-AUDIT-2026-09-10.md)。上一轮的45/23等计数为历史结果，表1是本轮更新。当前接口版本仍为未实施的1.0.0评审候选，本次有必填字段变更；正式发布前应从最新契约重新生成客户端，不声称对旧候选生成物兼容。
