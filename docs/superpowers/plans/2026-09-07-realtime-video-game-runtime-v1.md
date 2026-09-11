> 历史计划，待按 PRODUCT-BASELINE.md 重编。包含固定场景与 World Pack 的旧任务，当前不直接执行。

# Realtime Interactive Video Runtime v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal-alpha, single-player Prompt-first realtime interactive video runtime that validates one narrow Reference Live Scene: free text changes durable world state, then appears as a legible consequence in the next continuous video segment. H3 Max Director is the first live Provider benchmark.

**Architecture:** A TypeScript PNPM/Turborepo workspace separates durable platform contracts, deterministic GameBrain, one provider adapter, persistence, realtime gateway, Web Player, and evaluation tooling. The GameBrain commits only validated domain events; the Realtime Session Scheduler translates those events into next-presentation directives. fal H3 Max Director maps its prompt versions/replan behavior onto the generic contract; future Providers can use a different native protocol without leaking SDK details into GameBrain.

**Tech Stack (P0):** TypeScript, PNPM, Turborepo, Node.js, Fastify, WebSocket, Zod, LangGraph.js or an explicit turn state machine, Postgres, Prisma, Redis, Next.js, React, Vitest, Playwright, OpenTelemetry, fal JS client.

## Product-model correction: user-directed story (2026-09-07)

The authoritative product model is now [PRD v2](../../../PRD-v1-realtime-interactive-video-runtime.md): **the platform supplies Character Packs and prompts; the user supplies the opening StorySeed and drives every later story change.**

- Remove any implementation assumption that V1 ships a Reference World, authored Beat Graph, fixed location, official story scene, or predefined ending.
- Replace `WorldPack` content fixtures in V1 delivery with versioned `CharacterPack`, user-owned `StorySeed`, evolving `SessionCanon`, and `GoldenConversation` fixtures.
- `ChoiceComposer` emits contextual suggestions only; it never reads a prewritten branch graph.
- Web and Tauri Desktop are the V1 product surfaces; build browser WebRTC first, then package the shared Player in Tauri before Gate C.

## V1 core scope correction (2026-09-07)

This plan predates the final PRD narrowing. The authoritative product scope is [PRD v1](../../../PRD-v1-realtime-interactive-video-runtime.md) and its [Backlog](../../../V1-product-requirements-backlog.md). Apply these rules while executing every task below:

- **Target Web and Desktop Player.** Use the browser implementation to validate H3 WebRTC in Gate B, then package the same Player in the Tauri desktop shell before Gate C; mobile remains P1.
- **Ship one provider and one world.** Build `FalH3MaxDirectorProvider` and `MockProvider`; a generic registry/router may be a thin internal seam, not a control plane product.
- **Ship text first.** Voice is P0.5 after text ACK, Golden and live-session benchmarks hold.
- **Keep GameBrain deterministic at the boundary.** LLM/LangGraph can create an `ActionProposal`; only the reducer writes `WorldEvent`.
- **Treat Deep Agents as P1.** Do not make a Creator Agent worker, Studio application, or agentic player turn a Gate A/B dependency.
- **Build a minimal operator timeline, not a Creator Console.** It must expose the causal chain and replay facts; editing can start from versioned fixtures.
- **Use three gates.** Gate A (mock playable truth), Gate B (H3 live scene), Gate C (30 internal Alpha runs). Do not start deferred platform modules before the current gate meets its exit criteria.

**Deferred Stack:** Deep Agents JS, BullMQ workers, full Creator Studio, provider shadow/canary, mobile delivery and multi-user features are post-Alpha investments. Tauri 2 is included as the shared-Player desktop delivery shell before Gate C.

---

## Implementation boundaries

- The first release is realtime-interaction-first: its primary delivery is a continuous session game loop. H3 Director is the current native-stream implementation; chained clips are a valid fallback Profile.
- The Player exposes free text and voice; semantic actions exist only inside the compiler/rules layer.
- `WorldEvent` and `StateSnapshot` are the world truth. LLM outputs are candidate proposals and are never directly persisted as truth.
- Only `packages/providers` imports fal/MiniMax SDKs. Applications and GameBrain import platform interfaces.
- A `RealtimeSession` is bound to one Provider for its lifetime. H3 Max Director is the first V1 implementation; Provider changes happen only between sessions through a `ContinuityBundle`.
- Work in the following chunks sequentially. Each chunk should pass its full test suite before the next chunk begins.

