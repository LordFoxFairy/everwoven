# 环境配置与首版 GitHub 交付

**Goal:** 按用户确认通过 APP_ENV 切换 demo/dev/prod，同一 Docker 镜像，验证后推送私有 everwoven 仓库。

**Architecture:** Next 动态服务端页面读取 APP_ENV 并仅下发公开枚举；NODE_ENV 仍归 Next 构建工具所有。demo 保持前端 Mock；dev/prod 只开放现有本机创作功能，正式模型闭环未接通时不假装可游玩。业务存储按环境分区，demo 保留原 key。任何付费代理仍需显式 dev/本机/现有开关/密钥，不因环境单独放行。

**Tech Stack:** 既有 Next/T3、React Context、Vitest/Testing Library、Compose、GitHub Actions。无新依赖、无用户数据迁移、无 Logo 重设计。

- [x] 环境解析、存储分区与非演示 UI 门禁反例。
- [x] 服务端运行时配置、前端模式与存储实现；保持前端 Mock 管理。
- [x] Compose env、CI 三环境同镜像验证与部署文档。
- [x] 主仓 tests/typecheck/build；生产产物运行与浏览器演练/非演示走查。
- [x] 只读发布复查；白名单首提交、创建私有仓库、推 main。
- [ ] 远端哈希/私有状态与 CI 结果核对，报告实际剩余边界。
