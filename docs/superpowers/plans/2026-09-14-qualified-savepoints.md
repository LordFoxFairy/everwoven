# 合格存档与分支实施

目标保持完整分支闭环。已核对现有分支ADR；先补可作为fork来源的正式播放证据和不可变节点，再创建独立来源基点、前缀授权及共享预算，不把客户端ended直接当合格存档。

1. PlaybackSession：服务端验证私有媒体后签发播放会话；顺序进度按服务端时间检查连续覆盖。completePlayback必须找到同owner/dataset/storeEpoch/turn/media/experienceRevision的完整会话，重复回执仍只读重放。
2. 同一完成事务生成不可变StateSnapshot与Savepoint，绑定固定story/profile、媒体hash、已核验sceneResult、父存档和本地decision。只查询历史节点不提交播放/生成。
3. 来源固定后，fork创建新Experience、fork_base及空回应节点，继承来源固定配置/预算scope；不复制任务、报价、未发送稿或来源未来状态。历史前缀媒体有显式引用授权。
4. 原舞台接播放会话/进度，历史入口悬浮可收纳，显式选择历史点后另开路线；中途关闭与原命令恢复不重发付费调用。
5. 每个已接通阶段完成真实SQLite/HTTP、原页面、独立审查与CI；正式供应商仍待公开接入信息和明确预算，测试全程零付费。不得在fork实际实现前宣称分支完成。


2026-09-14执行结果：第1、2步及原舞台进度接线/本地浏览器验收完成。按用户收尾要求，第3步fork与第4步历史界面明确留待后续，不再扩大本轮。完整goal仍未完成。主仓2154项测试、typecheck、独立生产build和原Host自然播放/草稿重启通过，全程零模型调用。
