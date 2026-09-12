# M1-C2 · 原图片控件接入（执行前置计划，尚未落地）

前置：C1c生命周期与真实Host/HTTP验收。保留一个3100入口、原角色库和原剧本编辑器，不新建上传管理页。此计划记录从当前源码实读得到的缺口，不表示已完成UI。

## 当前代码与替换位置

- `story-assets.tsx` 的useImageAsset/ImageAssetPicker直接依赖浏览器readImageAsset/importImageAsset，任何读取错误都变成missing；此实现只适合演练。
- 原正式CharacterLibrary的Cards和编辑栏仍为头像待接入占位；原Editor有formal禁用图片分支，禁止借演练IndexedDB“先显示成功”。
- 当前角色来源使用CharacterSource保存templateId/revision/datasetId/portraitAssetId；图片接入必须继续保留跨dataset清来源规则，不能将旧引用附带到新库。

## 端口与状态

- 公共展示/选择组件依赖AssetClient，不直接判断环境、取Prisma或import浏览器数据库。组合入口选DemoAdapter或正式HTTPAdapter；失连不切换策略。
- DemoAdapter继续前端管理，正式Adapter使用资产契约+相同session/dataset；token永不写URL，图片URL只包含assetId/datasetId，同源cookie认证。
- 正式读取走fetch→检查status/固定mime→blobURL，卸载/替换/世代切换时revoke；不将404、401、网络失败、正在读取混为“没有图片”。不重试副作用型命令。
- 上传状态采用idle / validating / beginning / sending / completing / unknown / ready / rejected。命令begin和complete分别稳定commandId及payload；未确认时只确认原命令，不生成新ID造成重复资产。
- 文件输入先检查大小/类型/基本尺寸作用户反馈，服务端仍是真值；客户端计算原hash，发送原始字节，不能悄悄先压缩后仍使用原hash。
- 上传成功只更新表单选中assetId并标dirty，保存角色/剧本另行提交。清除只解除选择，不删图片实体或文件。
- 选新图与正在进行的上传互斥；网络回调绑定控件epoch、owner/dataset及操作ID，旧完成不得覆盖新选择/跨库表单。
- 本期未确认命令只保留在当前页面内存，硬关浏览器草稿恢复不冒充已实现。

## 交互要求

- 保留原浅蓝/紫天空主题和组件尺寸，图片就地预览、处理状态、具体错误、重试/确认操作，不新增大状态面板。
- 必须独立确认图片权利声明，不默认声称已验证版权；仅保存用户声明。说明图片保存在本机服务、后续模型调用另行发生。
- 正式头像已有引用时立刻读真实资产，失败显示明确重试，不用演练人像或首字母伪装读取成功。
- 不硬编码“H3支持/H3Max不支持”的未验证文案到通用图片组件；素材用途与模型能力分离，在生成准备页依据已核对provider能力限制。
- 连接失效保留文本和待确认命令，恢复仍需同dataset；新dataset只允许显式保留文本新建，清旧asset/source。

## 接受标准（全部待验证）

- [ ] 原角色页选择真实图片→上传完成→保存portraitAssetId→清浏览器业务缓存→服务进程重启→同图片读回。
- [ ] 更换与清除头像不影响原图片和其他角色；角色软删除/恢复后引用一致。
- [ ] 非法/过大/损坏图片、401/404/413/409/超时/断网有可操作反馈，不报假成功。
- [ ] begin和complete分别模拟提交成功丢响应，同原命令重放后1个意图/1个资产，无重复创建。
- [ ] 快速点击/卸载/切换角色/连接失效/跨dataset旧响应不会覆盖新表单。
- [ ] 演练零正式网络写入；正式禁浏览器存储后依然成功。
- [ ] 原剧本聚合在独立用例接通后才启用正式图片槽保存；未保存引用不进入生成。
- [ ] 主仓全量、typecheck、生产Chrome及规格/质量复核通过，更新PROGRESS后继续聚合/单入口验收。

## C2执行接口冻结（源码复核后的增量）

C1c-3 HTTP已通过本轮1202项与生产浏览器，最终修正smoke撤销证据后进入本批。采用两个不重叠写集：Feynman端口/传输/上传状态机/读取hook；Hegel原控件/角色/Editor组合，主会话维护docs/生产smoke/CI。实现者先发送/读取同一个纯类型接口，再开始依赖写入，禁止两边各发明协议。

- AssetRef严格判别：`{kind:'demo',id}` 或 `{kind:'formal',datasetId,id}`，null为空；不以裸ID推断来源。
- AssetClient同样判别：demo只本地import/read，formal只begin/getUpload/process/complete/read。正式读取fetch→校验HTTP/mime→Blob，组件hook持有URL并按失连/卸载/替换回收。初期无全局资产内容缓存。
- 单一纯协议模块存dataset header，直接改server引用，客户端不导入server代码，无兼容re-export。
- Controller绑定client/连接/dataset/失效callback/编辑实例，start(file,rights)、confirm、retry、subscribe/getSnapshot/suspend。同帧锁与pending先于异步；begin/complete各冻结唯一命令，未确认只重放原命令；PUT未知先getUpload，不重建意图。begin历史响应后读取当前意图再推进。
- 控制器活在编辑容器，配置页切换不丢命令；新建首次确认ID不切编辑实例。跨session/dataset/编辑实例的迟到回调不改新表单；普通退出挡住busy/unknown，硬关闭恢复本期不声称实现。
- 原正式角色controller提供专用portrait选择入口并核对dataset。当前选择与CharacterSource不可变来源快照分离，换图→另存角色使用当前选择，不被旧source覆盖。
- 权利checkbox默认未选，确认后才发送begin；上传完成只更新表单/dirty，清除仅解除引用。明确失败/unknown恢复操作，错误不是全部“图片缺失”。缩略图读取使用有界调度，避免一页同时耗尽服务端两槽。
- 原剧本正式封面/开场保存仍等聚合接口；可先贯通角色头像和另存角色，禁止在本片让原草稿伪保存正式assetId。

主会话维护原角色生产smoke及新UI用例，原测试的“正式file input为0”在真实控件启用后更新为实际上传断言，而非直接删除断言。每个writer先RED测试，再实现；主仓及独立两阶段review后才能记此批验收。
