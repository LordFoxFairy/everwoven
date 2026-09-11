# 剧本平台交互原型 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** 基于已批准的平台方向构建可复用的三屏原型，并串联创作和游玩。

**Architecture:** pnpm workspace包含Next.js Web与共享React组件。领域类型、模拟Repository和媒体Provider分离；桌面薄壳在Web体验确认后增加。

**Tech Stack:** TypeScript、React、Next.js、Tailwind、自有tokens；表单与测试依赖随任务添加。

## Chunk 1: 设计与领域契约
- [x] 明确剧本、版本、角色与存档边界：见相邻specs设计文档。
- [ ] Figma建立Foundations、Components、Screens、Flows页面，先完成三屏及加载/错误/空状态。
- [ ] Figma tokens对应packages/ui/src/tokens.css；组件覆盖StoryCard、CharacterCard、EditorSection、InteractionCard、PlayerComposer。
- [ ] 评审三屏截图后冻结第一轮视觉，避免未确认风格扩散。

## Chunk 2: 可运行Web
- [ ] 创建根package.json、pnpm-workspace.yaml；apps/web采用App Router；packages/domain存领域类型，packages/ui存展示组件。
- [ ] 在packages/domain/src/story.test.ts先写发布快照隔离和存档隔离测试，再实现story.ts。运行pnpm test，先确认失败再通过。
- [ ] packages/domain/src/repository.ts定义StoryRepository：list、get、saveDraft、publishSnapshot、createSave、getSave。mock-repository.ts负责演示持久化与显式错误注入。
- [ ] apps/web/app/page.tsx广场；app/stories/[id]/page.tsx详情；app/studio/[id]/page.tsx编辑器；app/play/[id]/page.tsx游玩。路由薄封装，业务组件留共享包。
- [ ] 封面使用有来源或生成的独立素材，禁止使用未批准旧整屏原型。
- [ ] 完成筛选、编辑校验、保存、角色添加、进入确认、模拟输入与卡片、退出继续。

## Chunk 3: 验证及交付
- [ ] e2e/platform.spec.ts覆盖创建→保存→游玩→退出→继续；覆盖无搜索结果及保存失败；断言演示模式标签。
- [ ] 执行pnpm test、pnpm exec tsc --noEmit（各应用配置后）、pnpm --filter web build与pnpm exec playwright test；记录真实输出，不提前声明通过。
- [ ] 浏览器检查1280/1440/1920宽度和键盘路径，修复溢出与焦点问题。
- [ ] 给出本地预览、已实现功能和模拟能力清单。Tauri与真实Provider为后续独立验收，不计为本轮已完成。
