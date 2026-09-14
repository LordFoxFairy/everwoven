ALTER TABLE "budget_reservations" ADD COLUMN "review_required" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "stage_cost_evidence" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "store_epoch" TEXT NOT NULL,
 "turn_id" TEXT NOT NULL,
 "quote_id" TEXT NOT NULL,
 "stage" TEXT NOT NULL,
 "binding_hash" TEXT NOT NULL,
 "basis" TEXT NOT NULL,
 "amount_micros" BIGINT,
 "currency" TEXT NOT NULL,
 "evidence" JSONB NOT NULL,
 "content_hash" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL,
 "schema_version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "uq_stage_cost_turn_stage" ON "stage_cost_evidence"("turn_id", "stage");
CREATE INDEX "ix_stage_cost_owner" ON "stage_cost_evidence"("owner_id", "created_at", "id");