## Proposed workspace structure

```text
apps/
  gateway/                     # Fastify HTTP/WebSocket realtime edge
  player-web/                  # React/Vite browser player
  player-desktop/              # Tauri shell around player-web build
  studio/                      # Next.js creator/operator console
workers/
  turn-worker/                 # LangGraph turn execution and memory jobs
  eval-worker/                 # Golden scenario runner
  creator-agent-worker/        # Deep Agents authoring/QA workers
packages/
  contracts/                   # Zod schemas, event types, API protocol
  game-brain/                  # reducer, rules, memory, character, director compiler
  world-pack/                  # WorldPack schema, validation, reference pack fixture
  db/                          # Prisma schema, repositories, migrations
  providers/                   # provider contracts, router, fal/MiniMax/mock adapters
  realtime/                    # gateway session coordinator and event fan-out
  observability/               # tracing, metrics, cost ledger helpers
  config/                      # ESLint, TypeScript, Vitest shared configuration
infra/
  docker/                      # local Postgres/Redis/MinIO compose
  otel/                        # optional local collector configuration
tests/
  e2e/                         # cross-package gateway/player API tests
docs/
  adr/                          # decisions recorded during implementation
```

## Chunk 1: Foundation and durable world truth

### Task 1: Bootstrap the TypeScript monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.env.example`
- Create: `infra/docker/docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: Create the workspace manifest and package graph**

```json
{
  "name": "realtime-video-game-runtime",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev --parallel"
  }
}
```

- [ ] **Step 2: Add empty packages/apps with `build`, `test`, `lint`, and `typecheck` scripts**
- [ ] **Step 3: Run workspace verification**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: all packages resolve; temporary tests pass.

- [ ] **Step 4: Start local dependencies and verify health**

Run: `docker compose -f infra/docker/docker-compose.yml up -d && docker compose -f infra/docker/docker-compose.yml ps`
Expected: Postgres, Redis, and MinIO report healthy/running.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json vitest.workspace.ts .env.example infra README.md apps packages workers tests
git commit -m "chore: bootstrap realtime video runtime workspace"
```

### Task 2: Define versioned cross-platform contracts

**Files:**
- Create: `packages/contracts/src/ids.ts`
- Create: `packages/contracts/src/interaction.ts`
- Create: `packages/contracts/src/world.ts`
- Create: `packages/contracts/src/director.ts`
- Create: `packages/contracts/src/provider.ts`
- Create: `packages/contracts/src/realtime.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/contracts.test.ts`

- [ ] **Step 1: Write failing schema tests for `Interaction`, `WorldEvent`, and `DirectorDelta`**

```ts
it("rejects an interaction without a monotonic client sequence", () => {
  expect(() => InteractionSchema.parse({ playthroughId: "pt_1" })).toThrow();
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter @runtime/contracts test`
Expected: FAIL because schemas are absent.

- [ ] **Step 3: Implement Zod contracts and branded ID helpers**

Required exports:

```ts
InteractionSchema
WorldEventSchema
StateSnapshotSchema
CharacterContractSchema
ActionProposalSchema
DirectorDeltaSchema
ContinuityBundleSchema
VideoIntentSchema
ProviderDecisionSchema
RealtimeEventSchema
```

- [ ] **Step 4: Add JSON serializability and schema-version tests**
- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @runtime/contracts test && pnpm --filter @runtime/contracts typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat: add versioned runtime contracts"
```

### Task 3: Establish Prisma persistence and event repositories

**Files:**
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/repositories/playthrough-repository.ts`
- Create: `packages/db/src/repositories/event-repository.ts`
- Create: `packages/db/src/repositories/provider-repository.ts`
- Create: `packages/db/src/repositories/world-pack-repository.ts`
- Create: `packages/db/test/event-repository.integration.test.ts`
- Create: `packages/db/test/fixtures.ts`

- [ ] **Step 1: Write the integration test for append-only event ordering**

