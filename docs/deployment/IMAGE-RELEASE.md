# Tag 驱动镜像发布

## 发布规则

- 普通分支 push、PR、手动 workflow_dispatch：只验证，不发布。
- 推送 `vMAJOR.MINOR.PATCH`（可带 `-rc.1` 等预发布后缀）：版本必须与根 package.json 完全一致，否则拒绝发布。
- 完成全部测试、类型检查、构建、三环境×两端口冒烟及 HTTP 浏览器交互检查后，传递**刚测试过的同一份镜像**到独立发布 job，不重新构建另一份。
- 自动发布 `ghcr.io/lordfoxfairy/everwoven-web:版本号` 与 `sha-完整提交SHA`。
- 只有稳定版且该提交仍为远端 main 顶端时更新 `latest`。预发布、旧提交补打标签不覆盖 latest。
- 当前已验证平台为 **linux/amd64**；ARM 主机需启用相应模拟支持。多架构原生镜像留待各架构独立测试后加入，不虚称已覆盖。
- 不强推/移动已发布的 Git 标签；修复应递增版本。部署推荐固定版本或 digest，而不是依赖移动的 latest。工作流重跑可以重新推送同版本镜像，版本标签并非仓库层面的强制不可变保证。

## 自动 Token 与权限

无需手工在 Settings → Secrets 添加镜像密码。CI 使用 GitHub 自动生成的 `secrets.GITHUB_TOKEN` 登录 GHCR，发布 job 单独声明 `packages: write`；verify 只读，PR 不执行发布。Token 仅传入登录步骤并经 stdin 输入，不写入源码。Docker 登录配置保存在 runner 临时目录，结束时退出登录。

源码关联通过 OCI source/revision 标签记录。上传到工作流的受测镜像 artifact 只保留1天；它是交接文件，正式镜像由 GHCR 保存。

## 创建版本

确认 package.json 的 version 已更新并通过评审，将该提交合入 main。以首版为例：

```sh
git tag -a v0.1.0 -m "Everwoven 0.1.0"
git push origin v0.1.0
```

以后发布改用相应新版本，不删除或重打已有标签。`gh run list` / `gh run watch` 可以从本地查看发布进度；本地 gh 凭据与 CI 的 GITHUB_TOKEN 是不同凭据，CI 不依赖本地保存的密钥。

## 首次公开设置与验收

GitHub 规定个人账户首次创建的 GHCR 包默认私有，仓库 Public 不会自动把它变成 Public。首次发布后在 Package settings → Change visibility 设为 Public。以后同一镜像包的新版本延续可见性，无需逐版本设置。

工作流末尾用**无登录、无 Token 的独立 runner**拉取镜像。匿名拉取失败会明确使该 job 失败，不把“上传成功”冒充“公开可部署”。完成首次 Public 设置后重跑失败的 job 即可，无需重打版本标签。

参考：[GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)、[包可见性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)。首次发布和匿名验收状态以实际 Actions 记录为准。

## 只拉镜像部署

首版镜像发布且匿名检查通过后：

```sh
docker pull ghcr.io/lordfoxfairy/everwoven-web:0.1.0
APP_ENV=demo docker compose -f compose.image.yaml up -d
```

仓库中的 compose.image.yaml 不含 build，也不会在部署机编译源码。与 compose.yaml 是同一应用的两种部署输入，不应同时启动同名服务。首次可仅下载 compose.image.yaml；以后的升级可设置 IMAGE_TAG 为已发布的新版本。环境、端口与来源配置继续使用 APP_ENV、EVERWOVEN_PORT、APP_ORIGIN。

当前仍是前端演练/本地创作产品，prod 环境并不意味着真实视频服务已经上线。浏览器数据及后续SQLite持久化边界见 [环境说明](ENVIRONMENTS.md) 和 [Docker 部署](DOCKER.md)。

## HTTP 开发地址回归

内容实体 ID 统一走 `createEntityId()`：原生 `crypto.randomUUID()` 可用时优先调用，否则用 `crypto.getRandomValues()` 生成 UUID v4，不使用 Math.random。覆盖新建剧本、角色、图片、存档、回合与记忆，不改动服务端认证或 ID 规则。

CI 在真实 Chromium 中将 `everwoven.test` 解析到测试容器，显式断言 `isSecureContext === false`、`randomUUID` 缺失；验证首页、新建剧本、角色创建与刷新后持久化，且没有页面 JavaScript 异常。此检查针对 HTTP 开发部署兼容性；正式部署仍应配置 HTTPS，其他需要安全上下文的浏览器能力不因此自动可用。
