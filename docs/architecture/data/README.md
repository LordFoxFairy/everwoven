# M0数据样本 · V1.2 无外键 / 真实唯一

2026-09-10。[数据规范](../DATA-DESIGN.md) · [13项唯一约束登记](../UNIQUE-KEY-REGISTER.md) · [图册](../DIAGRAMS.md)

这不是已部署的应用数据库；本轮未改用户存档、业务代码或应用依赖。

## 当前产物

- m0.schema.prisma：15模型、标量关联、无@relation；createdAt/updatedAt/deletedAt按生命周期设置。
- m0.generated.sql：Prisma7.10.0使用独立prisma.config.ts从空结构生成。
- m0.hardening.sql：刻意只有说明，无FK/触发器。V1.1的跨表硬化已撤下，不再维护第二套关系规则。
- verify_m0.py：24项结构/直接SQL/应用写事务协议验证，临时文件SQLite3.49.1、DELETE journal。不是实际Prisma驱动/WAL认证。

## 实际边界

结构验证检查：15张表的foreign_key_list全部为空；13项业务唯一的名称和列与登记表完全一致；没有触发器；主键保留。同名角色、同名剧本、同hash素材可同时创建。

应用协议样本检查：WriteGate先写后读，跨owner/缺失关联拒绝、并发同slot只一条、CAS冲突、逻辑删除保留历史、deleted/deleting阻断新引用、回滚、删除身份后的受控核对、父草稿修订递增和回收中素材拒绝恢复。特意验证直接SQL可写入孤立ID，明确这已不是数据库自动保证。

还需要正式M0验证：Prisma interactive transaction确实在同一连接按该顺序工作，所有API/worker/导入/GC无旁路；生产IdFactory/Clock；完整删除恢复、文件GC竞争、迁移/备份恢复及费用任务链。这里的Python协议示例不冒充正式TS仓库。

旧24项FK/触发器反例测试已随旧样本归档，不再宣称适用于当前方案。历史目录：docs/archive/data-with-foreign-keys-v1.1。

## 复现（项目根目录）

```sh
npm exec --yes --package=prisma@7.10.0 -- prisma validate --schema docs/architecture/data/m0.schema.prisma
npm exec --yes --package=prisma@7.10.0 -- prisma migrate diff --config docs/architecture/data/prisma.config.ts --from-empty --to-schema docs/architecture/data/m0.schema.prisma --script
python3 docs/architecture/data/verify_m0.py
```

使用显式评审config并检查输出非空，不只看退出码。正式迁移在应用目录单独生成/评审；禁止以关foreign_keys pragma或db push/reset代替移除外键的schema迁移。

自审修订2：Experience增加必填budgetLimitMicros/budgetCurrency，审核DDL同步。第24项验证重开连接后初始预算保持；基础仍15模型/13真实唯一/0FK。正式创建用例与预算迁移尚待实施。

后续实施更新：应用目录已有从同一schema生成的M0初始迁移，并通过本机Prisma真实文件库切片测试；见[M0-A记录](../../implementation/M0-A-2026-09-10.md)。本目录仍为审核样本，历史Python测试范围不变；没有迁移用户存档或完成正式API/备份恢复。
