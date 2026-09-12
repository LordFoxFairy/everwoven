# M1 角色命令恢复修正

状态：本地聚焦、隔离生产及两阶段审查通过。

## 原问题与最小修复

角色create已提交而浏览器丢响应后，原命令确认如果被参数校验400提前拒绝，旧Controller错误清空pending。随后Editor另存同一角色会生成新commandId而重复创建。并非所有generic400都错：普通未知代理400原来已保留unknown；问题是确切前置错误或任意INVALID_CHARACTER_前缀被认作原命令已经结算。

- 每个命令已有unknown/scope fence后锁存其不确定性，后来请求的拒绝不抹掉原命令；成功确认才解除。
- 仅精确当前协议标识及匹配tRPC code/status作首次明确拒绝；去掉前缀判定。首次无历史unknown的可信拒绝仍可终止。
- 不变更后端命令/数据库结构、不引入通用BaseController；原命令与后续工作文本分离，dataset/epoch防护保留。

## 验证证据

Einstein三文件测试RED23→GREEN；主会话实际4文件86/86。Dewey独立规格64/64 PASS；Cicero最终质量64/64 PASS，确认P1/P2均0。主会话旧production原UI丢成功响应后精确400，确认按钮消失而RED；修复后同脚本GREEN，确认保持同commandId/payload且列表只有一个角色，较新文本保留。

稳定C2归档加本片三文件/脚本的隔离树实际82文件1332/1332、双端类型、production build与五条Chrome exit0。此时主仓其他writer在改聚合/维护，未将隔离结果写成活跃主仓全量通过。主仓整体验证留待合并稳定源码后执行；新CLI与原剧本聚合不包含在本片验收内。
