# M1-D 原剧本聚合落地记录

状态：主仓/隔离生产通过，独立质量及当前3100原页面启用通过，远端CI待完成。不是完整M1验收，也不是视频生成交付。

## 已实现的产品链路

原角色库创建、上传图片、用角色创作 → 原Editor填写世界/开局/玩家身份/规则/语气与角色关系 → 上传剧本封面、开场图与角色覆盖图 → 一次保存完整剧本 → 原“我的剧本”打开修改 → 回收与恢复。删除临时DatabaseDrafts及旧database-client/ports，没有两套正式创作流程。

原Editor保留不同于demo展示Story的完整正式字段；折叠或切换配置不丢世界规则、关系、固定来源、素材引用或未决上传。所有正式读写由异步端口完成，不因浏览器存储失效回退演示。准备入口等待成功确认，清楚说明模型生成未接通，不产生游玩/任务/付费调用。

## 分层责任

- StoryController：可编辑工作副本、提交快照、基线、dataset/session epoch、CAS与不可变pending command。读/列表/写状态分开；已完成的列表删除不伪装正在编辑。
- StoryClient：单请求tRPC，严格DTO与固定错误解析。源类型可用于编译，运行时值走runtime公开compiled包，不靠bundler alias或源文件扩展名兼容。
- Host与应用：身份及dataset先验；Store事务内CAS、固定角色版本、内部模板、关系/图片槽和完整命令回执一起提交。
- 固定角色：library按显式修订固定；bound只能保持此根现有版本；inline只追溯当前根当前绑定；不从活模板拼历史故事。
- 图片：三个显式槽；portrait继承/无图/覆盖三态；旧槽同绑定可保留历史失效引用，新绑定要求ready。图片文件生命周期独立于剧本软删除。
- 回执：create回执主键绑定根ID，create快照资产必须当时present/ready/未删除；重放读取历史完整DTO，不查询当前资产重组结果。

详见[当前API契约](../api/STORY-AGGREGATE-M1.md)、[架构与时序](../architecture/INTEGRATED-AUTHORING-M1.md)、[验收矩阵](M1-ORIGINAL-CREATION-ACCEPTANCE.md)。

## 发现并关闭的问题

1. Web绕过compiled runtime值导入：Vitest/typecheck绿但Webpack红；公开包及原生Node解析测试，真实production重新构建通过。
2. create历史回执可接受伪造失效资产视图：真实SQLite三个篡改反例；create-only动作校验，不破坏合法历史失效的读取/其他动作。
3. 完成列表生命周期残留editing：401后切dataset导致无入口的恢复锁；分离列表操作与真编辑，真正unknown保护保留。
4. 正式准备modal无完整键盘管理：使用已有Radix Dialog，无手写trap/新依赖；DOM与真实Chrome覆盖焦点、Tab、Escape、恢复。
5. 会话变化时Editor本地锁等待旧网络请求：锁按会话/尝试世代释放，迟到finally不解锁新请求；真实Controller deferred回归覆盖旧请求resolve/reject与新输入保留。
6. 旧临时面板CI导航时序：0481b8e失败仍保留原结论；单一聚合删除该面板并替换旧smoke，不保留其兼容分支。

## 本轮主会话证据

Node22.22.2；主仓runtime build、99文件1536/1536、双端types实际exit0。明确源码快照的production build通过；同一产物的五Chrome全部exit0：

- local-story-ui：完整字段、四张实际图片、不可变来源、新文字保留、丢响应及精确400、实际进程重启、生命周期、dataset隔离、正式准备键盘。
- local-asset-ui：原图控件、权利选择、未知begin/complete、替换/恢复、Studio另存引用。
- local-assets：真实私有文件HTTP、规范化、重启与会话撤销。
- local-characters：原角色全部字段/CRUD、unknown及精确400、重启读回。
- http-browser：不安全HTTP来源下demo与浏览器持久化。

规格审查runtime313聚焦，Web/UI183与session16聚焦PASS，不把聚焦数量与主仓总数相加。质量审查426聚焦及最后会话锁30聚焦通过，当前P1/P2=0。当前用户3100已由本仓专用local启动器运行dev Host，真实原页面一次性连接/完整Editor已验证且未seed业务数据。精确新CI以PROGRESS后续记录为准。未执行旧数据清理、未发布tag/镜像、未使用模型密钥。
