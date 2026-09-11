# Everwoven 首版环境与发布验证

中文名「未完」，工程/仓库 everwoven，0.1.0。用户明确授权完成后推送私有 GitHub 仓库。

## 当前验证

- 主仓 `pnpm test && pnpm typecheck && pnpm build` 退出0：26个文件、263项测试通过；Web/runtime类型检查与构建通过。
- 同一 Next standalone 构建产物分别以 APP_ENV=demo/dev/prod 启动，三种页面环境枚举及只读供应商配置检查通过。测试进程不作为第二套应用维护。
- Compose prod+3200解析验证环境、端口与APP_ORIGIN一致。
- 独立Chromium实测prod无演示广场，保留剧本编辑；无付费调用。浏览器记录一个现有favicon.ico缺失404，新Logo及浏览器图标未定稿，不将其掩盖成全部视觉验收通过。
- 独立只读代码审查未发现所查环境/存储/代理门禁范围内的P1/P2。发布清单审查未发现真实凭证或用户资料；本地主仓再次扫描暂存清单。
- 本机Docker daemon未正常工作，Linux镜像构建/启动仍以GitHub Actions实际结果为准，不以本机standalone测试替代容器验证。

## 不随发布升级的能力

prod仅代表环境，不代表正式生成服务上线。浏览器数据仍在本机；内部SQLite未接UI，认证/正式任务/预算/存档树/桌面包待后续实施。Logo候选未自动替换。

源码提交不包含env私有值、数据库文件、用户上传、研究ZIP、构建缓存或本地截图；保留必要Prisma迁移/测试SQL、项目原有AI参考图片及第三方授权说明。历史研究原稿留在本机，未清除用户文件。
