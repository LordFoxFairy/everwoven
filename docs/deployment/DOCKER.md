# 未完 Web 容器部署

2026-09-11 · 适用 0.1.0 原型。Docker 与本地开发运行的是同一份 Next 应用；不维护第二套产品。

## 1. 当前交付边界

镜像只启动 Web。默认 APP_ENV=demo 的前端 Mock 不请求模型；dev/prod 保留创作、禁用示例与演练入口。环境在容器启动时选择，详见 [环境配置](ENVIRONMENTS.md)。剧本/角色设定在访问者浏览器 localStorage，自定义图片在 IndexedDB。内部 Prisma/SQLite runtime 没有接到 Web 页面，因此此版**没有虚构一个数据库 volume**，也不把容器部署称作完整生成服务上线。

镜像不包含 `.env`、数据库、用户上传目录、研究 ZIP、原始附件、测试或开发服务器。采用两阶段构建、固定 Node/pnpm 版本、冻结依赖、Next standalone、非 root 用户；Compose 额外移除 Linux capabilities。

## 2. 快速运行

前提：Docker Engine 与 Compose 可正常运行，首次构建需要访问 npm 与基础镜像仓库。

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 web
```

访问 `http://127.0.0.1:3100`。默认只绑定 loopback，不直接公开到网络。

若本地开发已占用 3100，可以先停开发服务，或对这次容器运行明确选择端口：

```sh
EVERWOVEN_PORT=3200 docker compose up --build -d
```

访问 `http://127.0.0.1:3200`；默认 `APP_ORIGIN` 会同步跟随。持续使用自定义配置时，可写入根目录本地 `.env`（被 Git 与镜像忽略）：

```dotenv
APP_ENV=demo
EVERWOVEN_PORT=3200
APP_ORIGIN=http://127.0.0.1:3200
```

`EVERWOVEN_PORT` 是宿主端口，容器内固定 3000。`APP_ORIGIN` 是浏览器访问的完整来源，必须精确匹配协议、域名、端口；只接受 http/https，不含凭证、路径、查询或 fragment。`localhost` 与 `127.0.0.1` 不是同一来源。

## 3. 共享 Web / 反向代理

示例公开来源为 `https://everwoven.example.com`。在宿主机 TLS 反向代理后运行容器，设置 `APP_ORIGIN=https://everwoven.example.com`，代理必须保留公网 `Host`。若代理自身在容器中，使用独立私有容器网络连接 Web 的 3000 端口；不要把代理容器的 loopback 当成宿主机。

下例为宿主机 Nginx 的转发片段，需置于自行配置证书的 HTTPS server 块内：

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
}
```

服务端按明确的 `APP_ORIGIN` 校验请求，不依赖 `X-Forwarded-Host` 推断可信来源。来源校验不等于用户认证；共享原型应先在反向代理加访问控制。当前正式账号、服务器端用户数据隔离、计费操作均未开放；不要暴露开发模式或启用实验代理作为生产多用户后端。

HTTPS 对远程访问的浏览器安全功能也有意义。本版不把任何模型密钥注入镜像，设置密钥不会自动把 Mock 切成真实生成。

## 4. 验证，不只看首页

```sh
ORIGIN=http://127.0.0.1:3100
curl --fail "$ORIGIN/"
curl --fail "$ORIGIN/api/trpc/video.configuration"
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Origin: https://evil.example' "$ORIGIN/api/trpc/video.configuration"
```

元数据应包含 `unselected`；跨来源请求应返回 403。镜像内健康检查仅验证进程与首页可达，不代表供应商任务、数据库或来源配置已经验收。CI 会额外验证默认/自定义端口与元数据。

## 5. 数据与更新

- 容器重建不会主动清除浏览器数据；清理浏览器存储、换浏览器或更换访问来源仍可能使原数据不可见。
- Docker volume 备份不了浏览器存储。重要内容应保留原始文本/素材；不要把这个原型作为唯一备份。
- 后续 Web 真正接入 SQLite/素材目录时，新增显式持久化挂载、非 root 写权限、迁移门槛、备份/恢复与单实例约束。多副本不是直接共享一个 SQLite 文件。
- 更新：拉取经验证的版本后运行 `docker compose up --build -d`；停止：`docker compose down`。
- 回退：使用保留的已验证镜像标签重建容器；在业务数据库接入前没有随此镜像执行的数据库迁移。

## 6. 验证状态

本轮本地已检查 Compose 默认端口、自定义端口与显式公开来源配置，Next standalone 已构建。该宿主的 Docker daemon 返回错误，本地镜像构建/运行尚未验收；`.github/workflows/ci.yml` 定义 Linux Docker 构建与启动冒烟，实际结果以仓库 Actions 为准。此限制不等于已证明镜像通过。
