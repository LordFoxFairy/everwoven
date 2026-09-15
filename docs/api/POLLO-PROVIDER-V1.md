# Pollo H3 Max 接入与最小验收

更新：2026-09-14。状态：适配实现；真实视频尚未验收。

## 协议依据

用户指出已有 `general_agent` 实现。核对其 `services/pollo/config.py`、`client.py`、`polling.py` 与视频计费模块，以及相邻 `ai-collection` 的 H3 Max request-schema handoff、文生 schema、Pollo 状态枚举后，采用**内部 platform 协议**。不搬入原项目业务代码、密钥或计费倍率。

| 项目 | 本次实现 |
|---|---|
| 供应商 | `pollo`，与 `minimax` 官方分开 |
| 产品模型 ID | `minimax-h3-max` |
| 实际提交模型 ID | `minimax-hailuo-03-max` |
| 测试 endpoint profile | `pollo-test-platform`，固定用户提供的测试域名 |
| 正式 endpoint profile | `pollo-production-platform`，固定 Pollo 域名；不自动切换 |
| 提交 | `POST /api/platform/generation/text2video` |
| 请求 | `{generationInput:{videoModel,prompt,resolution,length,aspectRatio,numOutputs:1,...},sort:0}` |
| 回执 | `code: SUCCESS` 与 `data.id`；正的安全整数无损规范成字符串，不接受失精度数字 |
| 查询 | `GET /api/platform/generation/{taskId}` |
| 状态 | `waiting → queued`，`processing → running`，`succeed → succeeded`，`failed → failed` |
| 输出 | `data.videoList` 恰好一条，优先 `videoUrlNoWatermark`，缺失时取 `videoUrl`，均验证 HTTPS；同一任务查询允许省略 id/model，回显时必须一致 |
| 规格 | 5–15 整数秒、`480P` / `768P`、明确画幅；V1只安装文生 |

这不是公开网站示例的 `/v1/generation/.../video`、`input`、`taskId`、`generations` 协议，不能混用。普通 H3 的价格与四秒档不适用于 H3 Max。

## 鉴权与本机配置

- 视频 Key 只从绑定的 `env:POLLO_*` 引用读取；文字 Key 只供 OpenRouter。
- 测试网关额外从 `POLLO_SERVICE_BASIC_AUTH_KEY` 读取完整 Basic Authorization 值；可选 `POLLO_SERVICE_UA`。真实值只放本机私有配置。
- registry 用 `region: test` 或 `production` 明确供应商环境，与应用 demo/dev/prod 独立。
- 不在绑定 JSON 中放原始 Key、Basic 值或任意 base URL；不同环境、账号或模型会改变绑定摘要。
- 每个新接受的执行 profile 在收费规划之前纯校验适配器与凭据格式。
- HTTP 不跟随重定向。飞书登录页面/302、网关 HTML 都不视为 API 成功。

只读检查命令：

```sh
node scripts/provider-preflight.mjs /absolute/private/provider-secrets.json
```

文件必须由当前用户持有、0600、非符号链接。字段为 `OPENROUTER_API_KEY`、`POLLO_API_KEY`、`POLLO_BASE`，以及可选的网关字段。工具只有 GET，没有生成 POST；输出不含 Key、原始响应、跳转参数。`api-response` 仅表示 HTTP/JSON 接通，不证明模型可用或生成完成。

## 持久化、媒体与费用边界

适配器复用现有 `VideoJobAdapter`、Worker、Outbox 和报价接受流程，无新表/外键。任务引用封存供应商、账号、连接、环境、模型、绑定摘要、请求摘要和 operation ID。重启查询原 task；提交超时/回执丢失保持 unknown，不自动重发。

内部响应未提供可靠计费秒数与货币费用。适配器返回的视频时长、分辨率、画幅是**已封存的请求预期**，由私有媒体 ffprobe 独立验证实际像素/时长/编码，再允许播放；这些预期不作为 usage 或账单。内部 credit 不擅自转换为 USD，缺少成本证据仍保留预算责任。

general_agent 的 `/api/platform/credit` 是询价能力，业务层会将内部成本乘二。这一倍率属于其产品计费，不移植为本产品价格。当前仍需验证本账号询价与实际账单口径，并封存匹配本规格的价格及精确像素/CDN策略，才启用正式 generation profile。

## 首次真实验收顺序

1. 零生成请求完成网关鉴权、模型身份/规格、本地协议测试和类型检查。
2. 核实 5 秒、480P、单条、固定横屏画幅的可用性、像素尺寸与费用上限。不得通过反复收费提交猜参数。
3. 准备该规格对应的安装 profile，确认原数据没有遗留待执行任务。
4. 原3100页面接受一份报价，最多一条视频提交；规划/验证各按封存调用上限执行。
5. 取回视频→私有文件验证→完整播放→生成片尾建议/自由回应→重启读取同一结果。全过程记录任务ID和费用证据；异常先核对原任务。
6. 一幕成功只证明最小供应商闭环；第二幕、连续性及最终账单仍需独立验收。

## 本轮已观察结果

- OpenRouter `/api/v1/key`：HTTP 200，JSON Key 查询成功；没有发起文字生成。
- Pollo 测试域名原任务 GET：携带用户提供的 Key，分别使用默认与 general_agent User-Agent，均返回 HTTP 302 至飞书认证；未跟随。
- 全程视频提交零次，收费生成请求零次。测试网关鉴权待补，不声明首次生成成功。
