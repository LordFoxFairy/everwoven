# M2-B1 — 固定执行配置（已批准主线的有限实施片）

执行 executing-plans / TDD，主会话唯一写入，Cicero独立只读审查。A6到此收束，不新增管理页面或列表CRUD。

## 范围

一张ExecutionProfileVersion不可变表；同一个ProviderBindingVersion保存严格区分的text与video快照。Profile在同一WriteGate固定planner/video/validator身份、输入模态、提示与输出schema/graph版本和摘要、调用及token上限、阶段费用上限/币种。保留视频原有严格读取，不将text视作job。unknown能力仅可存档，不能成为Quote准入证据。

- [x] RED：严格契约、绑定模态、真实SQLite复用/漂移/跨owner/回滚/重启测试。
- [x] GREEN：纯契约、窄in-scope原语与Prisma存储。没有网络、密钥读取、公开管理CRUD。
- [x] 正式增量migration；完整批准迁移链+精确DDL指纹；只增一个真唯一键，零外键。不重写旧migration，不reset用户库。
- [x] 主仓测试/类型，生产构建/原页面回归，独立复核，文档、明确路径提交、精确CI（主仓1863/双端types、生产build/UI/HTTP/Studio、原3100只读和独立审查已通过；753c928精确CI34747523380 completed/success）。

Profile不是费用授权。下片紧接受控宿主storeEpoch与Quote，之后BudgetScope/原子接受/Outbox，再持久Worker和视频链。未有付费批准不调用模型。当前用户数据库若需升级，先停原进程、只应用已审查的增量迁移、核验再重启，不在HTTP中自动迁移。
