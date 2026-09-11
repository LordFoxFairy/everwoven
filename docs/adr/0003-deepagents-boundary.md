# ADR-0003：Deep Agents 的使用边界

- **状态：** Accepted
- **日期：** 2026-09-07
- **决策：** Runtime 使用 LangGraph 自定义确定性回合图；Creator、评测、运营等长程工作使用 LangChain Deep Agents。

## Context

平台同时有两种不同节奏的 AI 工作：

1. **Player Plane**：玩家输入后，需要立刻确认、维护严格世界事实，并把一个紧凑的导演增量送入连续视频会话。
2. **Authoring / Operations Plane**：创作者需要研究素材、生成并修改世界圣经、角色卡、剧情节拍、视觉参考、测试场景，且需要批量评测和迭代。

Deep Agents 是构建在 LangChain/LangGraph 之上的 agent harness，内置规划、文件/上下文管理、subagents、持久记忆与工具调用；适合长程、多步骤、上下文较重的工作。[Deep Agents overview](https://docs.langchain.com/oss/javascript/deepagents/overview) [Deep Agents repository](https://github.com/langchain-ai/deepagents)

## Decision

### Player Plane：自定义 LangGraph，不运行 Deep Agent

```text
Interaction
 → retrieve_memory
 → compile_intent
 → apply_rules (pure TypeScript)
 → character_response
 → compile_director
 → persist
 → emit
```

该回合图固定、可测、可恢复。LLM 只产出 `ActionProposal`；`StateReducer` 是唯一能够提交 WorldEvent 的代码路径。回合流程不使用自主规划、文件系统、shell、自由 subagent 或直接数据库写入。

理由：玩家回合的核心目标是低延迟、可预测、可重放、成本可控和事实一致，不是解决开放式长程任务。

### Authoring / Operations Plane：使用 Deep Agents

Deep Agents 仅在 Node.js Worker/Server 环境运行，且所有有副作用的操作通过受限工具和审批门控制。

```text
Creator brief
  → World Architect Deep Agent
      ├─ Narrative Designer subagent
      ├─ Character Designer subagent
      ├─ Visual Director subagent
      └─ QA Critic subagent
  → draft WorldPackVersion
  → schema validation + Golden Suite
  → human review
  → publish
```

首期配置五类 agent：

| Agent | 输入 | 输出 | 写入权限 |
|---|---|---|---|
| World Architect | Creator brief、世界模板 | World Bible 草稿、任务清单 | draft workspace |
| Narrative Designer | 世界事实、目标、受众 | Beat Graph、事件语法、结局条件 | draft workspace |
| Character Designer | 世界和角色 brief | Character Contract、关系规则、记忆种子 | draft workspace |
| Visual Director | 角色/地点/视觉参考 | Asset plan、shot grammar、Director presets | draft workspace |
| QA Critic | World Pack 草稿、Eval report | 冲突、缺项、测试建议、发布结论 | 只读 + issue draft |

Deep Agents 的 subagents 用于上下文隔离和专业分工；主 agent 仅接收摘要和结构化产物。Deep Agents 官方文档将 subagent 适用场景定义为多步骤、专业工具、上下文隔离任务；简单/必须保留中间上下文的任务不应为此引入额外开销。[Deep Agents subagents](https://docs.langchain.com/oss/python/deepagents/subagents)

## Tool policy

Deep Agents 通过平台工具访问数据，严禁使用隐式自由权限：

```text
worldpack.readDraft(versionId)
worldpack.writeDraftPatch(versionId, jsonPatch)
assets.searchApproved(query)
assets.createPlan(intent)
evals.runDraft(versionId)
provider.benchmarkReadOnly(runId)
issues.createDraft(payload)
```

- Agent 无法直接调用 Prisma client；
- Agent 无法直接发布 WorldPackVersion；
- Agent 无法访问生产 Provider Key；
- 所有写入落到草稿版本，保留 provenance（输入、agent、模型、工具调用、时间）；
- `publish` 仅由 Creator/Operator 在 schema 和 Golden Suite 通过后触发；
- 人工审批应用于发布、资产生成预算和任何外部副作用。

## Consequences

### Positive

- 把复杂的世界构建、素材调研、角色设计和叙事 QA 自动化；
- 用 subagent 隔离大量研究/资产上下文，主 Creator 保持清晰；
- 能替换 MiniMax 或其他支持 tool calling 的模型；
- Player Plane 不受 agent 自主行为、文件系统与长程规划开销影响。

### Trade-offs

- 新增 Creator Agent Worker、草稿工作区、工具权限、审计与审批实现；
- 需要对生成草稿进行 schema、评测和人工审阅；
- Deep Agents 版本升级需在隔离 worker 中完成契约测试。

## Implementation pointers

- 新增 `workers/creator-agent-worker/`；
- 新增 `packages/creator-tools/`，暴露 Zod 校验的狭窄工具集合；
- 在 `packages/world-pack/` 增加 draft patch 与 provenance schema；
- Studio 提供“生成草稿 → 查看 diff → 运行评测 → 人工发布”四步流；
- 在 `Provider Registry` 将 Deep Agents 模型调用记录为 `TextProvider` operation，但与玩家回合成本分账。
