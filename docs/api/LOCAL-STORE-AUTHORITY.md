# 本地生成世代与官方任务接线

2026-09-14。这里只记录已实现边界，V1仍以实际生成、播后回应和恢复为验收。

`store-epoch.json`独立于用户数据库，严格version/ownerId/datasetId/storeEpoch/createdAt。新host在ready manifest发布前排他写入、file及directory sync；已有host离线使用`runtime:host init-epoch --directory ... --environment dev`显式登记。普通启动/HTTP不会生成、修复或轮换世代；缺文件允许原创作功能，生成authority拒绝。

`acquireLocalStoreAuthority`只读并返回owner/dataset/epoch与revalidate：身份/内容变化、维护锁或任意`recovery-pending.json`存在均拒绝。恢复标记也隔离普通host读取，半成品或悬空链接不被删除。该实现不是完整备份恢复，也不把文件复查当SQL原子许可；正式恢复仍须先停旧进程，后续恢复流程负责轮换/废止事件与许可。没有公开clear按钮。

官方任务实现现在位于runtime的`providers/minimax-jobs.ts`，直接消费已固定BindingRecord；旧Web实现已移除。submit需要本地operationId并返回完整原账户ref；read消费该ref，不接受裸taskId与当前默认账户拼接。每次submit只发一次POST，无隐式重试；未知HTTP/断网/坏响应均保留submission-unknown。返回成功媒体定位不是可播放事实，必须由后续下载/校验入库。

按[官方查询文档](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)校验task id/model/type/modality与状态，保留输出、输入、总秒数、图数、输入音频秒数及三类tokens；缺字段保持缺失，未宣称费用已结算。7天查询窗口过去后不自动释放原责任。响应正文最多256KiB、严格UTF8，超时或超限取消本地读取；这不代表远端取消。

测试使用测试凭据和注入fetch，不是账户真实调用。此片接通的是正式任务所需的协议实现；任务表、预算接受、worker、媒体和播放器仍沿主流程接线，不把此文档当完整交付。

接线复用已有`validateMiniMaxBinding/minimaxEndpoints`能力与地区目录；未安装的adapter版本不会进入网络。固定任务ref里的requestHash为实际传输请求摘要（可能包含会轮换素材URL的摘要），不是未来授权包络的语义hash；后续PreparedGeneration单独记录素材内容/用途和语义摘要。当前没有裸ref公共查询接口；持久操作服务必须按owner/operation验证引用后才能调用read。
