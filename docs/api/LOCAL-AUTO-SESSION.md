# 本地自动会话 · 2026-09-13

用户路径：启动本地应用 → 打开原页面 → 自动连接 → 直接创作。无连接码字段、无终端取码步骤，无后端演练回退。此变更仅移除本地交互门槛，不宣称视频生成闭环。

## 传输

同一 `/api/local-session`：

- GET：只查询cookie身份，返回 `{authenticated:false}` 或 `{authenticated:true,datasetId}`；不签发会话。
- POST `{mode:"local"}`：自动连接。已有有效cookie直接复用；否则由服务端内部签发/兑换本地凭据，返回 `{authenticated:true,datasetId,expiresAt}` 与HttpOnly/SameSite=Strict cookie，JSON无token/code/owner/path。
- DELETE：撤销当前cookie身份；自动连接不会自动重放角色/图片/剧本命令。
- POST `{code}`：仅显式CLI/HTTP维护工具继续使用，产品UI不调用。mode与code混用、额外字段、不认识的mode都拒绝。

## 访问边界

仅localRuntimeConfig有效的专用loopback启动器：APP_ENV dev/prod，绝对私有目录，固定127.0.0.1 origin。POST须精确Host/Origin、x-everwoven-request:1；自动模式额外要求Sec-Fetch-Site:same-origin。跨站、same-site、无来源元信息、表单POST均不自动获得会话。普通Web/Docker/demo不开启这个接口能力。

响应no-store/nosniff；宿主保留目录/owner/dataset/凭据期限验证。专用启动器对文档发送X-Frame-Options:DENY与CSP frame-ancestors 'none'，避免第三方页面嵌入自动连接后的工作区。可信同源脚本与同OS用户属于本地信任边界，不将Origin校验称作公网账号鉴权。

## 前端恢复

首次连接只尝试一次；失败停留明确错误状态，由用户轻量重试，不循环创建会话。连接处理与业务命令处理分离；已有unknown及跨dataset保护保持不变。演示模式不访问宿主，未配置状态不假装空库，连接变化不卸载编辑器或丢弃草稿。

## 验收

真实SQLite自动连接、既有cookie复用、跨站/缺header/错mode拒绝、普通启动隔离、无JSON秘密、GET只读；真实Chrome无需输入码直接完成原角色/图片/剧本链路，冷浏览器自动恢复。通过状态以PROGRESS实际记录为准。

### 完整用户路径与失败分流

| 阶段 | 真实行为 | 失败时 |
|---|---|---|
| 打开应用 | GET已有会话；无会话时同源POST自动建立 | 就地提示连接失败，保留页面与未保存文本 |
| 角色/图片/剧本编辑 | 复用共享会话调用原受保护端口 | 不切demo，不用localStorage冒充保存 |
| 保存回执不确定 | 保留commandId、请求内容及后续编辑 | 显式核对原结果；连接恢复不自动重发业务 |
| 刷新/新浏览器 | 有cookie复用；新浏览器自动建立后读原SQLite | 不从浏览器演练库灌入正式库 |
| 宿主重启 | 私有目录和dataset不变，会话按有效期验证 | 正在保存的响应丢失仍按unknown处理 |
| 更换数据集 | 后端校验dataset，前端保持既有跨库保护 | 保留文字，不让旧实体/资产ID写进新库 |

仅首次本地宿主初始化涉及开发者部署步骤；普通创作不需要在终端取码。此协议不开放公网多用户身份，也不代替尚未实现的模型生成任务会话。
