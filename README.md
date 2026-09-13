# 未完 · Everwoven

**Stories, still becoming.** 用户定义世界、角色与开局，用自己的选择与表达推动下一幕。

本地优先的 AI 互动视频游戏平台，面向 Web 与后续桌面端。晴空浅蓝 × 淡紫，桌面自适应单视频舞台，交互浮层按剧情阶段出现，而不是常驻聊天面板。

## 当前开发状态 · 工程与交互原型

推进真值见 [PROGRESS](docs/PROGRESS.md)，已实现的创作字段、架构/时序、接口与SQL见 [M1 原创作贯通技术方案](docs/architecture/INTEGRATED-AUTHORING-M1.md)。使用全新业务数据基线，不建设旧数据兼容层；不会自动导入或清除既有浏览器演练数据。

已发布版本为 **v0.1.0**；下表包含尚未发布的本机存储切片，新功能不等于旧镜像已更新。

**一期交互：生成 → 观看 → 情境建议／自由回应 → 生成下一段。** 生成和播放中不支持实时插入指令。`APP_ENV=demo` 默认运行前端 Mock 演练：静态参考图与显式模拟结束，不是已上线的真实视频生成。

| 已实现 | 当前边界 |
|---|---|
| 演练剧本浏览/编辑、角色、图片与个人接续入口 | 仅demo：前端localStorage/IndexedDB；非正式存储或云同步 |
| 自适应单舞台、全屏、情境建议、自由回应、草稿保护 | Mock 数据与行为由前端管理；不调用模型 |
| T3 组合：Next.js + TypeScript + tRPC + TanStack Query + Zod | 供应商配置元数据读取；专用本机模式已接入受保护的原剧本聚合 tRPC CRUD |
| shadcn AlertDialog/Button 与独立布局组件 | 复用 Radix 的焦点/模态能力；非全站组件迁移完成 |
| Prisma + SQLite 原角色库六操作、私有图片、完整剧本聚合、自动本机会话 | 原页面保存、异常恢复、冷浏览器及进程重启已验收；不依赖浏览器业务存储，旧临时面板已删除；零外键，仅真实唯一 |
| 供应商—模型绑定、MiniMax 官方任务适配基础代码 | 指定模型的可用性、付费端到端生成与恢复尚未验收；不自动转到 fal |
| Docker Web 打包与 CI | 同一个应用的另一种启动方式，不是第二套站点或完整多用户服务 |

未来 AI 创作对话/画布、LangChain/LangGraph 编排、分支存档、Tauri 桌面交付仍按阶段实施。文档中的设计不等于已上线功能。

## 本地开发

Node.js 22（见 `.node-version`），pnpm 12.3.4（已固定锁文件）。

```sh
corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm install --frozen-lockfile
pnpm dev
```

