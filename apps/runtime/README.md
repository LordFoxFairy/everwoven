# Runtime · M0-A/B内部文件库与剧本根切片

当前是**内部数据库基础设施与独立检查入口**，不是已经对Web开放的后端。没有HTTP监听、身份签发、Provider任务或自动迁移；47项正式API仍未实现。

## 已落地

**M0-B新增：**内部剧本根create/get/list/update/delete/restore、严格契约、IdFactory/Clock、CAS/回执与分页；28项新文件库测试。详见[内部契约](../../docs/api/INTERNAL-STORY-DRAFTS-M0-B.md)及[M0-B记录](../../docs/implementation/M0-B-STORY-CRUD-2026-09-10.md)。不开放HTTP，不初始化宿主身份、不绑定人物/素材，不接Web数据。

- Prisma7.10.0 + better-sqlite3适配，SQLite实际版本在启动时读取；现有文件路径显式传入。
- 15模型初始迁移、13项真实唯一、零外键/触发器；生成SQL与审核基线一致。
- WAL/FULL、连接配置、迁移完成状态、基础结构检查；失败关闭连接。
- WriteGate在同一交互事务中先写身份行，再进入业务回调。
- 内部renameStory切片：owner/删除状态/CAS、业务+回执原子提交、重放先于旧revision判断。**不是公开updateStory接口**，不承诺已覆盖其完整字段/版本冻结/引用校验。
- 14项真实文件库测试，包括独立连接竞争、断开重开、JSON/Date/BigInt、回滚、幂等、真实唯一、启动拒绝与独立进程检查。

业务代码仍只允许未来已鉴权的应用用例进入仓库。工厂导出的Prisma client是内部基础设施，不给前端/模型工具使用；测试中的直接写入用于准备数据或注入故障，不是绕过WriteGate的业务入口。

## 开发命令（项目根目录）

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

根脚本已经包含runtime，不仅检查旧Web；生成的Prisma客户端、dist及数据库文件不进Git。Node固定22.22.2，类型22.19.21；原Web已安装版本保持不升级，移除latest范围。

### 一次性临时文件库验证

只用于新建临时目录，不指向用户存档。显式创建空文件采用排他模式，已经存在就失败，不覆盖原文件。当前本机Prisma7.10.0的migrate deploy在不存在的SQLite文件上会返回无详细原因的Schema engine error；先显式创建空文件后部署成功，此差异已留在切片记录，尚未作为正式安装流程交付。

```sh
DATA_DIR="$(mktemp -d)"
DB_PATH="$DATA_DIR/runtime.db"
DB_PATH="$DB_PATH" node --input-type=module -e 'import {openSync,closeSync} from "node:fs"; closeSync(openSync(process.env.DB_PATH,"wx",0o600));'
RUNTIME_DATABASE_URL="file:$DB_PATH" pnpm --filter runtime db:migrate
pnpm runtime:check --check "$DB_PATH"
# 编译产物同样可独立运行（先完成pnpm build）
node apps/runtime/dist/main.js --check "$DB_PATH"
```

检查输出只含数据库版本/模式及未监听HTTP的状态，不含路径、SQL或业务记录。开始检查不写profile、不修改剧情/费用；会初始化连接pragma并将已迁移库设为WAL，因此不是任意SQLite文件的通用只读查看器。

重新生成迁移时，为CLI提供明确的临时datasource，使用`migrate diff --from-empty --to-schema prisma/schema.prisma --script`，检查生成SQL非空和约束，不运行db push/reset。初始化迁移已应用后不编辑历史文件；后续用新迁移。

## 尚未完成的M0部分

单runtime实例租约、受控数据目录/完整schema漂移检查、宿主对应用IdFactory/Clock的统一装配、Typed API client与请求/响应校验、HTTP身份/Origin/CSRF、安装/升级/备份恢复与故障演练。这里的启动结构检查不是完整磁盘一致性或备份校验。

M0-B已有内部剧本根CRUD，M1才接正式剧本/角色/图片接口与页面；M2以后才付费任务；Web/Tauri界面暂未改用本数据库。详细证据与下一切片见[实施记录](../../docs/implementation/M0-A-2026-09-10.md)。
