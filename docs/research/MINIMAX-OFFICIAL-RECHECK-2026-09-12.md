# MiniMax官方接入证据复核 · 2026-09-12

本轮在推进创作持久化时同步核对M2依赖。**仅记录已取到的官方证据，不将搜索缓存/第三方说明当成API验收。没有使用密钥或调用生成接口。**

## 已确认的官方索引

本次成功读取的[国际站文档索引](https://platform.minimax.io/docs/llms.txt)已列出H3/H3 Max视频服务、V2生成/查询/任务列表/取消删除、Context-IR及视频再生成，也列出了H3本地部署指南。索引描述查询/列表覆盖最近7天的任务。该证据支持继续调查官方V2链路，**不支持宣称模型不存在，也不代表账户已有调用权限或已核实价格**。

后续官方核验入口（索引列出，但本轮详情抓取未成功）：
- [V2创建](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)
- [V2查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)
- [V2取消/删除](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)
- [V2 OpenAPI](https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json)
- [按量计费](https://platform.minimax.io/docs/guides/pricing-paygo)

## 证据限制与实施规则

- 搜索引擎仍返回3个月前Hailuo 2.3页面；与本次读取的索引不同时效。禁止拿旧版本接口的字段、时长、状态枚举和价格直接替换H3。
- V2详情/.md/OpenAPI本轮由web工具报告抓取失败；未把第三方聚合站参数作为官方参数。具体model ID、时长/分辨率/参考图组合、请求重试幂等、取消条件、下载有效期和价格仍要在M2实施前取得直接证据。
- 现有仓库包含minimax-v2 job适配基础代码；现有单元测试只能证明本地解析/映射行为，不证明真实供应商接受请求。
- 当前M1工作不依赖付费调用，也不自动启用fal；保留供应商→具体账户/地区→精确model的绑定设计。
- 到真实生成验收时：先补官方请求契约证据，再确认账户凭据与用户明确预算，然后做有界真实端到端。后台任务、媒体持久化、播放后交互另行真实测试，不以文档索引或演示图代替。