打开 [未完 本地应用](http://127.0.0.1:3100/)。默认 Mock 无需模型密钥。不要把私有密钥放入前端变量或提交到 Git。

```sh
pnpm test       # 生成 Prisma 客户端并运行测试；使用隔离临时数据库
pnpm typecheck
pnpm build     # runtime 检查构建 + Next standalone 构建
```

当前本机存储切片与验证状态见 [PROGRESS](docs/PROGRESS.md) 与 [原图片接线记录](docs/implementation/M1-C2-ORIGINAL-IMAGES-2026-09-12.md)，完整原创作门槛见[验收矩阵](docs/implementation/M1-ORIGINAL-CREATION-ACCEPTANCE.md)。已发布 v0.1.0 的验证另见[环境与发布验证](docs/implementation/ENVIRONMENTS-RELEASE-2026-09-11.md)，不要把本地新实现当作旧镜像已有功能。

## 启用本机数据库

普通开发默认保留前端存储。正式 SQLite 创作使用**同一应用**的显式本机启动器：初始化专用数据目录 → `pnpm local` → 打开原角色库，应用自动连接。它固定监听 loopback，原角色保存/删除/恢复及图片已接通；完整原剧本聚合已通过原页面生产测试，正式单入口启用已实测，最新提交CI状态见PROGRESS。不自动导入浏览器数据、不冒充真实视频生成。

详见[启动与数据边界](docs/deployment/LOCAL-HOST.md)、[自动会话契约](docs/api/LOCAL-AUTO-SESSION.md)及[当前聚合tRPC契约](docs/api/STORY-AGGREGATE-M1.md)。

## 环境选择

`APP_ENV=demo|dev|prod`，默认 `demo`。demo 提供前端演练；dev/prod 保留本地创作、关闭示例和假游玩，真实生成仍待接通。浏览器设定/图片按环境分区，demo 保留原数据。环境配置不等于产品已通过生产验收。

```sh
APP_ENV=dev pnpm dev
APP_ENV=prod docker compose up -d --force-recreate
```

同一个镜像在启动时读取 APP_ENV，无需按环境重建；`NODE_ENV` 由 Next 管理。详见[环境配置](docs/deployment/ENVIRONMENTS.md)。

## Docker 运行 Web

```sh
docker compose up --build -d
```

同样访问 [本地应用](http://127.0.0.1:3100/)。开发服务已占用该端口时，先停止开发服务，或临时指定 `EVERWOVEN_PORT=3200 docker compose up --build -d`；来源配置会随端口同步。

容器默认非 root、只绑定本机。公开 Web 访问、TLS 反向代理、`APP_ORIGIN`、数据保存边界与更新方式见 [Docker 部署说明](docs/deployment/DOCKER.md)。更换访问域名/端口会改变浏览器存储空间，数据不会自动迁移。

## 版本镜像发布

推送与 package.json 版本一致的 `v*` 标签后，CI 自动测试并将受测镜像发布到 GHCR，使用内置 GITHUB_TOKEN，无需手工配置密钥。随后独立验证匿名拉取。当前镜像包已公开，`v0.1.0` 的匿名拉取已通过。

镜像地址：`ghcr.io/lordfoxfairy/everwoven-web`（linux/amd64）。使用 `compose.image.yaml` 可直接拉已发布版本，无需部署机编译。详见[版本发布与部署](docs/deployment/IMAGE-RELEASE.md)，首版[发布验收全部通过](https://github.com/LordFoxFairy/everwoven/actions/runs/34584227177)。

## 工程结构

```text
apps/web/             唯一 Web 应用、前端 Mock、布局与舞台组件
apps/runtime/         本机宿主、会话、应用服务与 Prisma/SQLite 适配（由同一 Next 暴露受保护 tRPC）
packages/             共享契约、供应商适配、主题等
FINAL-PRD.md          当前产品范围与验收基准
TECH-STACK-DECISIONS.md 技术裁决入口
docs/product/         页面、字段、生成质量与验收规格
docs/architecture/    技术方案、数据规范、架构/时序图与 ADR
docs/api/             API 契约（区分现有与候选接口）
docs/implementation/  实施证据与剩余门槛
docs/deployment/      部署与运维说明
```

## 产品与研发基准

- [PRD 1.9](FINAL-PRD.md) · [页面规格](docs/product/PAGE-SPEC-V1.md) · [验收矩阵](docs/product/ACCEPTANCE-V1.md)
- [技术方案 1.2](docs/architecture/TECHNICAL-SOLUTION-V1.md) · [架构/时序图册](docs/architecture/DIAGRAMS.md)
- [数据设计](docs/architecture/DATA-DESIGN.md) · [真实唯一约束登记](docs/architecture/UNIQUE-KEY-REGISTER.md)
- [API 契约](docs/api/CONTRACT.md) · [OpenAPI](docs/api/openapi.json) · [分支存档候选契约](docs/api/BRANCH-CONTRACT-DRAFT.md)
- [Provider 设计](docs/architecture/PROVIDER-DESIGN.md) · [供应商—模型映射](docs/PROVIDER-MODEL-BINDING.md)
- [成熟组件复用审计](docs/architecture/FRAMEWORK-REUSE-AUDIT-2026-09-10.md)

下一工程门槛：原角色/图片/剧本聚合完整持久化与当前单入口启用 → 明确供应商/模型/预算后的真实两轮视频验证 → 分支存档恢复。二期再接独立 AI 创作对话与工作画布，避免把创作工具塞进游玩现场。

## 源码与素材边界

中文产品名保持「未完」，仓库与工程标识定为 `everwoven`，Docker 镜像为 `everwoven-web`。当前页面仍保留旧标识，新 Logo 概念尚待确认；仓库命名不代表 Logo 定稿。保留浏览器历史存储键，避免改名导致数据丢失。旧稿与当前 PRD 冲突时，以当前 PRD 及明确的后续决策为准。

研究 ZIP、用户上传素材、本机数据库、密钥、构建缓存、历史静态原型和运行截图不随首版源码分发。第三方组件授权和示例图片来源见 [第三方说明](THIRD_PARTY_NOTICES.md)。当前仓库已公开，尚未向项目整体授予开源许可证。
