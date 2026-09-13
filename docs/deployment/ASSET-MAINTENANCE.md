# 本机图片残留维护

状态：当前开发分支已通过本地验收与两阶段审查，精确CI见PROGRESS；不是已发布v0.1.0镜像的功能。用于失败/过期上传意图的残留清理，不删除已确认资产或剧本引用。

## 先预览

对已初始化的专属宿主操作，环境必须匹配。不要使用源码目录、任意下载目录或旧基线库。

```sh
DATA_DIR="$HOME/.everwoven/local-dev"
DATASET_ID="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).datasetId)' "$DATA_DIR/manifest.json")"

pnpm runtime:host connect --directory "$DATA_DIR" --environment dev |
  pnpm runtime:host maintain-assets --directory "$DATA_DIR" --environment dev \
    --dataset "$DATASET_ID" --limit 25
```

连接码直接进入下一进程stdin，不放命令参数、不写文件；不要开启shell `set -x`记录凭据。每次调用都需要新的一次性码。CLI在EOF后处理，输入等待最多10秒，最多43个ASCII字符加可选换行。

## 明确执行

检查预览结果后，另发一次新码并加 `--apply`：

```sh
pnpm runtime:host connect --directory "$DATA_DIR" --environment dev |
  pnpm runtime:host maintain-assets --directory "$DATA_DIR" --environment dev \
    --dataset "$DATASET_ID" --limit 25 --apply
```

这不是“预览名单已锁定”：执行时重新枚举，并在实际T1/T2清理事务内核对lease、任何Asset身份及文件能力。新的完成/引用会阻止不安全删除。完成的图片、角色/剧本引用、资产与命令历史不由此入口删除。

## 输出与分页

- JSON包含datasetId、mode、examined、items及nextCursor。逐项结果为preview、lease-protected、removed、absent或固定error。
- 默认25，最大100候选。检查过但失败/受lease保护的行也占额度；不是“直到成功删除25张”。
- 要继续同一轮时，把上次nextCursor作为`--cursor`参数；仍须新连接码。游标绑定该数据集/身份，不是授权凭据，不能跨库复用。
- 满页可能还有一个空页；要重新检查迟到writer或后来过期的lease，开启不带cursor的新一轮。
- exit0表示本次报告成功输出；exit2表示报告中有逐行错误；exit1表示参数/认证/Host/撤销等命令失败。不要把exit0理解为所有历史残留均已清完。

## 边界

启动应用不会自动运行清理，没有新增后台线程或常驻站点。预览不创建图片目录、不写业务状态，但会兑换并撤销短期认证凭据。候选上限不是SQL CPU/总耗时的硬上限，同步文件操作不伪装可取消。

正常结束或错误在finally撤销临时会话；SIGKILL/掉电不会运行finally，未打印的临时会话沿现有8小时TTL失效。数据目录/库身份发生变化会停止并报错，不自动采用新库继续。不要用直接rm/sqlite删除来替代维护协议。

持久行的业务ID若非法、但分页位置仍是有界无损的原始文本/时间，会作为逐行error跳过，不送入文件清理。分页键本身超界、含控制字符、非法UTF-8或时间不规范时整页明确失败；该命令不是任意损坏SQLite的修复工具。
