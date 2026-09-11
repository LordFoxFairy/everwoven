# shadcn确认弹窗最小落地计划

**Goal:** 执行用户已同意的复用审计首个切片：同一3100应用替换StageConfirmation，保留用户数据与游戏流程。

**Architecture:** 手动按官方shadcn new-york-v4 registry引入AlertDialog/Button源码，选择Radix单一primitive底座；样式映射既有晴空tokens，不执行覆盖全站的init。业务层只负责文案、关闭结果、原触发焦点与舞台portal容器，焦点圈定/无障碍/背景隔离由成熟primitive负责。

**Tech Stack:** 当前固定Next/React/TS＋shadcn源码＋Radix；Vitest DOM行为验证＋独立浏览器会话走查。依赖精确固定，保留来源与修改说明。

## 范围/取舍

- 保留原生dialog虽然省依赖，但继续自写焦点逻辑；本次采用用户同意的shadcn替换。不一次迁移全部表单/站点，不引入另一套Base UI。
- 明确取消/确认；取消默认焦点；背景点击不丢稿；Escape只取消弹窗不触发舞台收纳。
- portal固定挂在舞台内的专用空宿主，进入或退出系统全屏无需重挂/失焦。业务不向document.body硬编码挂载。
- 关闭后恢复发起按钮，确认替换时由业务明确转入输入框；首次挂载不执行任何业务回调。
- 不改数据库、不发模型请求、不把演练升级为真实视频。

## 执行

- [x] 新增DOM行为反例：alertdialog语义、初始安全焦点/Tab圈定、Escape只关闭、显式确认一次、stage portal归属、草稿保留与确认后替换。
- [x] 运行失败测试，记录旧组件缺失alertdialog/portal行为；只新增测试依赖后运行。
- [x] 引入components/ui/alert-dialog、button及局部样式/注册配置；替换StageConfirmation，移除旧焦点陷阱和CSS。
- [x] DOM测试通过；真实浏览器验证全屏、键盘、背景、取消/确认、窄屏布局与无控制台错误。
- [x] 主仓执行test/typecheck/build；独立只读代码审查；补实施记录和更新复用审计实际状态。

初始仓库无HEAD，既有大量未跟踪文件；随后用户明确授权整理并推送私有 GitHub 首版；最终恢复「未完」命名和原标识，同时要求组件化局部固定布局与 Web Docker 部署。按源码白名单提交，不打包私有研究附件、不重置用户文件、不创建第二个站点或外部 worker。

实施与实际验证范围见 [本轮记录](../../implementation/SHADCN-SHELL-2026-09-11.md)，未覆盖的跨浏览器/输入法事项不记为已通过。
