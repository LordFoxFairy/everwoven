# M1 · 显式有界资产维护（待实施）

## 决定与边界

基于Hegel实读现有cleanup/Host/SQLite查询的审查，采用现有Host CLI的显式单次管理命令，不挂启动、不挂普通图片请求、不启动另一个常驻服务。重启不自动发布图片，恢复完整候选仍走complete，缺失候选仍按原意图process。

- `maintain-assets`默认预览，`--apply`才执行；要求预期dataset，实际owner来自真实认证。
- 凭据仅stdin有界读取，不进argv、URL或错误。优先消费既有connect的一次性code，在用例内兑换临时会话并finally撤销；不要求用户手抄浏览器HttpOnly cookie。实施前用真实CLI确认管道语义与退出清理。
- 默认检查25条，硬上限100条，串行；额度按检查行而不是成功删除量。使用owner+(createdAt,id)严格keyset cursor并绑定dataset，分页不OFFSET、不循环直到扫空。
- 候选为failed/deleting或TTL已到且非completed；有效lease跳过。枚举只是提示，cleanup T1/T2仍在各自锁内重新判断。
- 不解码、不自动complete、不遍历目录删除无记录文件；任何Asset身份/别名/历史引用保护不放松。预览与无候选页不创建assets目录。
- 失败也占检查额度并返回固定错误，cursor继续向后，避免一条坏记录饿死其他行；deleting保留，下一轮从头复查可处理迟到writer。
- 不用Promise.race假装取消在途同步unlink/fsync；时间预算只在记录间检查。

## 数据与测试门槛

复用owner/createdAt/id现有索引；补非唯一AssetUpload(assetId)前先实际EXPLAIN，必要变更同步唯一新baseline、DDL/fingerprint/门禁与文档，禁止旧库兼容或新伪唯一。最终所有聚合查询再统一EXPLAIN核对。

必须验证多页/同时间戳/失败行/检查上限、跨库cursor、lease、complete抢先、任何Asset别名、T1后及unlink后SIGKILL重试、会话撤销/DB替换、预览零资产目录、真实CLI退出和不打印凭据。既有两个进程T2测试可以复用，但不替代新入口实跑。

本文件不是已实现声明。本批在C2原图片控件接入后与聚合按独立写集安排，不阻塞已验收HTTP用于原页面实现，也不将显式cleanup描述成自动维护。
