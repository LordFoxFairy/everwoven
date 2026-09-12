# M1-A2 · 业务库世代绑定（代码与主仓验收完成）

2026-09-12。目标是阻止reset后旧页面的未知命令写入新库，不引入旧manifest/旧请求兼容。

## 已落源码

- 宿主manifest生成独立datasetId；连接码/会话记录同一世代，认证返回可信ownerId+datasetId。世代变化使原凭据失效。
- host在首次认证、manifest和数据库打开后的再次认证间实际比较owner/dataset，再执行服务callback。
- create/update/delete/restore都要求固定datasetId；应用在进入Store/查回执前拒绝不符上下文的世代，DATASET_CHANGED经公开错误边界映射为PRECONDITION_FAILED。
- cursor包含datasetId，在store.read前验证；跨世代或缺世代游标拒绝，不转换。
- session adapter使用认证判别联合，true必须合法datasetId；false只输出authenticated:false，不透传数据身份或其他内容。
- 前端跨库连接清旧ID/revision/list/cursor/attempts，保留工作文本及原worldRules数组；用户显式从保留文本新建才解除旧命令状态，不自动换dataset重发。401/403和generic412不等于原命令确定失败。
- 请求client生命周期与dataset共同检查迟到响应，避免旧响应污染新状态。

## 验收记录

主仓第一次runtime build+全量：40文件604测试，603通过/1失败。失败为旧压力测试最后仍精确期待仅ownerId，需同步新契约为ownerId+datasetId；并发900次认证与540次读取本身无失败。未放宽压力次数或断言为partial。后续完整结果、独立复核和commit登记PROGRESS。

本批没有实现reset、更改SQLite schema、删除用户数据，也不是角色/图片/原Editor贯通验收。业务库世代是认证上下文边界，datasetId不是鉴权secret，不允许通过它选择任意宿主路径。

最终主仓：`pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck`，40文件604/604通过及类型检查通过（退出0）。首次603/604失败的压力用例已精确补ownerId+datasetId断言，未减检查次数。Hegel后端规格、Dewey前端规格、Cicero最终代码质量复核通过。真实浏览器/生产构建交后续CI，当前仅主仓测试验收，不冒称原角色/图片/视频已完成。

远程补验：提交3c0c9dd的[CI 34711146356](https://github.com/LordFoxFairy/everwoven/actions/runs/34711146356)已实际读取为completed/success，包含生产构建与既有本机创作/重启浏览器smoke；未tag/未发布新镜像。
