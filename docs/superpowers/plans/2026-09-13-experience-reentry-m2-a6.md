# M2-A6 已提交旅程发现与只读重入

上一轮为实码progress；1488aa5对应CI34745838317已completed/success。继续同一个原应用，不扩展成另一套CRUD。

- [x] runtime list：复用Experience索引及认证只读事务，owner/dataset限定，固定未删除未归档；updatedAt/id逆序keyset，默认20最多50，cursor限定作用域。封存故事与Binding校验在同scope内，不读当前draft/registry。返回轻量summary，不把历史CREATE状态当当前状态。
- [x] 原Host/tRPC/纯client补list契约；查询仍有来源、大小、非batch、严格输出与固定错误检查。
- [x] 原「我的游玩」正式分支读取SQLite旅程列表；只读按ID打开封存准备，不伪造DraftDTO。controller在workspace生命周期，旧pending不被覆盖，关闭回到原列表、恢复焦点。demo保持前端mock。
- [x] 冷浏览器自动连接发现已提交旅程→同封存内容/预算重入→配置缺失和原draft修改/删除仍能读取，全程新增CREATE=0。未知未提交意图不在此恢复声明内；后续Quote/Operation主线继续。
- [x] 主仓测试、实际production原页面、独立复核、文档及开发分支提交/CI（74f9eed，精确CI34746646130 completed/success）。无模型调用、不修改用户数据库。

本片主仓116文件1839测试与双端类型、production build/原UI冷浏览器/HTTP/Studio、独立复核已通过；提交和CI具体状态以PROGRESS为准，不将本片完成等同生成链闭环。
