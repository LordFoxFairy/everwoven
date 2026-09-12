# 环境配置：同一代码、同一镜像

> **2026-09-12 实施更新：** M0-C2/C3 已接入显式本机初始化、会话和同一页面的 SQLite 世界设定 CRUD；当前契约/验收以[实施记录](../implementation/M0-C2-C3-LOCAL-AUTHORING-2026-09-12.md)为准。下方此前状态保留为阶段记录，不代表新增能力仍未接入，也不代表角色、素材、模型和分支已完成。

2026-09-11 · `APP_ENV=demo|dev|prod` 是应用环境，`NODE_ENV` 是 Next 的编译/运行模式；两者独立。

| APP_ENV | 当前开放 | 演示种子/游玩 | 数据 |
|---|---|---|---|
| demo（默认） | 本地创作与完整前端交互演练 | 前端管理示例，不调用模型 | 保留原 localStorage/IndexedDB 名称 |
| dev | 本地剧本、角色、图片创作 | 不加载示例，不允许假游玩；真实生成入口禁用 | dev 独立命名空间 |
| prod | 本地剧本、角色、图片创作 | 与 dev 同样不把尚未实现的真实链路伪装成演练 | prod 独立命名空间 |

`prod` 表示运行环境，不表示产品、认证或真实视频能力已达到生产验收。当前 dev/prod 的可用业务能力相同，差异是环境标识和数据分区；后续 API 逐项接入，不提前造第三套业务代码。

## 启动

本地开发：

```sh
# 终端变量优先；不要人为设置 NODE_ENV=demo/dev/prod。
APP_ENV=demo pnpm dev
APP_ENV=dev pnpm dev
```

或复制 `apps/web/.env.example` 到 `apps/web/.env.local` 后修改 APP_ENV。Next 默认加载应用目录的环境文件，不把仓库根 Compose .env 当作应用配置。

Docker：

```sh
APP_ENV=demo docker compose up --build -d
APP_ENV=prod docker compose up -d --force-recreate
```

首次构建后，切换 APP_ENV 只需重建容器，不重建镜像。也可从仓库根 `.env.example` 复制为 `.env` 固定 Compose 配置。`EVERWOVEN_PORT` 与 `APP_ORIGIN` 的关系见 [Docker 部署](DOCKER.md)。镜像中的 NODE_ENV 一律为 production，即使 APP_ENV 为 demo 或 dev。

APP_ENV 未设置时默认 demo；空字符串、大小写错误、未知环境（例如 staging）直接报配置错误，不静默降级。若需要 staging，先扩展枚举/存储命名/测试，不把未知字符串透传到浏览器。

## 配置与安全边界

- 服务端 Page 调用 Next `connection()` 后读取环境，仅将经过验证的环境枚举发到前端；不序列化 process.env，也不使用构建时固化的 NEXT_PUBLIC_APP_ENV。
- 浏览器没有切换环境按钮，用户提示词与 URL 参数不能修改服务端环境。环境分区是避免误混数据的工程措施，不是同来源下的权限隔离。
- demo 继续保留 `weiwan.prototype.v1` / `weiwan-assets-v1`，避免仓库改名或升级使旧内容消失；dev/prod 使用 everwoven 命名空间。切换不会复制、删除或迁移旧数据。
- 所有当前创作数据仍在浏览器，不因 prod 配置自动转入服务端 SQLite，也不会生成云备份。
- MiniMax 密钥不自动触发任务。现有实验 fal 代理要求同时满足 APP_ENV=dev、NODE_ENV=development、本机同源、显式开关和供应商选择/密钥；Docker 内仍关闭该实验代理。正式视频任务链尚未开放，不做付费测试。

## 验证

环境解析、保留旧 key、分区写入/冲突检查、非 demo 首页/广场与启动门禁、代理环境门禁均有自动化覆盖。CI 使用同一 Docker 镜像依次验证 demo/dev/prod × 默认/自定义端口，并检查页面实际输出的环境枚举；CI 结果以 Actions 为准。
