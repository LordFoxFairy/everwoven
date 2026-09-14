-- Local route lineage and explicit inherited scene references; scalar IDs, zero FK.
ALTER TABLE "generation_turns" ADD COLUMN "input_savepoint_id" TEXT;
CREATE TABLE "new_savepoints" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "experience_id" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "parent_savepoint_id" TEXT,
 "source_turn_id" TEXT,
 "state_snapshot_id" TEXT NOT NULL,
 "interaction_event_id" TEXT NOT NULL,
 "playback_session_id" TEXT,
 "created_at" DATETIME NOT NULL,
 "schema_version" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "new_savepoints" SELECT * FROM "savepoints";
DROP TABLE "savepoints";
ALTER TABLE "new_savepoints" RENAME TO "savepoints";
CREATE UNIQUE INDEX "uq_savepoint_played_turn" ON "savepoints"("source_turn_id");
CREATE INDEX "ix_savepoints_experience" ON "savepoints"("owner_id", "experience_id", "created_at", "id");
CREATE INDEX "ix_savepoints_parent" ON "savepoints"("parent_savepoint_id");
CREATE INDEX "ix_savepoints_snapshot" ON "savepoints"("state_snapshot_id");
CREATE TABLE "experience_forks" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "root_experience_id" TEXT NOT NULL,
 "source_experience_id" TEXT NOT NULL,
 "source_savepoint_id" TEXT NOT NULL,
 "initial_savepoint_id" TEXT NOT NULL,
 "snapshot_hash" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL
);
CREATE INDEX "ix_experience_forks_root" ON "experience_forks"("owner_id", "root_experience_id", "created_at", "id");
CREATE INDEX "ix_experience_forks_source" ON "experience_forks"("source_savepoint_id");
CREATE TABLE "experience_scene_refs" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner_id" TEXT NOT NULL,
 "dataset_id" TEXT NOT NULL,
 "experience_id" TEXT NOT NULL,
 "savepoint_id" TEXT NOT NULL,
 "created_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "uq_experience_scene_ref" ON "experience_scene_refs"("experience_id", "savepoint_id");
CREATE INDEX "ix_scene_refs_savepoint" ON "experience_scene_refs"("savepoint_id");
