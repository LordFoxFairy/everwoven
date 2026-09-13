import {createHash} from 'node:crypto';
import type {StoryVersionReadScope, StoryVersionWriteScope, StoryVersionRecord} from '../ports/story-version-store.js';
import type {InternalOwnerContext, MainCharacterDTO, StoryAssetSlots} from '../contracts/story-draft.js';
import type {FreezeStoryInput, StoryVersionDTO} from '../contracts/story-version.js';
import {parseFreezeStory, parseStoryVersionDTO} from '../contracts/story-version-validation.js';
import {parseOwner, parseId, parseOverrides} from '../contracts/story-draft-validation.js';
import {effectiveCharacter} from '../contracts/story-draft-output.js';
import {aggregateDTO, requiredDraft, versionDTO} from './story-draft-dto.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

const invalid = () => Error('STORED_STORY_VERSION_INVALID');
function authority(scope: StoryVersionReadScope, owner: InternalOwnerContext) {
  parseOwner(owner);
  if (scope.ownerId !== owner.ownerId) throw Error('OWNER_UNAVAILABLE');
}
function content(v: Pick<StoryVersionDTO, 'title' | 'settings' | 'mainCharacter' | 'assetSlots'>) {
  return [v.title, v.settings, v.mainCharacter, v.assetSlots];
}
/** Explicit canonical field order; credentials, mutable asset state and current defaults are absent. */
function hash(owner: InternalOwnerContext, v: Omit<StoryVersionDTO, 'contentHash'>) {
  return createHash('sha256').update(JSON.stringify([
    'everwoven.story-version.v1', owner.ownerId, v.protocolVersion, v.datasetId,
    v.id, v.storyDraftId, v.sourceRevision, v.versionNo, content(v), v.schemaVersion, v.createdAt, v.sealedAt,
  ])).digest('hex');
}
async function materialize(
  scope: StoryVersionReadScope, owner: InternalOwnerContext, row: StoryVersionRecord,
): Promise<StoryVersionDTO> {
  if (row.ownerId !== owner.ownerId || row.sealedAt === null || row.contentHash === null) throw invalid();
  const casts = await scope.findStoryCast(row.id), links = await scope.findStorySlots(row.id);
  let mainCharacter: MainCharacterDTO | null = null;
  const assetSlots: StoryAssetSlots = {cover: null, opening: null, character: null};
  try {
    if (casts.length > 1 || links.length > 3) throw invalid();
    if (casts.length) {
      const c = casts[0]!;
      parseId(c.id);
      parseId(c.characterVersionId);
      if (
        c.ownerId !== owner.ownerId || c.storyVersionId !== row.id || c.slotKey !== 'main' ||
        c.schemaVersion !== 1 || c.createdAt.getTime() !== row.createdAt.getTime()
      ) throw invalid();
      const record = await scope.findVersion(c.characterVersionId);
      if (!record) throw invalid();
      const version = versionDTO(record, owner), overrides = parseOverrides(c.overrides);
      mainCharacter = {version, overrides, effective: effectiveCharacter(version, overrides)};
    }
    for (const link of links) {
      parseId(link.id);
      parseId(link.assetId);
      if (
        link.ownerId !== owner.ownerId || link.storyVersionId !== row.id ||
        !Object.hasOwn(assetSlots, link.slotKey) || link.purpose !== link.slotKey ||
        link.createdAt.getTime() !== row.createdAt.getTime()
      ) throw invalid();
      const slot = link.slotKey as keyof StoryAssetSlots;
      if (assetSlots[slot] !== null) throw invalid();
      assetSlots[slot] = link.assetId;
    }
    const dto = parseStoryVersionDTO({
      protocolVersion: 1, datasetId: owner.datasetId, id: row.id, storyDraftId: row.storyDraftId,
      sourceRevision: row.sourceRevision, versionNo: row.versionNo, title: row.title, settings: row.settings,
      mainCharacter, assetSlots, schemaVersion: row.schemaVersion,
      createdAt: row.createdAt.toISOString(), sealedAt: row.sealedAt.toISOString(), contentHash: row.contentHash,
    });
    if (hash(owner, dto) !== dto.contentHash) throw invalid();
    return dto;
  } catch {
    throw invalid();
  }
}
export async function readStoryVersionInScope(
  scope: StoryVersionReadScope, owner: InternalOwnerContext, id: string,
): Promise<StoryVersionDTO> {
  authority(scope, owner);
  parseId(id);
  const row = await scope.findStoryVersion(id);
  if (!row) throw Error('STORY_VERSION_NOT_FOUND');
  if (row.id !== id) throw invalid();
  return materialize(scope, owner, row);
}

