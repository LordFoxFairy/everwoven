-- Playback attempts are mutable; snapshots and played savepoints are immutable.
-- All references are scalar IDs. No foreign keys or relation triggers.
CREATE TABLE "playback_sessions" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "store_epoch" TEXT NOT NULL,
 "experience_id" TEXT NOT NULL,
 "experience_revision" INTEGER NOT NULL,
 "turn_id" TEXT NOT NULL,
 "media_id" TEXT NOT NULL,
 "media_hash" TEXT NOT NULL,
 "duration_ms" INTEGER NOT NULL,
 "covered_ms" INTEGER NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'active',
 "sequence" INTEGER NOT NULL DEFAULT 0,
 "last_position_ms" INTEGER NOT NULL DEFAULT 0,
 "started_at" DATETIME NOT NULL,
 "updated_at" DATETIME NOT NULL,
 "expires_at" DATETIME NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX "ix_playback_sessions_turn" ON "playback_sessions"("owner_id", "turn_id", "status");
CREATE TABLE "state_snapshots" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "state" JSONB NOT NULL,
 "content_hash" TEXT NOT NULL,
 "schema_version" INTEGER NOT NULL DEFAULT 1,
 "created_at" DATETIME NOT NULL
);
CREATE TABLE "savepoints" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "experience_id" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "parent_savepoint_id" TEXT,
 "source_turn_id" TEXT NOT NULL,
 "state_snapshot_id" TEXT NOT NULL,
 "interaction_event_id" TEXT NOT NULL,
 "playback_session_id" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL,
 "schema_version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "uq_savepoint_played_turn" ON "savepoints"("source_turn_id");
CREATE INDEX "ix_savepoints_experience" ON "savepoints"("owner_id", "experience_id", "created_at", "id");
CREATE INDEX "ix_savepoints_parent" ON "savepoints"("parent_savepoint_id");
CREATE INDEX "ix_savepoints_snapshot" ON "savepoints"("state_snapshot_id");
