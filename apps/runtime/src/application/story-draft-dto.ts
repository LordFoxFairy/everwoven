import type {
  DraftDTO,
  MainCharacterDTO,
  InternalOwnerContext,
  CharacterVersionDTO,
  StoryAssetView,
} from '../contracts/story-draft.js';
import type {StoryDraftReadScope, StoryDraftRecord, StoryCharacterVersionRecord} from '../ports/story-draft-store.js';
import type {AssetRecord} from '../ports/asset-store.js';
import {parseCharacterVersionDTO, parseDraftDTO, effectiveCharacter} from '../contracts/story-draft-output.js';
import {parseOverrides, parseId} from '../contracts/story-draft-validation.js';
import {parseAssetDTO} from '../contracts/asset-validation.js';
export async function requiredDraft(scope: StoryDraftReadScope, id: string, includeDeleted = false) {
  const row = await scope.findDraft(id, includeDeleted);
  if (!row) throw Error('STORY_NOT_FOUND');
  return row;
}
export function versionDTO(row: StoryCharacterVersionRecord, owner: InternalOwnerContext): CharacterVersionDTO {
  try {
    if (row.ownerId !== owner.ownerId) throw Error();
    return parseCharacterVersionDTO({
      id: row.id,
      characterTemplateId: row.characterTemplateId,
      versionNo: row.versionNo,
      sourceRevision: row.sourceRevision,
      name: row.name,
      settings: row.settings,
      portraitAssetId: row.portraitAssetId,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt.toISOString(),
    });
  } catch {
    throw Error('STORED_STORY_INVALID');
  }
}
export function assetDTO(row: AssetRecord, owner: InternalOwnerContext) {
  try {
    if (row.ownerId !== owner.ownerId || row.storageKey !== `assets/${owner.datasetId}/${row.id}.webp`) throw Error();
    return parseAssetDTO({
      id: row.id,
      datasetId: owner.datasetId,
      sha256: row.sha256,
      mimeType: row.mimeType,
      byteSize: String(row.byteSize),
      originalName: row.originalName,
      width: row.width,
      height: row.height,
      rightsDeclaration: row.rightsDeclaration,
      status: row.status,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      revision: row.revision,
    });
  } catch {
    throw Error('STORED_STORY_INVALID');
  }
}
export async function readyAsset(scope: StoryDraftReadScope, owner: InternalOwnerContext, id: string) {
  const row = await scope.findAsset(id);
  if (!row || row.ownerId !== owner.ownerId) throw Error('ASSET_NOT_FOUND');
  const dto = assetDTO(row, owner);
  if (dto.status !== 'ready' || dto.deletedAt !== null) throw Error('STORY_ASSET_NOT_READY');
}
export async function aggregateDTO(
  scope: StoryDraftReadScope,
  owner: InternalOwnerContext,
  row: StoryDraftRecord,
): Promise<DraftDTO> {
  const casts = await scope.findCast(row.id),
    links = await scope.findSlots(row.id);
  let mainCharacter: MainCharacterDTO | null = null;
  if (casts.length > 1) throw Error('STORED_STORY_INVALID');
  if (casts.length) {
    const c = casts[0]!;
    if (c.ownerId !== owner.ownerId || c.storyDraftId !== row.id || c.slotKey !== 'main' || c.schemaVersion !== 1)
      throw Error('STORED_STORY_INVALID');
    let overrides;
    try {
      parseId(c.id);
      parseId(c.characterVersionId);
      overrides = parseOverrides(c.overrides);
    } catch {
      throw Error('STORED_STORY_INVALID');
    }
    const record = await scope.findVersion(c.characterVersionId);
    if (!record) throw Error('STORED_STORY_INVALID');
    const version = versionDTO(record, owner);
    mainCharacter = {version, overrides, effective: effectiveCharacter(version, overrides)};
  }
  const assetSlots: DraftDTO['assetSlots'] = {cover: null, opening: null, character: null};
  for (const link of links) {
    if (
      link.ownerId !== owner.ownerId ||
      link.storyDraftId !== row.id ||
      !Object.hasOwn(assetSlots, link.slotKey) ||
      link.purpose !== link.slotKey ||
      assetSlots[link.slotKey as keyof typeof assetSlots] !== null
    )
      throw Error('STORED_STORY_INVALID');
    try {
      parseId(link.id);
      assetSlots[link.slotKey as keyof typeof assetSlots] = parseId(link.assetId);
    } catch {
      throw Error('STORED_STORY_INVALID');
    }
  }
  const ids = [
    ...new Set(
      [...Object.values(assetSlots), mainCharacter?.version.portraitAssetId].filter(
        (x): x is string => typeof x === 'string',
      ),
    ),
  ].sort();
  const assets: StoryAssetView[] = [];
  for (const id of ids) {
    const asset = await scope.findAsset(id);
    assets.push(
      asset ? {state: 'present', data: assetDTO(asset, owner)} : {state: 'missing', id, datasetId: owner.datasetId},
    );
  }
  try {
    return parseDraftDTO({
      protocolVersion: 1,
      datasetId: owner.datasetId,
      id: row.id,
      title: row.title,
      settings: row.settings,
      mainCharacter,
      assetSlots,
      assets,
      schemaVersion: row.schemaVersion,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
    });
  } catch {
    throw Error('STORED_STORY_INVALID');
  }
}
