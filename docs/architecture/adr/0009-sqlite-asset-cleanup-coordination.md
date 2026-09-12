# ADR-0009 · 素材终态清理采用可崩溃释放的协调

- 日期：2026-09-12
- 状态：Accepted（设计取舍经主会话/Hegel复核；C1b接口修订与C1c跨进程实现仍待验收）
- 范围：未完成上传的终态清理，不包含ready素材GC或任意文件操作。

## 背景

私有候选文件采用无覆盖创建。失败或租约过期的旧writer可能迟到留下文件，因此deleting记录必须保留并重复清理；completed永不进入清理。

C1b初版使用O_EXCL空`.cleanup-lock`保证合作进程互斥。但持锁进程崩溃会留下永久busy，没有自动释放或可执行恢复路径。按PID、年龄或租约抢锁不能证明旧文件操作结束；为残锁增加停机恢复系统也会扩张本地产品运维面。

另外发现：完整字节写入后、file fsync之前失败，重试获得exists，再只读verify成功，并不证明文件已持久化。不能把hash正确当durable证据。

## 决策

1. **移除永久文件锁，强制注入CleanupCoordinator。** C1b不提供默认进程内替代，不把内存串行化包装成跨进程保证。协调器只执行具体的终态删除临界段，不成为通用事务框架。
2. **C1c使用同一SQLite库协调，不引入native addon或第二锁数据库。** T1先CAS并提交不可逆deleting；T2取得SQLite writer lock，复核owner/dataset/asset/deleting，才调用C1b同步删除临界段。实际是库级写互斥，不是asset行锁。
3. **锁覆盖真实工作，不只覆盖Promise等待。** 现有withOwnerWrite的3秒交互事务超时不能原样包裹异步FS回调；事务先超时释放、旧FS继续执行将破坏互斥。C1b临界段只能执行不让出事件循环的固定元数据检查、unlink及目录fsync；不得返回Promise或等待异步fault hook。C1c仍须用真实超时/进程测试证明实际锁语义，而不是仅增加timeout。
4. **这是文件I/O不进入写事务原则的有限例外。** 仅终态清理的固定数量小操作获准；读图、解码、大Buffer、上传、网络、递归遍历一律在事务之外。
5. **T2失败不恢复文件或状态。** T1已提交deleting，unlink成功但T2失败/回滚可重试absent，并再次同步目录。进程退出后SQLite锁应由系统释放，保留deleting继续清理迟到writer残留。
6. **新增ensureDurableCandidate恢复端口。** 从同句柄核验真实内容，file fsync与父目录fsync均成功才返回durable；不覆盖、不补写、不自动删除。verifyCandidate仍只读，不能单独用于恢复后的ready准入。

## 后果

- 正向：不遗留永久空锁，不需要另造人工残锁恢复工具；继续使用现有数据库、owner/dataset边界和无外键基线。
- 代价：终态删除短暂阻塞事件循环，并阻塞同库其他写入；慢盘下可能变慢，不承诺硬实时。若容量证明不合适，再独立评审专用worker/原生协调方案。
- 限制：测试里的简化协调器只验证调用契约，不证明生产互斥；C1c接入前不对外开放上传/清理服务。
- 安全：sameUID恶意进程/管理员仍为宿主失陷，不把路径重检或同步unlink声称为条件inode原子操作。

## 接受实现的必备证据

- 两个真实进程：第二个不能在第一者同步删除临界段内进入。
- T1已提交、T2删除前SIGKILL，重启可重新取得锁并清理。
- unlink后、目录fsync前SIGKILL，重启absent路径完成同步。
- 慢操作/交互事务超时：旧删除工作实际结束前不存在新协调者进入窗口。
- completed无删除权限；deleting晚writer残留可重复清理；错误不泄露路径。
- before-file-sync失败遗留完整内容，exists后ensureDurable补文件/目录同步；任一同步故障零durable，partial拒绝。

上述实现验证未齐全时，保持“待验收”，不以ADR Accepted替代功能完成。
