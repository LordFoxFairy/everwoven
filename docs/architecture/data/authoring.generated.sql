-- CreateTable
CREATE TABLE "local_profiles" (
    "write_epoch" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "command_receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_drafts" (
    "deleted_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "story_versions" (
    "sealed_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_draft_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "content_hash" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "original_name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "rights_declaration" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "character_templates" (
    "scope" TEXT NOT NULL DEFAULT 'library',
    "source_story_draft_id" TEXT,
    "deleted_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "portrait_asset_id" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "character_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "character_template_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "portrait_asset_id" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_draft_cast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_draft_id" TEXT NOT NULL,
    "character_version_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "overrides" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_draft_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_draft_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_version_cast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_version_id" TEXT NOT NULL,
    "character_version_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "overrides" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "story_version_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_version_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "provider_binding_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "binding_key" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "provider_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "adapter_version" TEXT NOT NULL,
    "capability_version" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "credential_ref" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "experiences" (
    "budget_limit_micros" BIGINT NOT NULL,
    "budget_currency" TEXT NOT NULL,
    "deleted_at" DATETIME,
    "row_revision" INTEGER NOT NULL DEFAULT 1,
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "story_version_id" TEXT NOT NULL,
    "provider_binding_version_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "scheduling_paused" BOOLEAN NOT NULL DEFAULT true,
    "dispatch_epoch" INTEGER NOT NULL DEFAULT 0,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "interaction_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "experience_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "experience_revision" INTEGER NOT NULL,
    "options" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "response_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "experience_id" TEXT NOT NULL,
    "interaction_event_id" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "asset_uploads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "input_sha256" TEXT NOT NULL,
    "input_byte_size" BIGINT NOT NULL,
    "original_name" TEXT NOT NULL,
    "rights_declaration" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output_sha256" TEXT,
    "output_byte_size" BIGINT,
    "output_width" INTEGER,
    "output_height" INTEGER,
    "processing_token" TEXT,
    "lease_expires_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_command_receipts_owner_command" ON "command_receipts"("owner_id", "command_id");

-- CreateIndex
CREATE INDEX "ix_story_drafts_owner_list" ON "story_drafts"("owner_id", "deleted_at", "archived_at", "updated_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_versions_number" ON "story_versions"("story_draft_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_versions_source" ON "story_versions"("story_draft_id", "source_revision");

-- CreateIndex
CREATE INDEX "ix_assets_owner_hash" ON "assets"("owner_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "uq_assets_storage_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "ix_character_templates_scope_list" ON "character_templates"("owner_id", "scope", "deleted_at", "updated_at", "id");

-- CreateIndex
CREATE INDEX "ix_character_templates_story" ON "character_templates"("owner_id", "source_story_draft_id");

-- CreateIndex
CREATE INDEX "ix_character_templates_portrait" ON "character_templates"("owner_id", "portrait_asset_id");

-- CreateIndex
CREATE INDEX "ix_character_versions_portrait" ON "character_versions"("owner_id", "portrait_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_character_versions_number" ON "character_versions"("character_template_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_character_versions_source" ON "character_versions"("character_template_id", "source_revision");

-- CreateIndex
CREATE INDEX "ix_story_draft_cast_character" ON "story_draft_cast"("owner_id", "character_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_draft_cast_slot" ON "story_draft_cast"("story_draft_id", "slot_key");

-- CreateIndex
CREATE INDEX "ix_story_draft_assets_asset" ON "story_draft_assets"("owner_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_draft_assets_slot" ON "story_draft_assets"("story_draft_id", "slot_key");

-- CreateIndex
CREATE INDEX "ix_story_version_cast_character" ON "story_version_cast"("owner_id", "character_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_version_cast_slot" ON "story_version_cast"("story_version_id", "slot_key");

-- CreateIndex
CREATE INDEX "ix_story_version_assets_asset" ON "story_version_assets"("owner_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_story_version_assets_slot" ON "story_version_assets"("story_version_id", "slot_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_provider_binding_versions_number" ON "provider_binding_versions"("owner_id", "binding_key", "version_no");

-- CreateIndex
CREATE INDEX "ix_experiences_owner_list" ON "experiences"("owner_id", "deleted_at", "archived_at", "updated_at", "id");

-- CreateIndex
CREATE INDEX "ix_experiences_story_version" ON "experiences"("owner_id", "story_version_id");

-- CreateIndex
CREATE INDEX "ix_experiences_binding" ON "experiences"("owner_id", "provider_binding_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_interaction_events_revision" ON "interaction_events"("experience_id", "experience_revision");

-- CreateIndex
CREATE UNIQUE INDEX "uq_response_drafts_node" ON "response_drafts"("owner_id", "interaction_event_id");

-- CreateIndex
CREATE INDEX "ix_asset_uploads_recovery" ON "asset_uploads"("status", "lease_expires_at", "id");

-- CreateIndex
CREATE INDEX "ix_asset_uploads_owner" ON "asset_uploads"("owner_id", "created_at", "id");

-- Nonunique identity lookup for cleanup T1/T2; duplicate intents remain detectable.
CREATE INDEX "ix_asset_uploads_asset" ON "asset_uploads"("asset_id");
