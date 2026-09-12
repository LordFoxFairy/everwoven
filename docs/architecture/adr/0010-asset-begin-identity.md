# ADR-0010 · 上传创建命令的共享身份

- 日期：2026-09-12
- 状态：Accepted（主会话与Hegel设计复核认可；实现已通过本地主仓与独立复核，网络尚未接入）
- 范围：仅asset begin的意图与命令回执，不推广到全部业务回执。

## 背景

严格DTO校验以及commandType/payloadHash只能证明响应结构合法、请求相同，不能证明响应属于这次创建。如果用response.id读取意图来验证自身，把A命令响应整体替换为同内容B意图的DTO仍能通过，原命令便返回错误uploadId。无外键不代表忽略这种应用关系约束。

当前资产生命周期尚未正式接线，无旧协议/旧数据兼容要求。已有CommandReceipt.id、AssetUpload.id均为服务端UUIDv7主键，owner/command为真实唯一，不需要为了这项关系增加伪唯一。

## 决策

1. 仅begin使用同一次服务端生成的UUIDv7作为upload.id和receipt.id，两行同一WriteGate事务提交。插入冲突整笔回滚，不另生成receipt ID绕过。
2. AssetStore自己的AssetReceiptRecord必须带id，Prisma显式select。重放先经owner/dataset/原commandType和payloadHash检查，再要求response.id等于receipt.id，**以receipt.id**查询本owner意图。
3. 同时核对不可变input hash/大小/名称/权利、assetId、createdAt/expiresAt及初始reserved/revision1/output全null响应。不得要求当前意图仍是reserved，否则正常历史重放被破坏。
4. complete继续使用独立receipt ID；写入和重放都校验upload→asset及不可变output/名称/权利。当前Asset已unavailable/软删除不改变历史已确认响应；新的completed命令仍要求当前ready/未删除，并在写回执前核对绑定。
5. 不新增数据库FK、触发器、关联schema字段或签名密钥；不是数据库自动提供的一对一关系，而是应用事务与回执验证的明确不变量。

## 后果

- 正向：独立于response的创建身份约束关闭有效意图间的错绑；保持既有Prisma新基线与真正唯一约束，不造兼容层。
- 代价：begin为有意的专用回执写入规则，维护者不能把它还原成“所有回执随机独立ID”的通用helper。源码需注释并有回归保护。
- 保留约束：M1保留关联意图和回执。未来若单独清除任一记录，必须同步设计历史回执归档/可重放期限，不能静默破坏已承诺的语义。
- 边界：这是检测错配及维护应用一致性，不是对可任意修改全部数据库字段的管理员提供防篡改证明。

## 其他方案

- 在AssetUpload增加beginCommandId：可行，但本关系已有足够主键承载；增加字段/迁移/索引登记不是本期最小必要变更。
- 从response自证、只验JSON或metadata：有效同内容意图仍可互换，已真实复现，不采用。
- 直接复用客户端commandId为实体ID：不符合本项目服务端分配实体ID的规范，不采用。
- 通用签名回执/额外关系表：扩大密钥或数据模型维护面，不为当前错配问题引入。

## 接受证据（本地已验证）

- 同内容A/B完整DTO互换、改回A.id仍保留B.assetId均拒绝。
- begin身份相同、complete身份独立；任一回执写入失败整笔回滚。
- 正常状态推进/过期后仍返回初始begin历史响应；Asset不可用/软删除后仍返回原complete历史响应。
- completed新命令遇固定元数据错配首次即拒绝，零新增回执；合法高revision快照可重放。

最终回执修订先RED9失败/39通过→48/48；主仓69文件1090/1090、双端typecheck与隔离生产三Chrome退出0。Dewey48/48复核、Cicero原A/B互换repro双向拒绝并质量PASS。无schema变更、无用户数据重置。
