# 供应商—模型—部署映射

**2026-09-10自审补充：** 正式设计以[Provider专项规范](architecture/PROVIDER-DESIGN.md)为准。下文“已落实”仅描述既有原型目录/单次适配器，不代表Connection、费用和可恢复任务已完成。官方文档型号已复核；真实账户准入仍未通过。

2026-09-09。本文件修正之前默认把 H3 接入等同于 fal 的设计。

## 配置结构

供应商：API 地址 / 鉴权 / 账号凭证 / 区域 / 限额归属。
模型：名称 / 版本 / 变体。
部署映射：供应商 ID + 模型 ID → 远端模型标识、协议适配器、该部署实际支持的能力。

不默认将 MiniMax 流量发给 fal；未知组合明确报错，不共享密钥。

| 供应商 | 模型 ID | 远端标识 | 核对到的接口 | 当前实现 |
|---|---|---|---|---|
| minimax | minimax-h3 | MiniMax-H3 | V2 生成任务 | 目录已登记，任务/连续播放适配待完成 |
| minimax | minimax-h3-max | MiniMax-H3-Max | V2 生成任务 | 目录已登记，任务/连续播放适配待完成 |
| fal | h3-max-director | minimax/h3-max/director | WMA WebRTC | 已有传输适配；仍未付费联调 |

官方 H3 Max 已在中文官方接口文档列出，不应宣称该名称只有 fal 能提供。官方任务 API 返回 task_id，与 Director 长连接协议不同。实时生成产品可研究以官方极速任务驱动连续生成调度，但其启动延迟、衔接和可交互延迟必须实测，不能把任务 API 改名为流式 API。

## 已落实到代码

- catalog.ts：公开供应商、模型、部署目录与显式服务端选择。
- registry.ts：将供应商/模型组合解析到具体适配器。
- director.ts：从固定导出改为模型实例工厂；界面不再直接引用 directorProvider。
- status API：只返回公开选择、可用性和原因，不返回密钥。
- ConfiguredLiveSession：按配置进入准备页；不支持的组合不静默换供应商。
- fal 代理：仅在显式选择 fal 的支持部署后启用。

VIDEO_PROVIDER / VIDEO_MODEL 留空时不产生隐式默认。示例见 apps/web/.env.example。配置仍是开发环境变量，不是已完成的多租户供应商管理后台。

本次没有读取/写入真实密钥，也没有提交付费生成任务。生产接入仍需账号权限、预算和会话归属验证。

来源：
https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
https://platform.minimax.io/docs/api-reference/video-generation-v2-create
