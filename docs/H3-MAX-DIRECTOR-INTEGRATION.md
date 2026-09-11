# H3 Max Director 实时接入

2026-09-08。代码接线完成；未使用真实密钥开启收费会话。不是生产上线完成。

## 本地启用

在 apps/web/.env.local 中设置 FAL_KEY 与 FAL_LOCAL_ENABLED=true（参考同目录 .env.example），重启 pnpm dev。不要将密钥发在聊天或写进 NEXT_PUBLIC_ 变量。

在游玩页系统菜单选择「进入实时生成」。准备页检查可用状态并说明最低计费；只有确认后才建立会话。本轮默认 480p、9:16、声音输出静音；麦克风不启用。

## 结构

- lib/video/types.ts：与模型无关的会话 / 事件接口。
- lib/video/director.ts：fal SDK WMA transport，configure / prompt / stop，递增版本与输入 ID 关联。
- app/api/fal/proxy/route.ts：服务端密钥代理、模型白名单、同源及本地开发开关。
- components/live-session.tsx：准备、播放、自由输入、声音与结束。

普通 H3 Max 返回片段文件，Director 才是本次实时会话适配器。原有 localVideoProvider 继续只记录原型表达；新 LiveVideoProvider 是运行时接口，后续应迁移/废弃旧接口而不是让它假装实时。

## 验证边界

mock 测试验证配置只发一次、版本/回执关联、停止清理、非法配置、开发访问守卫。chunk 只映射 generated，不等于已播放，也不触发情节卡片。没有编造精确画面响应时间。

SDK alpha 已锁定精确版本。没有自动重连或重复收费重试；本地两分钟关闭计时从连接开始算，是客户端防遗忘措施，不是服务端预算保证。close 发 stop 后关闭 peer；不将连接关闭宣称为账单停止确认。

本次没有把实时表达写成 recorded-demo 的存档记录；会话持久化、输入幂等跨重连、世界状态与卡片生命周期仍待实现。

生产模式代理默认拒绝。部署前必须接登录、会话归属、服务端额度与并发限制，不能仅把 NODE_ENV 条件去掉。当前 origin/loopback 限制用于本地开发，不是生产身份验证方案。

尚待真实联调：账号权限、首帧、有声播放、方向生效、断线、后台计费停止与会话上限。完整媒体播放状态没有自动识别人物/物件；不支持自由点选视频热点。

来源：https://fal.ai/models/minimax/h3-max/director/api 、https://fal.ai/h3-max-director 。文档存在音频采样率描述差异，本实现直接播放媒体轨道，不硬编码采样率。任何营销性能描述都未作为实测结果。
