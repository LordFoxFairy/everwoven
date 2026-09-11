# 官方视频基础适配 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不启动付费请求、不冒充实时播放的前提下，补齐官方 H3/H3 Max 创建与查询任务适配，为行动到画面实测提供可测试的接入基础。

**Architecture:** 独立 job 接口而非伪造 LiveVideoSession；从现有供应商—模型登记选择官方端点。请求构建器校验文生/首尾帧模式，服务端工厂注入凭据与 transport。保持现有游玩门禁关闭；预算调度、连续播放、正式路由与素材上传后续实现。

**Tech Stack:** TypeScript、原生 fetch、Vitest；不新增依赖。

## 文件与步骤
- [x] `apps/web/lib/video/minimax-request.test.ts`：先写默认桌面比例、模型约束、首尾帧 adaptive、非法图片/模式不静默忽略的失败测试。
- [x] `apps/web/lib/video/minimax-request.ts`：实现纯参数构建，不读取密钥、不获取图片、不发请求。
- [x] `apps/web/lib/video/server/minimax-jobs.test.ts`：创建/查询契约、网络不确定不重试、错误脱敏、结果结构校验、供应商隔离。
- [x] `apps/web/lib/video/server/minimax-jobs.ts`：最小服务端任务工厂，无自动轮询/重连/重试，无自动删除和无 UI 调用入口。
- [x] 保留现有官方实时门禁，增加不可自动变成 live 的回归测试。
- [x] 更新研究记录与完成边界；全量测试、类型检查及构建。

## 验收约束
- 单次函数调用至多一次网络请求。创建超时或响应不确定时保留“提交状态未知”，不当作确定失败后自动补发。
- 查询成功不意味着已播放、语义符合或世界事实成立。
- 官方删除接口兼有取消/删除记录语义，不包装为无条件可安全取消；本轮不实现 DELETE。
- 所有测试注入假 transport，不读取真实密钥、上传用户图片、开启外部请求或产生费用。
- 当前仓库尚无基线提交；只做聚焦文件修改，不建立整仓提交。
