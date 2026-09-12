# M1-C2 · 原图片控件接线记录（本地验收通过）

## 实现边界

Feynman实现纯素材协议/正式与演练适配器、上传控制器、读取调度和hooks；Hegel接原story-assets、角色库、Editor另存角色及Platform组合。只有纯dataset header搬至web/contracts，服务端直接改import，无兼容导出。主会话维护生产验收脚本/CI/文档，无第二页面或站点。

- AssetRef判别demo/formal，正式ref带dataset；正式只走tRPC+受保护PUT/GET，不导入IndexedDB store。DemoAdapter仅前端浏览器存储。
- 读取hook区分空、加载、就绪、缺失、断连、失败；对象URL按身份/卸载/切图释放，旧URL不在新dataset渲染。读取最多2活跃+32排队，可取消排队，实际在途未完成不提前放槽。
- 上传由编辑容器持有controller；配置页卸载picker不丢原命令。begin/complete冻结独立命令ID及payload，PUT未知通过getUpload读取当前状态。结果operationId/editingKey匹配后仅消费一次。
- File先就地验证/预览；权利checkbox未默认选中，确认并点击上传才begin。complete后只改变角色工作副本/dirty，保存角色才建立引用；clear不调用资产删除。
- 当前portraitRef与来源快照source分离；“用TA创作→改图→另存角色”使用当前参考图。跨dataset恢复清旧图和来源，不将旧命令转换发新库。
- 正式剧本封面/开局聚合保存仍待下一切片，未伪启用；页面unknown仅保留内存，硬关闭草稿恢复尚未实现。

## 已有验证与未关闭项

首轮主仓82文件1277/1277、双端typecheck exit0；隔离生产build及原图片UI/图片HTTP/原演练/原角色/原root五Chrome exit0。原UI脚本在旧production真实缺file input先RED，后用实际原控件完成选图、权利确认、真实规范化与头像保存、禁localStorage/IndexedDB、进程重启读回、换图/角色软删恢复/清引用而不删资产。

这些GREEN未覆盖独立审查追加风险，因此本批仍待最终门槛：

1. 主会话截图发现checkbox与文本被全局column样式分开；新增实际computedStyle断言RED column≠row。B已局部CSS修复并样式测试RED2→GREEN25项，最终浏览器复验待完成。
2. 未completed候选文件丢失后retry只重复complete404，终态过期仍提示重试。A已补RED3/24通过，正在精确恢复/终态指引修复；completed历史资产不重传。
3. Dewey独立复现丢响应后代理无领域标识400解除unknown/可reset，存在重复创建风险。A正在修无可信协议原因时仅HTTP状态不应断言写失败；主会话追加真实生产丢begin响应、complete已提交后代理400，再由原UI确认原命令的回归。

最终全部修复→主仓重跑→真实浏览器重跑→规格/质量两阶段通过→CI才记录C2验收；不使用此文档代替原剧本聚合及总体M1闭环。

## 追加复核

- 初次修订主仓1307项及production五Chrome通过，原UI验证了泛化代理400保留原命令。但精确INVALID_ASSET_COMMAND发生于参数校验、早于receipt查询，仍可能清掉旧unknown。A按原begin/PUT/complete分别记不确定性；成功确认begin后清该阶段，不把后续首次明确PUT拒绝粘成永久unknown。
- 后续主仓1334项及production五Chrome通过，原UI覆盖begin丢响应→精确400拒绝确认→再次确认成功；HTTP错误43标识集中到唯一纯契约。期间主会话修正smoke事件等待Promise.all观察，失败也正常finally清理，不用测试未处理拒绝当产品RED。
- Dewey实际SQLite+Controller并发再现TTL边界：原finalizer有效lease跨TTL仍可提交，当前无receipt时的EXPIRED不能作为已有unknown可丢弃证明。该新增例外正在最小修正；首次明确过期仍可终止。当前依然不计最终验收。

## 最终验收 · 2026-09-12

最后同一源码主仓 **85文件1340/1340**、runtime/Web typecheck exit0；隔离 production build + 五条 Chrome（原图片UI、真实资产HTTP、原演练、原角色、原root）exit0。Dewey增量规格独立80/80 PASS；Cicero最终质量独立78/78 PASS，当前确认P1/P2均0。此前所有审查发现均已关闭，不以早期GREEN覆盖后续问题。

- 权利声明恢复横排，成功态仅禁重复上传，仍可选新图/清除，新文件重新声明；原UI生产回归覆盖。
- 缺候选仅按精确错误/当前意图恢复原File；completed不重传。分阶段保存不确定命令，未知代理响应及先于回执查询的精确400都不抹除历史unknown；43个领域HTTP错误使用单一纯契约。
- 原有效complete租约跨TTL的真实SQLite/文件/Controller并发回归通过，过期不能覆盖已有未决命令。
- 演练只清除确实rejected的导入Promise，pending/fulfilled仍复用；显式重试才重新导入。
- 原UI真实丢begin/complete响应、两种400确认、重启读取、角色删/恢复、Studio换图另存保留源角色、clear不删资产已通过，非仅组件stub。

本片只完成原图片和角色创作；剧本聚合、显式维护、删除临时root面板、当前3100正式启用仍后续。提交/精确CI结果登记PROGRESS，不宣称总体M1已完成或模型调用已验收。
