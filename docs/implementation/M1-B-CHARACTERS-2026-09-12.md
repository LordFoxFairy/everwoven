# M1-B · 正式角色模板服务与原页面

2026-09-12。实施中，不等于原角色库/图片/剧本/生成闭环。

## 当前落地切片

- CharacterTemplate scope=library独立应用服务、Store端口/Prisma adapter/Host组合；复用会话、写闸、幂等回执、CAS。
- tRPC characters六操作、真实宿主HTTP集成测试、远程CharacterClient。原始错误经Host白名单和tRPC边界清理，不泄漏路径；已提交但响应丢失不自动重试mutation。
- Session transport从已测试的DatabaseDrafts adapter抽为共享模块。导航上方的Provider已实现但尚未接入Platform，不能据此宣称正式原角色UI已可用。

## 主仓TDD及核验

- HTTP边界7项先6失败（404/错误映射未注册）；真实临时宿主集成4项先全部404失败。
- CharacterClient stub先2失败，真实委派后2通过；原sessionadapter119测试保持通过。
- SessionProvider stub行为先4失败，实现后4通过。Dewey复核发现旧回调可操作新client/mode及新连接检查期间仍暴露旧状态：补测试先6中2失败，改为生命周期scope后6通过，追加StrictMode迟到首轮GET回归。
- 主仓128项session/adapter聚焦通过；runtime build+角色HTTP/集成/session/character adapter四文件20项通过，Webtypecheck通过。此处尚未全仓验证和浏览器原角色页验收。

## 尚需完成

1. 独立规格/代码质量复核，主仓全量并提交。
2. 同一原角色库接异步正式CRUD、会话gate和错误恢复，替换同步保存真假判断；Editor另存角色调用点一并async。
3. 原页面真实浏览器create/update/delete/restore和宿主重启，unknown响应/跨dataset/草稿保护。
4. M1-C图片和剧本聚合；M1-D删除旧路径及定向reset。运行完整创作链后再报告总体完成。

没有改schema、删除用户数据、触发付费生成或tag。

## 复核补记

- Hegel首次遇到实现者重命名期间不存在的character-draft共享import，78项集合出现40通过/18失败/3套件导入失败。该瞬态问题已恢复story-draft正确共享导入；复审前后源码哈希相同，独立7文件78/78通过，Chunk1/2规格通过。
- 主仓首次完整：51文件699/699，runtime+Web typecheck通过（退出0）。追加同client重连世代回归后还需最终完整复验。
- Cicero发现同client重连后旧invalidate仍影响新认证，新增测试旧实现7通过/1失败；run开始递增epoch，界面失效回调绑定发布时epoch后，session8+连接组件3共11通过。没有通过放宽断言处理竞态。
- LocalConnection组件先3项RED，再3项GREEN；一次性码只在内存输入，成功清空，不写浏览器存储。组件/Provider尚未挂入原页面，留给下一直接实施切片。

最终主仓（本切片）：`pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck`，**51文件700/700及双端类型检查通过，退出0**；另角色Store/DB/HTTP三文件37/37通过。实现者确认runtime文件稳定，自己复跑10文件148/148；主仓结果不以其报告替代。代码质量最终意见和远程CI状态另记。

独立复核最终：Hegel角色Chunk1/2规格通过；Dewey连接生命周期规格通过；Cicero角色与连接代码质量通过，并明确复读确认同client epoch P2关闭。无本切片剩余P1/P2。原页面未计入本切片的通过范围。
