# UI 源码维护

2026-09-11 从 shadcn/ui 官方 new-york-v4 registry 引入：

- https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json
- https://ui.shadcn.com/r/styles/new-york-v4/button.json

原代码 MIT 授权保留在 [LICENSE.md](LICENSE.md)。当前是手动审阅的源码拷贝，不是未修改的官方组件或完整 shadcn 套件。

本项目修改：utility class 映射为局部 CSS Modules 与既有晴空主题；Button 仅保留当前使用的 default/outline 与 default/sm；AlertDialogContent 支持明确 portal container，null 时不回退 body，以便舞台系统全屏；保留官方组件组合与 Radix 模态能力。业务确认回调与草稿保护放在 StageConfirmation，不进通用组件。

依赖精确版本见 apps/web/package.json 和根锁文件。components.json 记录别名/来源约定，不应使用 CLI 覆盖本地样式修改。升级时比较官方源码，保留 MIT，重跑 DOM、全屏、键盘、焦点、窄屏和草稿测试。不要同时引入另一套同义 primitive。
