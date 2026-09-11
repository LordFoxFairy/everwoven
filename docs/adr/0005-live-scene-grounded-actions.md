> 2026-09-10 一期范围更新：本文早期实时会话假设不再作为首发要求；当前采用 [分段任务技术方案](../architecture/ARCHITECTURE.md) 与 [PRD](../../FINAL-PRD.md)。供应商隔离、画面证据及未来空间输入原则仍保留。

# ADR-0005：以已呈现画面为依据的行动接口

状态：Proposed；日期：2026-09-09。
范围：一期实时游玩闭环与二期物体/位置点击的共用接口设计。本文不是已交付功能清单。

## 背景

产品目标是玩家介入后实时生成后续视频。ALIBI 仅作为场景化交互参照，不采用预录分支作为正式运行机制。现有代码只有媒体会话和文本方向；缺少剧情状态、已呈现画面的语义关联及空间输入。

现有 director.ts 把 chunk 简化为 generated，未对外保留 chunk_index、prompt_version 等片段元数据；types.ts 没有世界事件或帧锚点。扩展前须补齐这些信息，而不是让 UI 猜测。

## 决策

一期做语义行动，二期加入空间输入。所有入口最终统一为 PlayerIntent，经验证后才编译成供应商支持的方向消息。前端不直接把点击坐标塞给视频模型，也不把每次点击都转换成自由文本聊天。

### 一期闭环

剧本准备 → 开始游玩并创建会话 → 世界自然展开 → 依据已呈现情境产生可选互动 → 玩家行动 → 后续视频生成 → 观察结果并更新状态。

自然展开不等于无限替玩家推进关键事件。无输入时允许环境与人物微小行动；有决定性分支时保留玩家选择权。是否能可靠维持这种节奏须真实联调，不假定提示词一定有效。

一期具备自由输入和剧情触发的语义行动，不要求视频内点击目标。交互候选来自剧情编排，但显示条件要由已呈现情境校验；计划发生的事情不等于已发生。

### 二期：将空间点击转换为带证据的意图

处理链：点击 → 对齐点击时的帧 → 映射视频内容坐标 → 识别目标 / 区域 → 解析可行动作 → 校验世界状态 → 编译方向 → 实时生成结果。

1. 物体：点击桌上的杯子，选中杯子；根据剧情提供「拿起」「查看」等动作，或允许用户描述用途。
2. 人物：点击人物确定交流对象，不必立刻打开通用输入框；人物当前行为决定是搭话、等待还是其他动作。
3. 地点：点击门口或座位表达「走过去」「坐下」等语义意图。
4. 空白或不确定目标：只显示轻量落点反馈，询问目标或允许取消，不擅自执行。

屏幕坐标不是三维世界坐标；二期不承诺真正寻路、碰撞检测或精确空间移动。摄像机转向、人物移动、玩家靠近是不同动作，需用角色身份和视角规则区分。

### 两条响应路径

- 快路径：点击立即显示选择反馈，更新本地输入状态；这只表示选中，不表示物体已经被拿起。
- 生成路径：验证后的行动进入实时生成；对应的视觉结果到达并被确认后，再提交世界事实。

目标选择通常是可撤销的；拿取、移动、关系承诺等动作根据上下文明确确认，不能一次误点就替玩家作决定。

## 帧与坐标

FrameAnchor：sessionId、streamEpoch、localFrameId、mediaTime、可选 rtpTimestamp、videoWidth、videoHeight、sceneRevision、可选 providerChunkId / promptVersion。

浏览器可使用 requestVideoFrameCallback 记录提交给合成器的帧元数据；这不是绝对精确的显示同步保证。回调、点击与抽帧可能存在一帧或更多偏差，必须有时间误差容限。WebRTC 可选元数据应做能力检测。

点击应绑定当时画面的帧证据，不能拿「服务器刚生成的最新帧」识别目标。多端、断线重连后新建 streamEpoch，防止时间戳复用串场。