```ts
it("rejects an event whose expected state version is stale", async () => {
  await appendEvent({ playthroughId, expectedVersion: 0, event: firstEvent });
  await expect(appendEvent({ playthroughId, expectedVersion: 0, event: secondEvent }))
    .rejects.toThrow("STATE_VERSION_CONFLICT");
});
```

- [ ] **Step 2: Run integration test against local Postgres**

Run: `pnpm --filter @runtime/db test:integration`
Expected: FAIL before models/repository exist.

- [ ] **Step 3: Implement Prisma models and migration**

Include: `WorldPack`, `WorldPackVersion`, `Character`, `Location`, `Playthrough`, `Episode`, `Interaction`, `WorldEvent`, `StateSnapshot`, `CharacterMemory`, `DirectorSession`, `ContinuityBundle`, `ProviderModelVersion`, `ProviderDecision`, `ProviderOperation`, `MediaArtifact`, `PriceBook`, `GoldenScenario`, `EvalRun`, and `WebhookReceipt`.

- [ ] **Step 4: Implement optimistic concurrency event append and snapshot reads**
- [ ] **Step 5: Generate migration and rerun integration tests**

Run: `pnpm --filter @runtime/db prisma:migrate && pnpm --filter @runtime/db test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat: add event sourced persistence layer"
```

### Task 4: Implement deterministic state reducer and rules boundary

**Files:**
- Create: `packages/game-brain/src/state/reducer.ts`
- Create: `packages/game-brain/src/state/derive-snapshot.ts`
- Create: `packages/game-brain/src/rules/rule-engine.ts`
- Create: `packages/game-brain/src/rules/preconditions.ts`
- Create: `packages/game-brain/src/index.ts`
- Create: `packages/game-brain/test/reducer.test.ts`
- Create: `packages/game-brain/test/rule-engine.test.ts`

- [ ] **Step 1: Write failing reducer tests for item transfer, relationship change, and event replay**

```ts
it("replaying events produces the same snapshot as the committed snapshot", () => {
  expect(deriveSnapshot(initial, events)).toEqual(committedSnapshot);
});
```

- [ ] **Step 2: Run unit tests to verify failure**

Run: `pnpm --filter @runtime/game-brain test`
Expected: FAIL because reducer functions are absent.

- [ ] **Step 3: Implement pure event reducers and typed domain errors**
- [ ] **Step 4: Implement rule checks for entity presence, inventory ownership, character knowledge, and beat gates**
- [ ] **Step 5: Add property-style test cases for state version and replay determinism**
- [ ] **Step 6: Run all GameBrain tests**

Run: `pnpm --filter @runtime/game-brain test && pnpm --filter @runtime/game-brain typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/game-brain
git commit -m "feat: add deterministic game state reducer"
```

## Chunk 2: World packs, model orchestration, and providers

### Task 5: Define World Pack schema and build the Reference World Pack

**Files:**
- Create: `packages/world-pack/src/schema.ts`
- Create: `packages/world-pack/src/validator.ts`
- Create: `packages/world-pack/src/reference-world/index.ts`
- Create: `packages/world-pack/src/reference-world/world-bible.json`
- Create: `packages/world-pack/src/reference-world/characters.json`
- Create: `packages/world-pack/src/reference-world/beats.json`
- Create: `packages/world-pack/src/reference-world/event-grammar.json`
- Create: `packages/world-pack/test/validator.test.ts`

