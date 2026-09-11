# 游玩舞台布局 Implementation Plan

**Goal:** 落地用户已同意的画面/表达分区，先消除遮挡，不宣称视频能力完成。
**Architecture:** 保留 Player 与本地保存接口，仅重排同一游玩 surface；场景信息与表达放在舞台外的侧栏，短屏自然滚动。无新依赖。
**Tech Stack:** Next.js / React / TypeScript / CSS Modules。

- [x] 修改 apps/web/components/story-player.tsx：舞台和侧栏分开，删除无场景依据的灵感选项；侧栏展示当前角色与起始条件，表达可展开并保存草稿。
- [x] 修改 apps/web/components/story-player.module.css：9:16 参考画面 contain、不裁切，浅色外壳，宽屏双区、窄屏上下；键盘焦点清晰。
- [x] 保持本地记录真实性，不增加假的生成、语音、进度与响应。
- [x] pnpm typecheck、pnpm test、pnpm build；浏览器走查当前页与进入后的布局。

不动用户存储、不修改剧本内容、不接收费会话。完整会话状态/准备流程为后续切片，不在这次布局修改中假装交付。

验证：类型检查与9项现有测试通过；浏览器检查了窄桌面宽度下的展开表达态，画面与输入分区无重叠。尚未验证所有窗口尺寸；未开启模型会话。自定义角色沿用林舟 artId 时，游玩页回退至场景参考，不再展示错误人物肖像。
