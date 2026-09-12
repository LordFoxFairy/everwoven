# Local Authoring Vertical Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Specification: docs/superpowers/specs/2026-09-12-local-authoring-vertical-design.md.

**Goal:** Make explicit local initialization and authenticated SQLite story CRUD usable through the existing Web application, with restart verification.

**Architecture:** Local host owns data directory and temporary credentials. Same Next app exposes session boundary and protected tRPC using existing StoryDraftService. Frontend mock remains separate; no model/worker added.

**Tech Stack:** Existing Node/TypeScript, Next/tRPC, Prisma/SQLite, React, Vitest/Playwright. Prefer existing dependencies.

## Chunk 1: Host/security
- [x] Review scoped specification and address blockers.
- [x] Add failing real-file tests in apps/runtime/tests/local-host.integration.test.ts: init/reinit, invalid dir, environment, one-use/expired code, restart auth/logout, durable story access.
- [x] Implement apps/runtime/src/host/{index,storage,sessions}.ts as needed; apps/runtime/src/host/cli.ts explicit init/connect commands. No other write set for host worker. Keep entry exports per spec.
- [x] Focused tests and runtime typecheck; record RED/GREEN. No schema migrations/HTTP writes.

## Chunk 2: Same-app integration
- [x] Add apps/web/scripts/local-start.mjs: one custom Next server fixed to127.0.0.1, controlled port/origin and startup marker; reject conflicting origin. Verify actual listening socket. Wire controlled host service in apps/web/server/local-runtime.ts, session handler/route, protected tRPC procedures; preserve metadata tests.
- [x] Add actual HTTP integration tests using temporary real host, not fake security context; unauthorized/CSRF/owner injection/write/replay/conflict/restart.
- [x] Add runtime dependency/build integration only if necessary; keep server-only runtime out of frontend bundle; verify web production build with native driver.
- [x] Add frontend database draft view within existing library and connection dialog; retain browser drafts, no silent migration. Stable retry command and preserved input on error.
- [x] Add browser HTTP smoke with real session, CRUD/delete/restore, refresh and process-restart check on isolated directory/port; no user data changes.

## Chunk 3: Close and review
- [x] Independent code/security review, resolve findings and rerun main pnpm test/typecheck/build.
- [x] Update internal/public contracts, deployment guide, architecture/sequence and exact capability status; avoid claiming model/worker/backup completion.
- [x] Commit only approved files; no release tag until changed Docker lifecycle separately validated.

## Final verification

361 tests, both typechecks and production build passed. Real browser CRUD/restart/lost-response recovery and insecure HTTP demo regression passed. Independent security/UI reviews closed four P2 findings. Docker daemon returned 500 locally; changed container build must pass CI before any new release tag. No model calls or user data migration.