- [ ] **Step 1: Write failing tests for a World Pack missing visual anchors and ending conditions**
- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @runtime/world-pack test`
Expected: FAIL because validation does not exist.

- [ ] **Step 3: Implement WorldPackVersion Zod schema and validator**

The required data must include a World Bible, at least two Character Contracts, one Location, Beat Graph, Event Grammar, visual anchors, and at least three ending conditions.

- [ ] **Step 4: Add a genre-neutral Reference World Pack fixture**

Use stable fixture IDs and a replaceable theme. Keep all theme-specific text/assets under `reference-world/`.

- [ ] **Step 5: Validate fixture and generate a human-readable validation report**

Run: `pnpm --filter @runtime/world-pack test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/world-pack
git commit -m "feat: add versioned world pack schema and reference world"
```

### Task 6: Build the Provider Control Plane and MockVideoProvider

**Files:**
- Create: `packages/providers/src/contracts.ts`
- Create: `packages/providers/src/registry.ts`
- Create: `packages/providers/src/router.ts`
- Create: `packages/providers/src/price-book.ts`
- Create: `packages/providers/src/health.ts`
- Create: `packages/providers/src/mock/mock-video-provider.ts`
- Create: `packages/providers/src/index.ts`
- Create: `packages/providers/test/router.test.ts`
- Create: `packages/providers/test/mock-video-provider.test.ts`

- [ ] **Step 1: Write failing routing tests**

```ts
it("selects only a healthy provider that satisfies live continuity", async () => {
  const decision = await router.resolve(liveIntent, runtimeContext);
  expect(decision.providerKey).toBe("mock-live");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @runtime/providers test`
Expected: FAIL because router/registry are absent.

- [ ] **Step 3: Implement `VideoProvider`, `TextProvider`, `VoiceProvider`, and `AssetVideoProvider` interfaces**
- [ ] **Step 4: Implement capability registry, price book lookup, health states, and auditable ProviderDecision**
- [ ] **Step 5: Implement MockVideoProvider deterministic timeline, live status events, and failure injection**
- [ ] **Step 6: Add contract tests for idempotency and duplicate webhooks**
- [ ] **Step 7: Run tests**

Run: `pnpm --filter @runtime/providers test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/providers
git commit -m "feat: add provider router and mock live video provider"
```

### Task 7: Add MiniMax text, voice, and asset adapters

**Files:**
- Create: `packages/providers/src/minimax/minimax-text-provider.ts`
- Create: `packages/providers/src/minimax/minimax-voice-provider.ts`
- Create: `packages/providers/src/minimax/minimax-asset-video-provider.ts`
- Create: `packages/providers/src/minimax/minimax-client.ts`
- Create: `packages/providers/test/minimax-adapters.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write adapter tests using HTTP mocks for auth headers, task lifecycle, and normalized errors**
- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @runtime/providers test minimax-adapters`
Expected: FAIL because adapters are absent.

- [ ] **Step 3: Implement MiniMax OpenAI-compatible text client with structured output adapter**
- [ ] **Step 4: Implement MiniMax voice adapter with normalized audio artifact response**
- [ ] **Step 5: Implement async asset job create/query/cancel normalization**
- [ ] **Step 6: Verify all credentials remain server-only and add config validation tests**
- [ ] **Step 7: Run provider test suite**

Run: `pnpm --filter @runtime/providers test`
Expected: PASS with all HTTP calls mocked.

- [ ] **Step 8: Commit**

```bash
git add packages/providers .env.example
git commit -m "feat: add MiniMax text voice and asset adapters"
```

### Task 8: Add fal H3 Max Director as the first RealtimeExperienceProvider adapter

**Files:**
- Create: `packages/providers/src/fal/fal-director-provider.ts`
- Create: `packages/providers/src/fal/fal-server-proxy.ts`
- Create: `packages/providers/src/fal/fal-webhook.ts`
- Create: `packages/providers/test/fal-director-provider.test.ts`
- Modify: `packages/providers/src/registry.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write contract tests with a fake realtime session**

```ts
it("maps live provider media/state callbacks to normalized ProviderEvents", async () => {
  const events = await collect(provider.startLive(liveIntent));
  expect(events).toContainEqual(expect.objectContaining({ type: "media.ready" }));
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @runtime/providers test fal-director-provider`
Expected: FAIL because adapter is absent.

- [ ] **Step 3: Implement generic session open/direct/close mapping; map H3 configure and versioned prompt directives (`replan`) into the RealtimeExperienceProvider contract**
- [ ] **Step 4: Implement authenticated server proxy boundary; keep FAL_KEY out of clients**
- [ ] **Step 5: Normalize `configured`, `prompt_pending`, `prompt_applied`, `prompt_rejected`, `chunk`, `deadline_missed`, and `stream_exhausted`; record chunk buffer metrics and prompt-version correlation**
- [ ] **Step 6: Add a `RealtimeSessionScheduler` test suite: directives target the next presentation unit, interrupt maps to H3 `replan: true`, ambient deltas coalesce, and UI-visible state waits for matching provider output**
- [ ] **Step 7: Run adapter tests and an opt-in manual sandbox smoke test**

Run: `pnpm --filter @runtime/providers test && pnpm --filter @runtime/providers smoke:fal`
Expected: tests PASS; smoke test requires configured FAL key and opens then closes one test session.

- [ ] **Step 8: Commit**

```bash
git add packages/providers .env.example
git commit -m "feat: add fal director live video provider"
```

### Task 9: Implement GameBrain turn graph, memory, characters, and director compiler

**Files:**
- Create: `packages/game-brain/src/turn-graph.ts`
- Create: `packages/game-brain/src/nodes/intent.ts`
- Create: `packages/game-brain/src/nodes/retrieve-memory.ts`
- Create: `packages/game-brain/src/nodes/apply-rules.ts`
- Create: `packages/game-brain/src/nodes/character-response.ts`
- Create: `packages/game-brain/src/nodes/compile-director.ts`
- Create: `packages/game-brain/src/nodes/persist.ts`
- Create: `packages/game-brain/src/memory/retriever.ts`
- Create: `packages/game-brain/src/character/runtime.ts`
- Create: `packages/game-brain/src/director/compiler.ts`
- Create: `packages/game-brain/test/turn-graph.test.ts`
- Create: `packages/game-brain/test/director-compiler.test.ts`

- [ ] **Step 1: Write a failing full-turn test with fake text/voice providers**

```ts
it("commits only rule-approved events and emits a director delta after commit", async () => {
  const result = await runTurn(fixtureContext, confrontationInteraction);
  expect(result.events).toContainEqual(expect.objectContaining({ type: "CommitmentCreated" }));
  expect(result.realtimeEvents.map((event) => event.type)).toEqual(
    expect.arrayContaining(["turn.ack", "state.diff", "director.delta"]),
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @runtime/game-brain test turn-graph`
Expected: FAIL because nodes/graph are absent.

- [ ] **Step 3: Implement LangGraph node topology**

`validate_input → retrieve_memory → compile_intent → apply_rules → character_response → compile_director → persist → emit`

- [ ] **Step 4: Ensure reducer executes before character/director outputs become visible**
- [ ] **Step 5: Add tests for invalid object use, interrupt, knowledge boundary, and open_action**
- [ ] **Step 6: Run unit suite**

Run: `pnpm --filter @runtime/game-brain test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/game-brain
git commit -m "feat: add graph orchestrated prompt first game turns"
```

## Chunk 3: Realtime service, player, studio, and quality gates

### Task 10: Implement Realtime Gateway session coordination

**Files:**
- Create: `apps/gateway/src/server.ts`
- Create: `apps/gateway/src/routes/playthroughs.ts`
- Create: `apps/gateway/src/ws/session-handler.ts`
- Create: `apps/gateway/src/ws/protocol.ts`
- Create: `apps/gateway/src/services/session-coordinator.ts`
- Create: `apps/gateway/src/services/director-session-manager.ts`
- Create: `apps/gateway/src/services/redis-lock.ts`
- Create: `apps/gateway/test/session-handler.integration.test.ts`

- [ ] **Step 1: Write a WebSocket integration test for ACK/event ordering**

```ts
expect(receivedTypes).toEqual([
  "interaction.accepted",
  "turn.ack",
  "state.diff",
  "director.delta",
]);
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @runtime/gateway test:integration`
Expected: FAIL because Gateway routes/handler are absent.

- [ ] **Step 3: Implement authenticated Playthrough endpoints and WebSocket handshake**
- [ ] **Step 4: Implement Redis playthrough lock, client sequence check, idempotency, and event fan-out**
- [ ] **Step 5: Implement session manager handoff using ContinuityBundle**
- [ ] **Step 6: Run integration tests**

Run: `pnpm --filter @runtime/gateway test:integration`
Expected: PASS with MockVideoProvider.

- [ ] **Step 7: Commit**

```bash
git add apps/gateway
git commit -m "feat: add realtime interaction gateway"
```

### Task 11: Build the web Player Runtime

**Files:**
- Create: `apps/player-web/src/app.tsx`
- Create: `apps/player-web/src/features/session/session-store.ts`
- Create: `apps/player-web/src/features/session/use-realtime-session.ts`
- Create: `apps/player-web/src/features/video/live-video.tsx`
- Create: `apps/player-web/src/features/input/free-prompt-input.tsx`
- Create: `apps/player-web/src/features/input/voice-input.tsx`
- Create: `apps/player-web/src/features/timeline/state-feedback.tsx`
- Create: `apps/player-web/src/features/timeline/subtitles.tsx`
- Create: `apps/player-web/src/styles/player.css`
- Create: `apps/player-web/test/player-flow.spec.tsx`

- [ ] **Step 1: Write component tests for connection state and event rendering**
- [ ] **Step 2: Write a browser test where a player sends a free prompt and receives ACK/StateDiff**

Run: `pnpm --filter @runtime/player-web test`
Expected: FAIL before UI exists.

- [ ] **Step 3: Implement video-first layout**

Required UI: full primary video canvas, subtle connection indicator, subtitles, free text field, push-to-talk control, concise state feedback, and interrupt affordance. Do not add a choice tree, inventory grid, quest log, or genre-specific HUD.

- [ ] **Step 4: Implement WebRTC `MediaStream` attachment through normalized provider session events**
- [ ] **Step 5: Implement optimistic `interaction.accepted`, input disabled/enabled states, and graceful reconnect UI**
- [ ] **Step 6: Run unit and browser tests**

Run: `pnpm --filter @runtime/player-web test && pnpm --filter @runtime/player-web test:e2e`
Expected: PASS against mock gateway.

- [ ] **Step 7: Commit**

```bash
git add apps/player-web
git commit -m "feat: add prompt first video player runtime"
```

### Task 12: Package desktop Player with Tauri

**Files:**
- Create: `apps/player-desktop/package.json`
- Create: `apps/player-desktop/src-tauri/Cargo.toml`
- Create: `apps/player-desktop/src-tauri/src/lib.rs`
- Create: `apps/player-desktop/src-tauri/tauri.conf.json`
- Create: `apps/player-desktop/test/desktop-smoke.md`

- [ ] **Step 1: Create a failing desktop smoke checklist against the web build artifact**
- [ ] **Step 2: Configure Tauri to bundle the Vite Player build without Next SSR**
- [ ] **Step 3: Add secure token storage and media cache boundaries**
- [ ] **Step 4: Build desktop artifact**

Run: `pnpm --filter @runtime/player-desktop build`
Expected: Tauri build succeeds and points to Player web assets.

- [ ] **Step 5: Perform manual smoke test: start session, play mock media, submit text, reconnect**
- [ ] **Step 6: Commit**

```bash
git add apps/player-desktop
git commit -m "feat: add Tauri desktop player shell"
```

### Task 13: Build Creator and Operator Console v0

**Files:**
- Create: `apps/studio/app/page.tsx`
- Create: `apps/studio/app/world-packs/[id]/page.tsx`
- Create: `apps/studio/app/playthroughs/[id]/page.tsx`
- Create: `apps/studio/app/providers/page.tsx`
- Create: `apps/studio/components/world-pack-form.tsx`
- Create: `apps/studio/components/playthrough-timeline.tsx`
- Create: `apps/studio/components/provider-health-table.tsx`
- Create: `apps/studio/lib/api.ts`
- Create: `apps/studio/test/operator-replay.spec.ts`

- [ ] **Step 1: Write browser test for World Pack validation error display and Playthrough replay timeline**
- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @runtime/studio test:e2e`
Expected: FAIL before pages are implemented.

- [ ] **Step 3: Implement World Pack draft/edit/validate/publish UI**
- [ ] **Step 4: Implement Playthrough timeline using stored Interactions, WorldEvents, snapshots, ProviderDecision, operations, and media artifacts**
- [ ] **Step 5: Implement provider model health and publish-state controls with audit log**
- [ ] **Step 6: Verify no replay control triggers a new provider call**
- [ ] **Step 7: Run studio test suite**

Run: `pnpm --filter @runtime/studio test && pnpm --filter @runtime/studio test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/studio
git commit -m "feat: add creator and operator studio"
```


### Task 13A: Add Deep Agents Creator Copilot behind a draft-only tool boundary

**Files:**
- Create: `packages/creator-tools/src/worldpack-tools.ts`
- Create: `packages/creator-tools/src/tool-policy.ts`
- Create: `packages/creator-tools/test/worldpack-tools.test.ts`
- Create: `workers/creator-agent-worker/src/agent.ts`
- Create: `workers/creator-agent-worker/src/subagents.ts`
- Create: `workers/creator-agent-worker/src/jobs/generate-world-draft.ts`
- Create: `workers/creator-agent-worker/test/agent.integration.test.ts`
- Modify: `apps/studio/app/world-packs/[id]/page.tsx`

- [ ] **Step 1: Write failing tool-policy tests**

```ts
it("permits draft patch writes but rejects production publish", async () => {
  await expect(tools.publishWorldPack({ versionId })).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter @runtime/creator-tools test`
Expected: FAIL because the allowlisted tool boundary is absent.

- [ ] **Step 3: Implement Zod-validated read/write-draft/eval tools**

Expose only `worldpack.readDraft`, `worldpack.writeDraftPatch`, `assets.searchApproved`, `assets.createPlan`, `evals.runDraft`, and `issues.createDraft`. All tool executions log provenance.

- [ ] **Step 4: Implement a server-only Deep Agent with four subagents**

Configure World Architect, Narrative Designer, Character Designer, and QA Critic. Each subagent receives only the tools and source slices required for its job; none receives production database or provider credentials.

- [ ] **Step 5: Add a Studio flow: brief → generated draft → diff → eval → human publish**
- [ ] **Step 6: Add integration test that confirms draft output validates and publish remains an explicit human action**
- [ ] **Step 7: Run tests**

Run: `pnpm --filter @runtime/creator-tools test && pnpm --filter @runtime/creator-agent-worker test`
Expected: PASS with a fake tool-calling model.

- [ ] **Step 8: Commit**

```bash
git add packages/creator-tools workers/creator-agent-worker apps/studio
git commit -m "feat: add deep agents creator copilot"
```

### Task 14: Implement Golden Interaction evaluation worker

**Files:**
- Create: `workers/eval-worker/src/runner.ts`
- Create: `workers/eval-worker/src/scenario-loader.ts`
- Create: `workers/eval-worker/src/assertions.ts`
- Create: `workers/eval-worker/src/report.ts`
- Create: `workers/eval-worker/src/scenarios/reference-world.json`
- Create: `workers/eval-worker/test/runner.test.ts`
- Create: `workers/eval-worker/test/scenarios.test.ts`

- [ ] **Step 1: Write failing test for a scenario that recalls an earlier player commitment**
- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @runtime/eval-worker test`
Expected: FAIL because runner/assertions are absent.

- [ ] **Step 3: Implement deterministic mock-mode scenario runner**
- [ ] **Step 4: Add assertions for event correctness, memory retrieval, schema success, session handoff data, and forbidden provider calls during replay**
- [ ] **Step 5: Add 30 Reference World scenarios**

Must include: nonexistent item, already-given item, promise recall, knowledge boundary, character interruption, relationship shift, scene exit, handoff continuity, repeated webhook, and provider degradation.

- [ ] **Step 6: Emit machine-readable JSON and human-readable Markdown report**
- [ ] **Step 7: Run evaluation suite**

Run: `pnpm --filter @runtime/eval-worker test && pnpm --filter @runtime/eval-worker eval:reference-world`
Expected: PASS with a report under `artifacts/evals/`.

- [ ] **Step 8: Commit**

```bash
git add workers/eval-worker
git commit -m "feat: add golden interaction evaluation runtime"
```

### Task 15: Add observability, cost accounting, and release gates

**Files:**
- Create: `packages/observability/src/tracing.ts`
- Create: `packages/observability/src/metrics.ts`
- Create: `packages/observability/src/cost-ledger.ts`
- Create: `packages/observability/src/release-gates.ts`
- Create: `packages/observability/test/cost-ledger.test.ts`
- Create: `docs/adr/0001-event-sourced-world-truth.md`
- Create: `docs/adr/0002-provider-control-plane.md`
- Create: `docs/runbooks/alpha-incident-response.md`
- Create: `docs/runbooks/provider-benchmark.md`

- [ ] **Step 1: Write failing unit tests for PriceBook effective-date selection and cost aggregation**
- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @runtime/observability test`
Expected: FAIL because cost ledger is absent.

- [ ] **Step 3: Implement traces and metrics for ACK latency, visible-media latency, session lifecycle, provider errors, state conflicts, and cost per Interaction**
- [ ] **Step 4: Implement PriceBook lookup and immutable ProviderOperation cost entries**
- [ ] **Step 5: Implement release-gate evaluator for V1 thresholds**
- [ ] **Step 6: Write ADRs and operational runbooks**
- [ ] **Step 7: Run tests and generate a sample release-gate report**

Run: `pnpm --filter @runtime/observability test && pnpm --filter @runtime/observability gates:check`
Expected: PASS for fixture data and readable report output.

- [ ] **Step 8: Commit**

```bash
git add packages/observability docs
git commit -m "feat: add runtime observability and release gates"
```

## Chunk 4: End-to-end integration and internal-alpha readiness

### Task 16: Add end-to-end Reference World test flow

**Files:**
- Create: `tests/e2e/reference-world.spec.ts`
- Create: `tests/e2e/helpers/test-runtime.ts`
- Create: `tests/e2e/fixtures/reference-world-turns.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Write an end-to-end test that starts a Playthrough and runs five free Prompt turns**

Expected test coverage: enter world, submit an open action, receive ACK, commit WorldEvent, observe StateDiff, receive mock media, create ContinuityBundle, reconnect, and recall earlier commitment.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test:e2e -- reference-world`
Expected: FAIL until all services are wired.

- [ ] **Step 3: Wire local app composition and test environment startup**
- [ ] **Step 4: Make the E2E test pass against MockVideoProvider**
- [ ] **Step 5: Add opt-in manual live smoke script with fal Director and no recorded secrets**
- [ ] **Step 6: Run complete verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e -- reference-world`
Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add tests package.json README.md
git commit -m "test: cover end to end prompt first reference world flow"
```

### Task 17: Run Provider Capability Benchmark and internal-alpha signoff

**Files:**
- Create: `docs/benchmarks/provider-capability-benchmark-template.md`
- Create: `docs/benchmarks/reference-world-results.csv`
- Create: `docs/release/internal-alpha-checklist.md`
- Create: `artifacts/benchmarks/.gitkeep`

- [ ] **Step 1: Define the 20 live benchmark prompts and scoring rubric**

Measure: ACK P50/P95, input-to-visible-change P50/P95, session connect time, handoff success, character consistency, visual continuity, error rate, and effective interaction cost.

- [ ] **Step 2: Run benchmark against MockVideoProvider to validate instrumentation**

Run: `pnpm benchmark:provider --provider mock`
Expected: complete CSV/Markdown report with deterministic fixture values.

- [ ] **Step 3: Run opt-in live benchmark for fal Director and record actual observations**
- [ ] **Step 4: Compare results to V1 release gates and document gaps**
- [ ] **Step 5: Execute internal-alpha checklist**

Checklist must cover: credentials, rate limits, content setup, privacy/deletion policy, observability dashboards, alerting, rollback, Operator access, test pass, and manual player walkthrough.

- [ ] **Step 6: Commit benchmark templates, results, and signoff document**

```bash
git add docs/benchmarks docs/release artifacts/benchmarks
git commit -m "docs: add provider benchmark and internal alpha checklist"
```

## Final verification checklist

- [ ] `pnpm lint` passes from repository root.
- [ ] `pnpm typecheck` passes from repository root.
- [ ] `pnpm test` passes from repository root.
- [ ] Reference World E2E passes against MockVideoProvider.
- [ ] Golden Interaction Suite produces a passing report for the published Reference World version.
- [ ] Operator replay performs zero production provider calls.
- [ ] Every Provider Operation has an idempotency key, model version, route decision, status, timing, and cost record.
- [ ] Secrets are absent from Player, Tauri bundle, git history, and test artifacts.
- [ ] Manual live smoke test records connection, interaction, visible video response, handoff, and graceful teardown.
- [ ] Internal Alpha checklist is signed by Product, Platform, QA, and Operator owners.