对于居中 object-fit: contain：
- s = min(containerWidth/videoWidth, containerHeight/videoHeight)
- contentWidth = videoWidth*s，contentHeight = videoHeight*s
- offsetX = (containerWidth-contentWidth)/2，offsetY = (containerHeight-contentHeight)/2
- u = (clientX-rect.left-offsetX)/contentWidth
- v = (clientY-rect.top-offsetY)/contentHeight

仅接受 u/v 位于 [0,1] 的视频内容点击；黑边点击忽略。实现需统一 CSS 像素坐标，不重复乘 devicePixelRatio。cover、object-position、镜像或 CSS transform 必须采用对应逆变换；先不支持的变换直接禁用空间点击。

## 视觉理解与对象身份

二期先按点击触发单帧定位，再增量实现少量关键对象跟踪；不在一期部署每帧全场景理解。

候选：视觉语言模型负责语义定位；SAM 2 类分割/跟踪负责轮廓与跨帧传播。SAM 2 不是游戏规则、物体语义或三维定位器，不能单独完成整个链路。具体速度、GPU、费用与 Tauri WebView 兼容性须单独实测。

EntityId（剧情实体）与 TrackId（当前视觉轨迹）分开。杯子遮挡、镜头切换、生成后外观变化时，旧 track 失效；重新识别不能默认仍为同一杯子。低置信度先确认，错误行动比少一次热点更糟。

持续热点不是永久 DOM 坐标：需要带帧时效的 mask/bbox 更新，镜头切换和跟踪过期立即隐藏。先做到「点后识别可靠」，再做「悬停即高亮」。

## 统一契约（拟议，尚未实现）

PlayerIntent：
- intentId / sessionId / sceneRevision；
- source: text | contextual-action | point；
- target: entity | region | none；
- point 输入携带 FrameAnchor 与归一化坐标；
- action: inspect | speak | take | approach | custom；
- userText 可选，preserveUserAgency 为运行时规则而非模型自我保证。

Runtime 数据分层：planned（导演计划）、observed（画面证据）、committed（校验后的事实）。事件结构通过 schema 白名单校验；模型文本不是可执行 UI 或任意工具调用。

Provider 能力分开声明：媒体输出、文本方向、首帧输入、逐次图像方向、原生空间控制、取消、时间映射。当前 H3 Director 适配器仅启用已实现的音视频输出和文本方向；没有原生 point 控制，空间意图应编译为语义方向，不假造 x/y API。

## 存储和隐私

Prisma/PostgreSQL 规划持久化会话、意图、世界事件与引用；高频帧/轮廓不逐条写入业务数据库。帧证据使用有界内存缓存，确需保留时走受控对象存储与清理策略。发送到视觉服务前明确用途，避免将整段私人剧情默认上传给额外供应商。

## 后果

收益：一套意图管线兼容文本、情境卡片、物体与位置点击；后续换视频或视觉 provider 不重写游戏规则。
成本：增加时间同步、视觉服务、过期处理与结果校验；对生成模型服从性和视觉误识别都需要评估。
限制：先不承诺三维引擎能力、跨镜头无误识别或每个像素都可交互。

## 备选方案

- 直接发送坐标给 H3：当前已核对接口没有通用 point 消息，排除。
- 提前手画热点：可用于明确标识的设计测试，不作为实时生成场景的正式实现。
- 每帧调用大模型理解：延迟、成本与噪声难控，不作为首发策略。

## 验收

一期：非固定剧情条件下连续完成三次改变方向；行动不会在对应场景呈现前上屏；拒绝旧建议仍可继续；失败、等待和结束状态真实。
二期：不同缩放/比例点击同一目标一致；黑边不触发；镜头切换旧热点撤下；目标遮挡/重复物体先消歧；网络延迟下不执行过期动作；选择反馈不冒充视频已改变。

指标分开记录：点击反馈耗时、目标解析耗时、输入确认耗时、动作到视频变化耗时、目标误识别率、过期命中率和单次行动成本。先测基线，再设置发布阈值。

## 来源

- fal Director API：https://fal.ai/models/minimax/h3-max/director/api
- 浏览器帧回调：https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- SAM 2 官方代码：https://github.com/facebookresearch/sam2

以上是能力依据，不代表项目已经接入 SAM 2 或通过真实端到端验证。
