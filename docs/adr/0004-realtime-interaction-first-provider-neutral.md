> 2026-09-10 一期范围更新：本文早期实时会话假设不再作为首发要求；当前采用 [分段任务技术方案](../architecture/ARCHITECTURE.md) 与 [PRD](../../FINAL-PRD.md)。供应商隔离、画面证据及未来空间输入原则仍保留。

# ADR-0004：实时交互优先，视频模型可替换

- **状态：** Accepted
- **日期：** 2026-09-07
- **决策：** 平台产品定义为 Realtime Interactive Video Runtime；H3 Max Director 是当前首个参考 Provider，而非平台身份、领域模型或永久依赖。

## Product truth

```text
平台核心：用户输入持续改变一个连续视听世界
当前最合适实现：H3 Max Director
未来实现：任何满足实时互动能力契约的模型/服务
```

用户购买与创作者发布的对象是 `Live Episode` 和 `World Pack`，不是某一个视频模型。用户可通过自由 Prompt、语音或未来动作输入改变角色、关系、剧情、镜头、环境和声音；平台确保这些变化持续、可理解、可回放。

## Capability-first contract

业务层只依赖 `RealtimeExperienceProvider`，由 Provider Adapter 将不同模型的原生协议映射到统一事件。

```ts
interface RealtimeExperienceProvider {
  openSession(config: RealtimeSessionConfig): Promise<RealtimeSession>;
  direct(session: RealtimeSession, directive: RealtimeDirective): Promise<DirectiveReceipt>;
  subscribe(session: RealtimeSession, listener: (event: RealtimeProviderEvent) => void): Unsubscribe;
  close(session: RealtimeSession): Promise<void>;
  capabilities(): RealtimeCapabilityProfile;
}

type RealtimeCapabilityProfile = {
  continuity: "native_stream" | "chained_clips" | "frame_step";
  directionMode: "live_text" | "live_multimodal" | "queued_job";
  responseGranularity: "segment" | "clip" | "frame";
  supportsAudio: boolean;
  supportsInputInterrupt: boolean;
  supportsSessionMemory: boolean;
  observability: Set<"directive_accepted" | "visible_output" | "buffer" | "deadline">;
};
```

`RealtimeDirective` 保持语义级字段：`eventIds`、`action`、`camera`、`mood`、`audioIntent`、`priority`、`interruptPolicy`。H3 的 `prompt_version`、`replan`、`chunk` 与其他 Provider 的对应概念都被映射到这一契约。

## H3 Max Director 的位置

H3 Director 当前非常契合 `native_stream + live_text + segment + sessionMemory` Profile，因此用作 V1 的首个生产实现和性能基线。它推动我们明确了 Segment、指令确认、缓冲和 session handoff 的设计，但这些概念属于 Runtime，不属于 H3 专属业务代码。

## Consequences

- World Pack、GameBrain、Creator Studio 和 Player 不出现 `H3`、`fal`、`prompt_version` 或 `replan` 的业务依赖；
- `FalH3MaxDirectorProvider` 是 `RealtimeExperienceProvider` 的第一个 Adapter；
- `ChainedClipProvider`（例如 H3 Turbo 或未来异步模型）可实现同一体验契约的降级 Profile；
- 新世界模型可实现 frame-level 或更低延迟 Profile，Runtime 通过能力路由采用其优势；
- 基准测试按体验能力测量：输入到可见后果、连续性、角色保持、打断、成本和恢复，不按模型品牌测量。
