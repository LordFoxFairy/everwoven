-- Immutable evidence for the single paid attempt per turn/text stage. No foreign keys.
CREATE TABLE "text_usage_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "store_epoch" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "binding_hash" TEXT NOT NULL,
    "observation" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "uq_text_usage_turn_stage" ON "text_usage_observations"("turn_id", "stage");
CREATE INDEX "ix_text_usage_owner" ON "text_usage_observations"("owner_id", "created_at", "id");
