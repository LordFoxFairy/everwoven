# M1-A · 创作端口与会话边界 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已经可用的数据库创作端口移出 React 组件，并验证会话响应，为原编辑器异步接入建立可复用且可验证的边界。

**Architecture:** 前端领域端口定义在 lib/authoring，传输适配器只依赖端口与 tRPC，不反向依赖页面。原 DatabaseDrafts 继续消费同一接口，暂不更改 UI 或数据库 schema。更大的 M1 新契约和业务数据重建以 INTEGRATED-AUTHORING-M1.md 为准，不在此小批次偷渡。

**Tech Stack:** TypeScript、Next、tRPC、Vitest、现有 React Testing Library。

## Chunk 1: 端口与真实响应验证

**Files:**
- Create: `apps/web/lib/authoring/ports.ts`
- Create: `apps/web/lib/authoring/database-client.test.ts`
- Modify: `apps/web/lib/authoring/database-client.ts`
- Modify: `apps/web/components/database-drafts.tsx`
- Existing regression: `apps/web/components/database-drafts.test.tsx`, `apps/web/components/authoring-navigation.test.tsx`

- [x] Step 1: 测试传输响应：GET 只接受 authenticated:boolean；POST 必须 authenticated:true；DELETE 必须 authenticated:false。null、数组、错误类型、畸形 JSON、非成功 HTTP 均拒绝；格式异常使用固定错误，不泄露响应体。成功额外字段可忽略。
- [x] Step 2: `pnpm exec vitest run apps/web/lib/authoring/database-client.test.ts --maxWorkers=2`；确认新断言在旧实现失败。
- [x] Step 3: 原样移动 DatabaseDraftsClient 至 ports.ts，禁止组件 type re-export；全部引用改为直接从端口导入，不留兼容别名。adapter 从端口 import type，禁止导入组件。只使用运行时无依赖的 DTO 类型引用。
- [x] Step 4: 适配器验证 sessionRequest 输出，方法限制 GET/POST/DELETE；所有请求保留 same-origin/no-store/现有防跨源 header。成功状态错误和失效 JSON 都抛出固定可读错误。服务端 error 不回显，使用固定安全消息。
- [x] Step 5: 验证 CRUD 参数及返回值原样委托 tRPC，异常向上传播，不添加 mutation 自动重试；GET 仍 includeDeleted:true。
- [x] Step 6: 主仓复跑新增测试、DatabaseDrafts 与外层导航回归，`pnpm typecheck`，确认 demo/后端接口/数据库未改。
- [x] Step 7: 规格复核通过后代码质量复核，修复具体问题；更新 docs/PROGRESS.md 的证据和剩余范围。
- [x] Step 8: 仅提交本次明确文件，不包含根目录研究草稿；未验证生产构建或发布时不写“已发布/全量闭环”。

## 后续批次（独立详细计划后实施）

1. 单一完整创作契约、新Prisma baseline与受限项目业务reset；不做旧协议/旧回执/旧库迁移兼容，先临时库验证，保留schema gate。
2. 角色库 CRUD → 原 CharacterLibrary 异步接入 → 浏览器重启验证。
3. 图片上传/读取/崩溃恢复 → 角色快照/剧本聚合保存 → 原 StoryEditor 接入。
4. 单入口移除临时双存储创作路径，端到端验证后再做真实模型任务闭环。

用户已要求自主推进，不重复询问实施顺序。项目业务数据重置、付费模型验收和发布动作遵守各自独立的验收门槛。

## 本轮复核与证据

核心规格和代码质量复核通过；主仓先129通过/4失败，修正两处effect等待后单worker133/133、typecheck通过。未放宽断言/超时。详细M1基线已复核通过并取消旧数据兼容路线；真实数据重置和原页面贯通仍是下一批，不在本切片标完成。

实现者RED证据：adapter新测试先对旧实现运行，103项中64失败/39通过（退出1），再实现。主仓最终独立GREEN为三文件133/133。
