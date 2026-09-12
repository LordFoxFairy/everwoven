# M0-C2/C3 · 本机世界设定保存闭环

2026-09-12，承接 [C1 事务存储端口](M0-C1-STORY-STORE-2026-09-12.md)。这是正式存储的第一个可用垂直切片，不是完整视频产品或多用户服务完成。

## 已实现

1. **Host 初始化**：独占锁、原子 mkdir 预留、既有 Prisma migration、唯一 LocalProfile，ready manifest 最后写入。重复初始化只验证，不覆盖已有数据。检查所有权、权限、链接与目录身份，失败不自动删目录。
2. **本机连接**：显式 CLI 生成 5 分钟一次性连接码；原子兑换为 8 小时 HttpOnly 会话；凭证原文不落盘，hash 文件名；退出撤销、重启保持会话有效性。
3. **单一入口**：`pnpm local` 固定 loopback。没有第二个 Fastify 服务；普通开发/standalone/Docker 正式存储关闭。APP_ENV 并非公众数据库开关。
4. **受保护 tRPC**：六个 storyDrafts 操作；owner 从宿主导出；严格 Origin/Host/自定义请求头；字节级请求上限、统一错误映射。
5. **同页草稿**：我的剧本中的本机数据库面板；创建/更新/回收/恢复/分页；未保存输入保护、稳定重试键、防重复点击与 revision 冲突处理。旧浏览器草稿仍存在，不自动迁移。
6. **部署回归基础**：runtime 先编译再供 Web 消费；Next webpack 显式外置 Node host，避免 workspace symlink 导致 native/文件系统包被打包。Docker 构建同步编译 runtime；CI 增加真实本机浏览器重启测试。

## 设计模式对应实际边界

| 需求 | 已用方法 | 刻意不做 |
|---|---|---|
| 换存储不改用例 | StoryDraftStore 端口 + Prisma Adapter | 万能泛型 Repository / 多套 CRUD |
| UI 测试和运输解耦 | DatabaseDraftsClient 注入 + tRPC adapter | UI 直接读 Prisma 或调用文件系统 |
| 重试不重复写 | 原子命令回执 + 指纹校验 | 用禁用按钮代替服务端幂等 |
| 多窗口不丢修改 | revision CAS | 后写无条件覆盖 |
| 身份可信 | Host 提供 owner、短期会话 | 接受前端 ownerId 或静态硬编码 token |
| 安全启动 | 显式 Composition/launcher | 只信环境名或 Host 即视作本机 |

[当前契约、架构图与时序图](../api/LOCAL-AUTHORING-M0-C.md) · [启动和运维边界](../deployment/LOCAL-HOST.md) · [范围规格](../superpowers/specs/2026-09-12-local-authoring-vertical-design.md)。

## 验收记录

- 主仓最终复核：**361/361 测试、runtime/Web 类型检查、Next 生产构建均通过**。
- 真实浏览器：已通过一次性登录、SQLite 创建/更新/删除/恢复、刷新、停止并重新启动生产 Web 进程后读回、退出。Chrome，隔离临时宿主与 3198 端口；另通过真实 API 已提交后人为丢失 create/update 响应的验收：确认原回执、新输入保留、不重复创建、不错误解除保存保护。无模型调用、无用户数据写入。
- 实际监听：lsof 确认仅 `127.0.0.1:3198`，不是 `*`。
- 旧演示回归：standalone 在非安全 HTTP 域名 `everwoven.test:3199` 下通过首页、剧本编辑、角色创建及刷新保存，无 JS 错误；未启用的正式 API 返回 401。
- 本机 Docker daemon 当前返回 500，**本轮 Docker 镜像未完成构建/运行验收**；CI 已安排对应验证，不发布新 tag，不把 v0.1.0 镜像当成本切片。
- 安全独立复核已关闭初始化、loopback 和 sidecar 竞态问题；900 次认证＋540 次读库并发零失败，且仍拒绝不安全替换。UI 复核发现的三项均已补回归并经独立复审关闭，无剩余阻塞项；主仓另完成全量及生产浏览器验证。

## 评审修正

- 响应丢失独立建模为 unknown，按原命令确认后再保存新输入；确认时遭权限/代理拒绝不误判历史提交失败。
- 未修改的规则数组按原结构保留，不因标题编辑拆分单条规则中的换行。
- 可消失 SQLite sidecar 专用有界复核，正常关闭连接不制造虚假登出；凭证文件不放宽。
- 表单使用稳定可访问命名；回收草稿读取显式 includeDeleted=true；宿主入口保持外置 Node 模块。

## 尚未闭环的产品链路

角色与图片正式落库 → 开局冻结版本 → 供应商/模型明确绑定 → 预算确认 → 视频任务提交/轮询/失败恢复 → 媒体验收播放 → 动态建议/自由回复 → 下一幕 → 分支存档/备份。

当前只完成上述第一步中的**剧本世界设定**。真实生成仍待准确模型能力、凭证和付费验收；不自动换供应商，不用静态图冒充生成成功。备份恢复、过期凭证维护、Windows/Tauri、云端多人安全和 worker 均有独立后续门槛。
