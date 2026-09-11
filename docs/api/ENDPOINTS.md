# API接口清单

由build_contract.py生成；全量机器定义见[OpenAPI](openapi.json)，语义见[契约](CONTRACT.md)。阶段是实施安排，不表示接口已存在。

| 方法 | 路径（前缀 /api/v1） | 操作 | 阶段 |
|---|---|---|---|
| POST | `/session/exchange` | 用一次性本机启动材料建立会话 | M0 |
| GET | `/session` | 读取会话与CSRF材料 | M0 |
| GET | `/commands/{commandId}` | 查询已接受命令，不再次执行 | M1 |
| GET | `/stories` | 分页读取stories | M1 |
| POST | `/stories` | 创建Story | M1 |
| GET | `/stories/{id}` | 读取Story | M1 |
| PATCH | `/stories/{id}` | 修改Story | M1 |
| DELETE | `/stories/{id}` | 逻辑删除Story | M1 |
| POST | `/stories/{id}/restore` | 恢复Story | M1 |
| POST | `/stories/{id}/versions` | 冻结当前修订或复用既有版本 | M1 |
| GET | `/story-versions/{id}` | 读取不可变版本 | M1 |
| GET | `/characters` | 分页读取characters | M1 |
| POST | `/characters` | 创建Character | M1 |
| GET | `/characters/{id}` | 读取Character | M1 |
| PATCH | `/characters/{id}` | 修改Character | M1 |
| DELETE | `/characters/{id}` | 逻辑删除Character | M1 |
| POST | `/characters/{id}/restore` | 恢复Character | M1 |
| POST | `/characters/{id}/versions` | 冻结当前修订或复用既有版本 | M1 |
| GET | `/character-versions/{id}` | 读取不可变版本 | M1 |
| GET | `/assets` | 分页读取素材 | M1 |
| POST | `/assets` | 导入本机图片，不自动发送给模型 | M1 |
| GET | `/assets/{id}` | 读取素材元数据 | M1 |
| DELETE | `/assets/{id}` | 隐藏素材并禁止新引用；历史媒体保留 | M1 |
| POST | `/assets/{id}/restore` | 恢复尚未进入回收的素材 | M1 |
| GET | `/assets/{id}/content` | 读取受权媒体字节，支持单Range | M1 |
| GET | `/provider-models` | 查询已登记的供应商和精确模型能力 | M1 |
| GET | `/provider-bindings` | 读取供应商模型绑定版本 | M1 |
| POST | `/provider-bindings` | 按已登记模型创建绑定版本，不接受任意端点或密钥 | M1 |
| GET | `/experiences` | 分页读取独立经历 | M1 |
| POST | `/experiences` | 从固定设定创建经历；零模型调用 | M1 |
| GET | `/experiences/{id}` | 权威快照与同一数据库版本的事件cursor | M1 |
| DELETE | `/experiences/{id}` | 仅已暂停经历可逻辑删除，继续核对在途任务 | M2 |
| POST | `/experiences/{id}/restore` | 恢复为暂停态，不恢复生成 | M2 |
| POST | `/experiences/{id}/control-lease` | 获取/续租/显式接管控制权 | M2 |
| POST | `/experiences/{id}/quotes` | 确定性费用上界和素材告知；不调用模型 | M2 |
| POST | `/experiences/{id}/start` | 明确费用确认后开始开场 | M2 |
| POST | `/experiences/{id}/intents` | 片段结束后消费一个有效回应节点 | M3 |
| PUT | `/experiences/{id}/response-draft` | 独立草稿CAS；不消费节点、不生成 | M1 |
| POST | `/experiences/{id}/interactions/{interactionId}/suggestions/retry` | 只从已持久提案重试本地建议解析；不新增模型调用 | M3 |
| POST | `/experiences/{id}/pause` | 原子保存草稿并阻止新增生成 | M2 |
| POST | `/experiences/{id}/resume` | 恢复控制与待处理工作，不重提未知任务 | M2 |
| POST | `/experiences/{id}/turns/{turnId}/retry` | 恢复原回合；新付费尝试需新的有效报价 | M2 |
| GET | `/operations/{id}` | 读取任务/费用；所属经历删除后仍可核对 | M2 |
| POST | `/operations/{id}/reconcile` | 仅查询/核对既有操作，不创建新视频 | M2 |
| POST | `/experiences/{id}/playback-instances` | 取得当前片段播放实例，旧实例失效 | M3 |
| POST | `/experiences/{id}/playback` | 序号幂等播放进度；完成证据不是直接写事实 | M3 |
| GET | `/experiences/{id}/events` | 可重放领域事件；不传视频帧 | M2 |
