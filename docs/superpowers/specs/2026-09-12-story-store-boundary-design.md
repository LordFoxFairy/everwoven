# M0-C1：剧本事务存储边界

基于用户已确认的闭环审计及推进顺序；本切片实现应用/存储解耦，不增加HTTP写入和初始化权限。

## 范围

保留当前内部Draft命令/DTO、错误、UUIDv7、时钟、CAS、命令摘要与回执含义；不修改SQL。应用层依赖专用StoryDraftStore，组合入口注入Prisma实现和RuntimeServices。具体端口承载同一事务作用域内的owner限定操作，而不是模拟Prisma的通用查询接口。

- Store.write(ownerId, callback)：先WriteGate，再回执检查/业务操作/回执写入；任何异常整笔回滚。
- Store.read(ownerId, callback)：同一读事务验证有效owner并执行查询。
- 读写作用域只暴露本次owner的数据；写作用域同时提供回执、草稿insert、条件更新；接口不暴露Prisma/TransactionClient类型。
- 应用层保留输入与存储schema校验、payloadHash、revision准入和分页游标；适配器实现where/orderBy、CAS和映射。
- 标准组合入口createStoryDraftService(db, services)由宿主调用；应用函数接受Store，不保留“既接受Prisma又接受Port”的双形态。
- 原集成测试经组合入口或真实PrismaStore接入，不降低原断言；新测试固定依赖方向与事务行为。

未知存储字段用unknown接入应用校验，禁止类型断言把损坏数据当成正确DTO。禁止万能BaseRepository、全局容器、新依赖与网络/文件副作用进入事务。

## 验收

1. application/ports不导入generated Prisma、infrastructure或Web。
2. 原28项草稿集成用例保持通过，包括双连接并发、回执异常回滚、重放、owner隔离和游标。
3. 新存储边界测试覆盖读/写owner scope、条件更新失败、回执写入失败业务回滚、无越权读写；优先真实临时SQLite。
4. 用例无需Prisma类型即可调用；composition使用真实适配器。
5. 全量测试、两包类型检查与构建通过；UI、演示存储、SQL、正式HTTP操作清单不变。

## 后续

M0-C2再实现显式宿主初始化、数据目录/单实例与受保护会话，M0-C3接真实tRPC与前端。C1不宣称完成页面落库或重启体验。
