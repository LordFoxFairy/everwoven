# H3 Max Director 接入计划

以已批准的实时现场设计为基础，本次单一端到端切片：独立 provider、服务端密钥代理、启动确认、媒体播放与文本方向、关闭清理。

核对来源：https://fal.ai/models/minimax/h3-max/director/api 。使用 minimax/h3-max/director，而不是返回文件的普通 H3 Max。SDK alpha 固定版本。

任务：实现中立会话契约和可注入传输；先测试配置/提示版本/回执/停止语义；接 SDK；代理仅开发模式同源本地开放且仅允许该模型，生产默认禁用直至实现登录与预算；UI 进入前说明计费，不自动启动；验证类型、测试、构建。未配置 FAL_KEY 时保留原型，无收费调用。chunk 仅映射 generated，不能映射 presented。