/** Caller owns the WriteGate transaction; no commit, public command, network or fee side effect here. */
export async function freezeStoryInScope(
  scope: StoryVersionWriteScope, owner: InternalOwnerContext, input: FreezeStoryInput,
  services: RuntimeServices = systemServices,
): Promise<StoryVersionDTO> {
  authority(scope, owner);
  const v = parseFreezeStory(input);
  if (v.datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');
  const row = await requiredDraft(scope, v.storyDraftId);
  if (row.revision !== v.expectedRevision) throw Error('REVISION_CONFLICT');
  if (row.archivedAt !== null) throw Error('STORY_ARCHIVED');
  const draft = await aggregateDTO(scope, owner, row);
  // New openings must recheck all retained references, even when reusing a sealed version.
  if (draft.assets.some(a => a.state !== 'present' || a.data.status !== 'ready' || a.data.deletedAt !== null))
    throw Error('STORY_ASSET_NOT_READY');
  const existing = await scope.findStoryVersionBySource(v.storyDraftId, v.expectedRevision);
  if (existing) {
    if (existing.storyDraftId !== v.storyDraftId || existing.sourceRevision !== v.expectedRevision) throw invalid();
    const sealed = await materialize(scope, owner, existing);
    if (JSON.stringify(content(sealed)) !== JSON.stringify(content(draft))) throw invalid();
    return sealed;
  }
  const versionNo = await scope.nextStoryVersionNo(v.storyDraftId);
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) throw invalid();
  if (versionNo > 2147483647) throw Error('REVISION_EXHAUSTED');
  const now = currentTime(services, row.updatedAt), id = nextId(services);
  const body: Omit<StoryVersionDTO, 'contentHash'> = {
    protocolVersion: 1, datasetId: owner.datasetId, id, storyDraftId: row.id,
    sourceRevision: row.revision, versionNo, title: draft.title, settings: draft.settings,
    mainCharacter: draft.mainCharacter, assetSlots: draft.assetSlots, schemaVersion: 1,
    createdAt: now.toISOString(), sealedAt: now.toISOString(),
  };
  const dto = parseStoryVersionDTO({...body, contentHash: hash(owner, body)});
  await scope.insertStoryVersion({
    id, storyDraftId: row.id, sourceRevision: row.revision, versionNo,
    title: draft.title, settings: draft.settings, schemaVersion: 1, createdAt: now,
  });
  await scope.insertStoryCast(id, draft.mainCharacter ? {
    id: nextId(services), characterVersionId: draft.mainCharacter.version.id,
    overrides: draft.mainCharacter.overrides, createdAt: now,
  } : null);
  const assets = [];
  for (const slotKey of ['cover', 'opening', 'character'] as const) {
    const assetId = draft.assetSlots[slotKey];
    if (assetId) assets.push({id: nextId(services), assetId, slotKey, createdAt: now});
  }
  await scope.insertStoryAssets(id, assets);
  if (await scope.sealStoryVersion(id, dto.contentHash, now) !== 1) throw invalid();
  // Verify persisted content before the caller commits the enclosing opening transaction.
  const stored = await readStoryVersionInScope(scope, owner, id);
  if (JSON.stringify(stored) !== JSON.stringify(dto)) throw invalid();
  return stored;
}
