# Tag 驱动 GHCR 发布

**Goal:** 用户推 v* 标签即可在验证成功后发布版本镜像；实际发布首版并验证公开拉取。

**Architecture:** 延用唯一 CI。verify 先校验 tag 与 package.version、跑现有测试和六种容器冒烟，再传递刚测试过的镜像 artifact。独立 publish job 使用 packages:write；普通分支/PR 没有发布任务。稳定版且仍为 main 顶端才更新 latest，预发布不更新。镜像当前明确为 linux/amd64。

**Tasks:**
- [x] 严格版本标签解析与自动化测试。
- [x] 只在版本标签触发发布，上传/下载受测镜像，不重新构建另一份。
- [x] GHCR 关联源码标签、版本/commit 标签、最小权限、匿名验证。
- [x] 增加只拉镜像的 Compose 文件与部署/版本发布文档。
- [ ] 主仓验证、推配置、创建 v0.1.0；完成首次包 Public 设置及匿名拉取检查。

首次 GHCR 包默认 private，网页未登录时需要用户完成登录；不提取浏览器凭据或把OAuth token写入文件。不得把发布成功等同于匿名可拉取。

## 发布前补充：HTTP 浏览器崩溃

用户提供远程 HTTP IP 页面崩溃证据。主仓重现 `blankStory` 调用缺失的 randomUUID；新增统一安全随机 UUID v4 兼容函数，覆盖全部前端调用，增加业务与页面回归。CI 的 HTTP 浏览器检查是发布前门禁。278 项测试、类型检查与生产构建已通过，镜像发布及匿名检查待运行。
