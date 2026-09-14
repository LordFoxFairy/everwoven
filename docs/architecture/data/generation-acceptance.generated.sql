-- Atomic generation acceptance; no foreign keys or ORM relations.
ALTER TABLE "experiences" ADD COLUMN "budget_scope_id" TEXT;

CREATE TABLE "generation_quotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "store_epoch" TEXT NOT NULL,
    "experience_id" TEXT NOT NULL,
    "experience_revision" INTEGER NOT NULL,
    "interaction_event_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "max_cost_micros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "accepted_turn_id" TEXT,
    "created_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ix_generation_quotes_experience" ON "generation_quotes"("owner_id", "experience_id", "created_at", "id");

CREATE TABLE "budget_scopes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "limit_micros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
);

CREATE TABLE "generation_turns" (
    "parent_turn_id" TEXT,
    "prepared" JSONB,
    "provider_reference" JSONB,
    "media" JSONB,
    "result" JSONB,
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "experience_id" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "interaction_event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "uq_generation_turn_quote" ON "generation_turns"("quote_id");
CREATE INDEX "ix_generation_turn_experience" ON "generation_turns"("owner_id", "experience_id", "created_at", "id");

CREATE TABLE "budget_reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "experience_id" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "reserved_micros" BIGINT NOT NULL,
    "settled_micros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ix_budget_reservation_scope" ON "budget_reservations"("budget_scope_id", "status");
CREATE INDEX "ix_budget_reservation_experience" ON "budget_reservations"("owner_id", "experience_id");

CREATE TABLE "runtime_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "available_at" DATETIME NOT NULL,
    "lease_until" DATETIME,
    "lease_token" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ix_runtime_outbox_ready" ON "runtime_outbox"("status", "available_at", "id");

CREATE INDEX "ix_generation_turn_parent" ON "generation_turns"("parent_turn_id");
