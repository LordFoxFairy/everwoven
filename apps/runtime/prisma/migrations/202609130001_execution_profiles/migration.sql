-- Immutable execution profiles; references enforced by the owner WriteGate, no foreign keys.
CREATE TABLE "execution_profile_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "profile_key" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "planner_binding_version_id" TEXT NOT NULL,
    "video_binding_version_id" TEXT NOT NULL,
    "validator_binding_version_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "uq_execution_profiles_version" ON "execution_profile_versions"("owner_id", "profile_key", "version_no");
