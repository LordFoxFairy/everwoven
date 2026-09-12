> 2026-09-12开发基线已重建：旧库不支持兼容启动，尚未实现受限reset命令。请先使用新的专属空目录验证，不要对现有业务目录手动执行migrate deploy或清空整个工作区；源码和凭证不属于业务清理范围。

# 本机数据库启动与验收（M0-C2/C3）

这是同一个 Web 应用的显式本机存储模式，不是第二套站点。当前支持 **剧本世界设定 CRUD**；人物、图片、分支和生成任务尚未接入正式存储。

## 1. 启动前提

- macOS/Linux、Node 22、锁定的 pnpm；Windows/Tauri 宿主待独立适配。
- 先 `pnpm install --frozen-lockfile`。正式本机模式使用 `pnpm local`，固定监听 `127.0.0.1`。默认端口 3100，只启动一份服务。
- 父目录须已经存在、由当前用户持有且无 group/other 写权限。目标目录必须是新目录，或已经成功初始化的同环境宿主。
- 拒绝目录符号链接、异常文件权限、未完成初始化、环境不匹配；不会覆盖、删除或自动修复已有目标。
- 数据目录不要放在源码、Git、网络共享或云同步盘。数据库不是备份。

## 2. 首次启用

以下只创建专用目录，不读取现有浏览器草稿：

```sh
mkdir -m 700 "$HOME/.everwoven"
pnpm runtime:host init --directory "$HOME/.everwoven/local-dev" --environment dev
APP_ENV=dev RUNTIME_DATA_DIR="$HOME/.everwoven/local-dev" pnpm local
```

父目录已经存在时无需重复 mkdir，但应检查所有权和权限。3100 已被占用时，先正常停止自己的旧开发服务，不要额外常驻两套应用。

另一个终端取得一次性连接码：

```sh
pnpm runtime:host connect --directory "$HOME/.everwoven/local-dev" --environment dev
```

打开 `http://127.0.0.1:3100/` → 我的剧本 → 本机数据库 → 粘贴连接码 → 连接。原码只显示在自己的终端，不发聊天、不截图、不存日志；有效期 5 分钟且仅兑换一次。丢失兑换响应或过期后重新签发，不重复使用旧码。会话有效期 8 小时，退出连接撤销会话。

若运行生产构建，保持宿主环境一致：

```sh
pnpm build
APP_ENV=dev RUNTIME_DATA_DIR="$HOME/.everwoven/local-dev" pnpm local --production
```

`--production` 选择 Next 生产构建，`APP_ENV` 选择数据环境；不是同一概念。prod 数据需另行显式初始化为 prod。无需手动配置 `EVERWOVEN_LOCAL_LAUNCH`，它是专用启动器的内部标记，不是公网部署开关。

## 3. 数据和失败边界

- `runtime.db`：Prisma/SQLite，16 张领域/操作表、无外键。DB 文件 0600，私有宿主目录 0700。敏感目录内有 WAL/SHM 时同样检查权限。
- `manifest.json`：最后发布的 ready 标志，包含环境和本机 owner，不含连接码。
- `security/`：短期连接码/会话的 SHA-256 文件名与期限记录，不保存原始凭证。会话能跨 Web 进程重启。
- 初始化中断后不把残留目录误认作 ready，也不自动清理锁/目录。先停止相关进程并保留残留用于检查；可选择全新的目标目录。备份/修复工具后续交付。
- 当前 owner 是本机宿主唯一身份，HTTP 请求不能提供 ownerId；不是多人账号系统。没有 against same-OS-user 恶意进程隔离保证。
- CRUD 同键重放、不同载荷冲突，更新/删除/恢复使用 revision CAS。丢失响应后先“确认上次保存/删除/恢复”，原回执确认后再保存新修改；输入和离开保护持续保留。失败不自动覆盖输入、不自动重复付费调用。
- 浏览器演练草稿与数据库草稿明确分开；没有自动导入、自动迁移或假游玩入口。

## 4. Docker 与发布

普通 `pnpm dev`、Next standalone 和 Docker 均不启用本机数据库，哪怕设 APP_ENV=dev/prod。公网 Web 鉴权与可持久化容器宿主尚未交付，不通过塞入启动标记绕过边界。

Web 已将 runtime 作为编译后的 Node 包消费，固定使用 Next webpack，显式外置宿主入口，保留 native SQLite 和运行时路径；禁止把文件系统/Prisma 打包进浏览器。Docker 源码构建先生成并编译 runtime，再构建 Web。不要把宿主数据目录或密钥带入构建上下文。

## 5. 可重复验证

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
node scripts/smoke/local-authoring.mjs
```

可指定 `PLAYWRIGHT_CHANNEL=chrome` 使用已安装的 Chrome。smoke 使用独立临时目录、临时浏览器、3198 端口，结束后只清理自己创建的数据与进程；验收登录、CRUD、删除/恢复、刷新、进程重启后读回和退出，不调用模型。用户端口 3100 不受影响。
