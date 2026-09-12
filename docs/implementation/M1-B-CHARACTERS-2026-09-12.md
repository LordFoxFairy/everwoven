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

## 原页面浏览器验收准备

- 主会话建立隔离源码副本`/tmp/everwoven-verify.zRVKTD`（5759e32），offline依赖安装395包、零下载，不复制.env/用户业务库，不覆盖3100运行目录或主仓.next。
- 首次新browser smoke未到业务断言：该隔离目录的登录shell选择了Homebrew Node24，而项目固定Node22，SQLite本地二进制ABI127与Node24所需137不匹配。只读内存库明确复现ERR_DLOPEN_FAILED；显式PATH选择22.22.2后，同内存库正常返回SQLite3.53.2。这是验收shell环境修正，不添加Node24兼容层、不放宽引擎门禁。
- 新`local-browser-harness.mjs`/`local-characters.mjs`尚未GREEN，不加入已通过CI声明，待原角色实现后验证。

真实浏览器RED已确认：切换正确Node22后，5759e32隔离生产构建成功，host启动与Chrome正常；原角色库页面仍为浏览器存储形态，缺少本机连接码，测试在预期入口断言超时退出1。验证临时host已由finally清理、子进程已停止。等待原页面实现后在相同隔离构建路径GREEN。

## 原角色页切片首次主仓复验

Feynman停止写入后，主仓55文件731/731测试及runtime/Web类型检查通过；**隔离production build实际失败**，不把测试通过当闭环。原因是CharacterController运行时直接导入runtime/src验证器，其`.js`相对依赖在源码目录被Webpack判为缺失。已派实现者改用已定义的runtime/contracts公开编译产物导出，不增加全局Webpack兼容alias。修复后必须重新build和browser，不接受仅typecheck。

## 第二轮生产构建与规格缺陷

- 公开package export修复后，隔离Next生产构建实际成功。新增源码边界测试实现者报告RED1后GREEN40。
- 浏览器先后修正两处测试定位：连接状态包含small子文本，改用status角色精确限定内容；有初始值的包裹textarea使getByLabel精确文本包含内容，真实Chrome最小DOM核验getByLabel计0、getByRole(textbox, exact name)计1，改用精确可访问名称，不放宽字段值/后端断言。
- Dewey规格核验发现三处真实P2：冲突错误区重试读取绕过dirty确认；Editor确认unknown前误验当前姓名；异库保留文本新建携带旧头像ID。均已交实现者先RED再修，不把当前常规CRUD跑通当作通过这些边界。

原角色常规真实链路已在隔离生产构建的Chrome通过：同页连接、name-only草稿、全字段更新、delete/restore、已提交create丢响应后原命令确认、保留后续B输入且仅一条实体、强制浏览器Storage不可用仍正式落SQLite、刷新及结束/重启宿主读回；原root六操作/失联/重启smoke也通过。截图只保存在隔离验收目录。独立review补第四项P2：reset必须当场推进epoch，不能等Hook bind才隔离旧读写；正在修复，故尚未标原角色切片最终通过。人工视觉检查发现姓名星号另起一行及筛选命中区/active态薄弱，交实现者同批小修。

主会话补查跨库导航死路：无角色编辑/命令时在首页从datasetA重连B，不应无条件进入datasetChanged人工恢复态并阻止进入角色库；有保留角色文本时恢复入口也必须在当前形态可达。已要求实现者补首页deferred重连测试和有保留副本的定向恢复入口，不放开未解决写入的所有导航。


## 原角色页最终复核进行中

- reset当场fence、无编辑首页跨dataset导航、保留角色副本定向恢复已补回归；同步transport抛出不会遗留flight锁。
- Dewey再查到Editor直接角色卡带入后、从未提交、A重连B仍携带旧portrait来源的问题。Feynman先完整Platform回归RED 1项，再新增独立Editor来源dataset判断与Platform保存入口guard；显式恢复保留文本但清旧source/portrait，恢复前零写入。
- Feynman停止写入后，Dewey最终UI规格复跑5文件47/47通过，既有UI P2全部关闭；Hegel控制器规格已通过。Cicero最终代码质量审查进行中。
- 此前主仓55文件745/745与生产Chrome两条链通过；最后来源修复后再次全量、双端typecheck、隔离生产构建和Chrome正在执行，结果未提前标通过。


最后来源修复后的主仓验收：`pnpm --filter runtime build && pnpm exec vitest run --maxWorkers=1 && pnpm typecheck`退出0，**55文件746/746、runtime/Web类型检查通过**。隔离Node22生产`pnpm build`退出0；Chrome `local-characters.mjs`和`local-authoring.mjs`均通过，零模型调用。主会话复看1440×1000角色页截图，原sidebar/连接状态/卡片与编辑栏正常，姓名必填星号和筛选active/命中区修复可见。代码质量审查尚待结果，未提前写总体完成。

最终Cicero代码质量审查PASS，无确认P1/P2；其只读审查未运行测试，验证证据为上方主会话实跑。原角色Web切片验收完成，M1-C/D及真实生成仍未完成。

远程5f037bf CI34715019332的旧HTTP演练smoke因过期placeholder失败（后续正式smoke跳过），已根据实际日志改可访问textbox/status定位并加强重载字段、demo零正式mutation断言。同生产构建真实Chrome GREEN，Dewey只读审查PASS；不是应用缺陷的文案兼容修补。远程复跑待新commit。
