# Generation settlement implementation plan

**Goal:** Complete local metered settlement without paid test calls: preserve supplier evidence, settle accepted turn costs exactly once, expose held/settled/review state, release unused reservation only with complete evidence.

**Architecture:** Immutable stage charges reference the accepted quote, sealed provider identity and response/task. Text charges use explicit OpenRouter account cost; video charges use returned usage and the complete sealed tariff, labeled metered rather than an invoice. A single owner transaction records evidence and updates reservation totals. Missing or conflicting evidence never means free. Same-scope cost overrun blocks new paid dispatch.

**Tech Stack:** Existing TypeScript/T3, Prisma SQLite, zero FK, existing worker and authenticated HTTP.

- [x] Persist stage charges and a review-required reservation flag. True unique(turnId,stage), no uniqueness on supplier response IDs or source hashes.
- [x] Normalize explicit account costs with decimal/BigInt math; preserve absence and currency mismatch. Preserve video usage before scene result overwrites it.
- [x] Settle complete terminal turns in the same transaction; cap release by stage/quote evidence, keep unknown holds, never re-submit providers. Record overrun conservatively and gate further dispatch.
- [x] Read-only cost DTO and original stage disclosure, separate account charge from metered tariff; free history/resume remain usable.
- [x] Verify actual SQLite worker, concurrency/restart/missing evidence/overrun/rollback and HTTP boundaries, then production browser. Update docs and existing branch.

Sources checked 2026-09-14: https://openrouter.ai/docs/cookbook/administration/usage-accounting (`cost` is account charge); https://platform.minimax.io/docs/api-reference/video-generation-v2-query (task usage, no final invoice field). Budget covers these configured provider accounts, not external BYOK provider bills, deposits, taxes or currency conversion. BYOK must not be silently treated as a complete account charge.
