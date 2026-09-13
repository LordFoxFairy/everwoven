# MiniMax官方接入证据复核 · 2026-09-12

## 2026-09-13追加：详情已成功读取

以下更新替代下文“本轮详情抓取未成功”的当前状态；下文保留为9月12日取证历史。仍未调用付费模型，文档证据不等于账户实测。

- [国际创建接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)：明确H3及H3-Max；Max支持文生/首尾帧图生，5–15秒、480P/768P，不支持多模态参考或2K。H3支持参考输入，4–15秒、768P/2K。图生比例由输入图决定，提交16:9参数不强制生效。这里是异步任务协议，不是可随时打断的视频流。
- [中文创建接口](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)：国内请求主机为api.minimax.cn，国际为api.minimax.io；按连接地区固定，禁止失败后带同一凭据自动跨区。已读取的页面列有结构化错误包络；单独一个HTTP状态码不作为完整的未受理证据。
- [查询接口](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)：按task_id查询最近7天任务；成功含视频定位及usage。持久化任务ID、固定账户绑定及下载后的本地媒体，不依赖供应商永久保存历史。页面示例不能证明任何现有账户已可用。
- [国际按量价格](https://platform.minimax.io/docs/guides/pricing-paygo)：Max 480P为$0.05/秒，768P为$0.08/秒，当前图片输入不另收费；H3 768P为$0.08/秒，2K为$0.13/秒，参考输入另按该页规则计。以两段各5秒估算，Max仅视频输出分别$0.50/$0.80；不含规划/检查、重做或税费。这是国际公开标价，不是国内账号价格，也不是本轮消费授权。

### 实施裁决

1. “官方详情取不到”不再是实现任务链的阻碍。以现有Provider专项为唯一设计基线，补Connection固定身份、报价授权、任务持久化、未知提交对账与媒体落地。
2. 先交付分段生成：准备→生成中→播放→播完浮现建议/自由回应→提交下一幕。生成中不承诺任意介入，首段未经播放不提前显示情境选项。
3. `documented`、`implemented`、`account verified`分开登记。已有minimax-jobs基础代码测试不直接升级为真实生成验收。
4. OpenAPI JSON此次仍取回工具错误；不声称完整机器schema已下载。保留来源日期、地区和参数范围；素材传输细节、取消计费及账号权限在对应实现前继续验证。

---

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
