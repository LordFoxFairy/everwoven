# 文字调用持久观察（已批准生成主线）

目的：正式导演的 observe 使用 SQLite 保存供应商响应身份和用量，为费用核账保留证据。主会话写入，Aquinas 只读评审；不调用付费模型。

1. 新增不可变 TextUsageObservation：UUID、owner/dataset/storeEpoch、turn/quote/profile、stage、bindingHash、归一化 observation、contentHash、schemaVersion、createdAt。一个回合每个文字阶段最多一次调用，`(turnId, stage)` 为真唯一；不建立外键。
2. 在原 WriteGate 内核对接受关系、固定配置/报价/故事身份、预算责任及当前 leased 阶段。完全相同的持久观察重放幂等；不同响应或用量冲突不覆盖。缺失用量保持缺失；不推算零费用或释放预算。
3. 成功保存后才允许导演推进。取消在事务入口及写入后检查，过期写入回滚。写失败交给原 Worker unknown/held 处理；不重新请求模型。正式持久执行器工厂安装该观察器。
4. 增量迁移与精确 schema 基线/唯一例外登记同步；只在停机、备份、验证存量后升级用户原库，不在 HTTP 自动迁移。
5. 真实 SQLite 的重启、重复/冲突、错误身份、缺失用量、损坏观察、取消回滚和 Worker 集成验证；完整测试/类型/生产构建与原3100回归。费用结算另有独立证据要求，本观察表不等于结算账本。
