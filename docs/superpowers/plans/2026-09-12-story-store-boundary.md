# Story Store Boundary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Follow the approved closure audit and the scoped design; do not expand to public HTTP or migration.

**Goal:** Extract the existing story CRUD storage boundary while preserving atomicity and all existing behavior.

**Architecture:** Application → owner-scoped StoryDraftStore port ← Prisma adapter. Composition binds database and clock/ID services; one transaction spans receipt and write.

**Tech Stack:** Existing TypeScript, Prisma/SQLite, Vitest. No new dependency.

## Chunk 1: Transaction boundary

Design: docs/superpowers/specs/2026-09-12-story-store-boundary-design.md.

Files:
- Create apps/runtime/src/ports/story-draft-store.ts (records, read/write scope, Store).
- Create apps/runtime/src/infrastructure/db/prisma-story-draft-store.ts (owner-scoped real transaction implementation).
- Create apps/runtime/src/composition/story-draft-service.ts (explicit factory).
- Modify apps/runtime/src/application/story-drafts.ts (use port, retain rules).
- Modify apps/runtime/tests/story-drafts.integration.test.ts (inject real adapter, preserve assertions).
- Create apps/runtime/tests/story-store-boundary.test.ts (dependency/behavior regression).

- [x] Write a failing dependency-direction test proving application imports Prisma/infrastructure today; run it and retain RED output.
- [x] Define owner-scoped read/write ports and record types. Record JSON is unknown until validated. No Prisma-style generic where/select input.
- [x] Implement Prisma adapter: write calls existing withOwnerWrite; read uses one transaction and active-owner validation. All methods capture ownerId. Keep existing cursor ordering and take semantics.
- [x] Change application functions to Store input; move Prisma-specific queries to adapter. Preserve command namespace, payload hash order, validation before transaction, receipt-before-CAS and historical replay behavior.
- [x] Add composition factory returning create/get/list/update/delete/restore methods from injected Store/services. Update existing tests to real adapter; no compatibility path in application accepting Prisma.
- [x] Add adapter contract tests for owner scoping, compare-and-swap count, receipt rollback and read transaction behavior. Reuse existing integration fixture when practical. Avoid mock adapter as sole atomicity evidence.
- [x] Run focused tests: pnpm exec vitest run apps/runtime/tests/story-drafts.integration.test.ts apps/runtime/tests/story-store-boundary.test.ts. All existing assertions retained.
- [x] Request spec and code-quality reviews; resolve findings.
- [x] Main checkout: pnpm test && pnpm typecheck && pnpm build; git diff --check.
- [x] Update internal API document with factory/port boundary, implementation note, and remaining M0-C2/C3 gates. Commit only this scope, no version tag or image release for an internal-only slice.

验证：计划Bohr、规格Kepler、代码质量Hegel评审通过。主仓29文件291测试、runtime/Web类型检查、生产构建及diff检查通过。源码只涉及批准的六文件切片，未改SQL/HTTP/UI。完整记录见docs/implementation/M0-C1-STORY-STORE-2026-09-12.md。
