# 成熟组件复用审计 · 技术方案1.2补充

2026-09-10 · 来源：用户追问Vercel与shadcn/ui是否已有能力。本次核对官方文档与仓库；未安装依赖、未改运行代码、未做付费验证。

> **2026-09-11 后续实施：** 已引入官方源码改编的 shadcn AlertDialog/Button（Radix 底层），替换 StageConfirmation；已有 components.json、局部样式和授权说明。下方仓库状态是9月10日审计快照，不再代表这两个组件的现状。其他 AI/认证/编排复用门槛仍未完成，见[实施记录](../implementation/SHADCN-SHELL-2026-09-11.md)。

## 1. 修正评审结论的范围

技术方案1.2独立审查解决了分支来源、预算、幂等等业务不变量，但未充分覆盖“自建还是复用”的实现选型。其业务设计结论保留；**技术选型完整性暂不标为全部通过**，进入开发前补齐下表中的最小兼容性验证。成熟组件优先，自建部分要有明确缺口，不因已有文档就继续造通用框架。

## 2. 仓库实际状态

读取apps/web/package.json、apps/runtime/package.json及组件目录：

- 已有Next/React、tRPC/TanStack Query、Zod/Tailwind、Prisma/SQLite。
- 未发现shadcn components.json或标准components/ui落地，packages/ui目前主要是主题token；锁文件间接出现Radix不代表已接入shadcn组件体系。
- Web/runtime直接依赖未接入ai、@ai-sdk/react、@ai-sdk/langchain、LangChain/LangGraph或认证库。
- StageConfirmation当前用原生dialog加自写焦点逻辑；有测试和全屏top-layer考虑，不随意删掉，但应比较成熟Dialog/AlertDialog而非继续复制这种实现。

因此“我们采用T3方向”与“成熟技术组合已经接好并验证”是两件事。

## 3. 复用裁决

| 能力 | 优先方案 | 我们保留的产品职责 | 准入状态 |
|---|---|---|---|
| 按钮、输入、Dialog、Sheet、Popover、菜单、Tabs等 | shadcn/ui，统一一种底层primitive体系、主题token与组件出口 | 晴空浅蓝/淡紫视觉、布局和阶段性浮层 | 采用方向；先验证全屏portal/焦点/键盘，逐项迁移 |
| AI创作Chat：消息、附件、工具确认、建议、任务呈现 | Vercel AI Elements，基于shadcn/ui | 草稿归属、明确确认写入、创作权限/预算与记录 | 二期按需采用，不搬进游玩主界面 |
| AI流与LangChain联通 | AI SDK UI + 官方@ai-sdk/langchain适配 | 业务事件与消息类型的映射、持久化、错误与重连策略 | 先验证文本/工具/自定义事件，不手写同义流协议 |
| Agent推理、工具与复杂编排 | LangChain/LangGraph单一编排 | 剧情规则/上下文构建/已确认事实与服务工具 | 不再叠一个AI SDK Agent循环 |
| 后续工作画布/节点呈现 | AI Elements Canvas / React Flow | 节点业务含义、权限、读写命令、树投影与分页 | 二期，不自写缩放/拖拽/连线引擎 |
| 视频SDK调用 | 优先评估AI SDK视频接口及供应商正式SDK | 精确供应商/地区/模型绑定，task恢复、费用、媒体检查 | 实验接口和具体部署需验证；保持薄适配 |
| 长任务执行 | 评估Vercel Workflow等现有基础设施的部署/持久性 | 业务预算、unknown责任、领域状态与原子事实仍由Service/DB负责 | 未决定接入；不同时维护两套编排真值 |
| 认证会话 | 优先评估成熟Next/T3兼容认证组件 | 本地宿主引导与profile、单实例、文件权限/备份边界 | 先最小适配验证，不默认自写通用认证框架或强制云登录 |

shadcn提供可修改的组件源码，而不是自动生成完整产品审美或免维护依赖；复制到仓库后的升级/修改仍由项目管理。AI Elements的Checkpoint/MessageBranch是呈现组件，不能代替游戏不可变存档与费用事务。[shadcn官方介绍](https://ui.shadcn.com/docs)、[AI Elements](https://elements.ai-sdk.dev/)、[Canvas](https://elements.ai-sdk.dev/components/canvas)。

官方@ai-sdk/langchain已经提供消息转换、LangChain/LangGraph流转换和自定义数据事件支持；适配不等于自动取得业务存档、持久恢复或精确视频模型能力。[LangChain适配文档](https://ai-sdk.dev/providers/adapters/langchain)。

## 4. 不把复用变成新的绕路

### 4.1 一个应用，不等于所有协议都硬塞tRPC

创作CRUD与游戏命令仍用tRPC；二期AI Chat流可在同一个Next应用内使用AI SDK原生Route Handler和UIMessageStream。它是专用流传输，不是第二网站、第二业务Service或第二套同义REST CRUD。共用会话/Origin/CSRF、输入边界、工具Service与费用准入；不为“所有请求都必须tRPC”重写官方适配器。不向浏览器暴露供应商或LangSmith密钥。

### 4.2 Vercel生态与Vercel托管分开

可以用Next、AI SDK及AI Elements而继续本机运行；这不要求把本地SQLite迁到Vercel Functions。Vercel的函数文件存储不等于可共享持久SQLite。[Vercel SQLite说明](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)。

Workflow Local World官方明确面向开发，队列在内存，重启不保留待执行步骤；不能因有本地示例就认定满足桌面长期恢复。生产World需另核对依赖、运维和本机交付成本。先做适配验证再决定替换哪一层，不同时造自研通用调度平台和第二套Workflow引擎。[官方Local World文档](https://workflow-sdk.dev/worlds/local)。

### 4.3 视频接口不是端到端游戏Provider

AI SDK已有experimental_generateVideo，不能再假设其没有视频抽象。官方列举的FAL/Replicate MiniMax视频例子也不等于用户指定的MiniMax官方直连部署已验证。采用前核对精确模型、账号/地区、任务ID可见性与重开查询、计量、素材输入及错误重试。

默认SDK重试需要审计；提交未知的创建操作禁止通用自动重提，可确定只读查询再按政策重试。保留原操作凭据与费用责任，不能因高级SDK返回Promise就失去恢复能力。[视频接口参考](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-video)、[视频生成指南](https://ai-sdk.dev/docs/ai-sdk-core/video-generation)。

## 5. 下一步最小验证，而非继续扩大架构

1. 在同一应用验证shadcn基础组件与现有token的适配；首个垂直切片只替换一种通用弹窗/浮层，保留原内容、草稿和行为测试。覆盖舞台系统全屏、portal容器、Escape、焦点返回、输入法与窄窗口。
2. 认证/会话库做本机引导适配验证，与M0-C身份/数据保护合并实施；不先自建通用账号平台。
3. AI流桥接以隔离fixture验证官方适配器的工具/自定义事件、错误/重连及版本兼容；不发付费请求、不把测试替身注册为产品供应商。完整创作Chat仍二期。
4. M2前验证视频SDK和持久任务实现是否满足既定业务不变量，再选薄适配或补缺口；不提前安装所有库或承诺本地Workflow可交付。

每项输出：采用组件、剩余自建逻辑、固定版本、最小验证证据及失败回退。复用评审未完成不称整体选型最终定稿；业务数据库和当前用户数据不因本补充改变。
