# M1-A1 · 单一创作契约与全新数据库基线

2026-09-12。本批为真实源码/测试改动，不是完整角色、图片、原编辑器闭环；不发送阶段完成通知。

## 已改范围

- StorySettings只有world/opening/genre/playerRole/worldRules/tone；全部必填，允许空内容草稿，按详细契约严格限长；旧premise明确拒绝，不读取旧格式或做转换。
- 当前用例命令namespace统一authoring.story.*.v1，输入/数据库回执规范化同一字段顺序；幂等、CAS、owner和规则数组语义不变。
- 当前HTTP、适配器测试、临时面板与浏览器smoke同步全部字段；原完整StoryEditor的角色/图片聚合不在这次交付内，临时面板最终仍要删除。
- 新Prisma baseline `202609120001_authoring_baseline` 替换旧迁移定义；16表/13真实业务唯一/0FK/0触发器。新增CharacterTemplate.scope/sourceStoryDraftId，Asset.originalName/width/height必填，以及AssetUpload意图表。
- 开库从“看表数量”改为单一迁移ID+SHA256及实际sqlite_master DDL固定指纹核对；拒绝改名/增减字段/额外或缺少索引/索引顺序变更/未批准视图/触发器。
- `scripts/sync-schema-baseline.mjs`只对可信baseline做内存SQLite生成，`--check`验证运行时指纹和审核SQL与baseline一致，不打开用户数据库。

## 验证过程与审查修复

- 主仓先复现7个门禁RED：旧逻辑对结构变化/错误checksum仍返回opened；先将测试结果压成字符串，避免Vitest打印Prisma循环对象引发非目标的栈溢出，最终RED均明确为opened与拒绝结果不一致。
- 实施后DB初版21/21，再补作用域/完整素材元数据/意图重启及近内部名view/迁移表trigger/指纹复现达到25/25。
- 独立规格审查发现同名对象漏洞：SQLite允许trigger名恰为_prisma_migrations；按名字过滤漏掉它。先新增精确RED，再将排除条件限定 `type='table' AND name='_prisma_migrations'`；DB最终26/26通过。
- 第一轮主仓全量548/548和typecheck通过；最后新增trigger用例后执行最终全量复验，结果以PROGRESS最终追加为准。
- Prisma CLI从空结构diff在缺少配置URL时本机退出0且输出空；显式指定仅用于只读配置加载的绝对file URL后得到非空DDL。未对该路径执行迁移，也未开用户库，不能以CLI退出码代替检查产物。

## 仍未完成 / 不允许误报

- datasetId跨重置防重放、受限reset命令未实现，当前不执行用户业务数据清理。
- 角色HTTP/原角色库、上传/complete/清理恢复、剧本cast/图片槽聚合、原编辑器接入、单入口移除旧面板还未完成。
- 生成worker、官方精确模型的真实付费任务、媒体播放下一幕仍未闭环。没有付费调用、发布tag或镜像发布。
- 全新结构只经隔离临时库验证；旧业务库没有迁移或自动删除。

最终主仓结果：同名trigger追加后第一遍全量548通过/1条UI异步callback等待失败，修复同类等待（不改断言/timeout）并复审；最终38文件549/549、runtime/Web typecheck通过。Next生产build/真浏览器本轮未运行，不作为已验收。

后续CI补齐：[34710192907](https://github.com/LordFoxFairy/everwoven/actions/runs/34710192907)针对commit8c1552a成功，含生产Next/Docker构建、环境端口组合、HTTP浏览器和本机六字段创建/修改/删除恢复/进程重启/响应丢失smoke。前述“本机本轮未运行”保持准确；远程CI验证现已完成。无tag，未发布新镜像。
