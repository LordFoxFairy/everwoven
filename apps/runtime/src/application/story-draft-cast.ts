import type {StoryDraftWriteScope, StoryTemplateRecord} from '../ports/story-draft-store.js';
import type {
  MainCharacterInput,
  MainCharacterDTO,
  InternalOwnerContext,
  DraftDTO,
  CharacterVersionDTO,
  StoryAssetSlots,
} from '../contracts/story-draft.js';
import {
  parseCharacterFields,
  parseTitle,
  parseId,
  parseRevision,
  assertPortraitSlots,
} from '../contracts/story-draft-validation.js';
import {effectiveCharacter} from '../contracts/story-draft-output.js';
import {versionDTO, readyAsset} from './story-draft-dto.js';
import {nextId, type RuntimeServices} from './runtime-services.js';
function content(t: StoryTemplateRecord, owner: InternalOwnerContext) {
  try {
    if (
      t.ownerId !== owner.ownerId ||
      t.schemaVersion !== 1 ||
      !['library', 'story'].includes(t.scope) ||
      (t.scope === 'library' ? t.sourceStoryDraftId !== null : !t.sourceStoryDraftId)
    )
      throw Error();
    parseId(t.id);
    if (t.sourceStoryDraftId) parseId(t.sourceStoryDraftId);
    return {
      name: parseTitle(t.name),
      settings: parseCharacterFields(t.settings, false),
      portraitAssetId: t.portraitAssetId === null ? null : parseId(t.portraitAssetId),
      sourceRevision: parseRevision(t.revision),
    };
  } catch {
    throw Error('STORED_STORY_INVALID');
  }
}
const fixed = (v: CharacterVersionDTO) => ({
  name: v.name,
  settings: v.settings,
  portraitAssetId: v.portraitAssetId,
  sourceRevision: v.sourceRevision,
});
async function freeze(
  scope: StoryDraftWriteScope,
  owner: InternalOwnerContext,
  t: StoryTemplateRecord,
  now: Date,
  services: RuntimeServices,
) {
  const data = content(t, owner),
    old = await scope.findVersionBySource(t.id, t.revision);
  if (old) {
    const dto = versionDTO(old, owner);
    if (dto.characterTemplateId !== t.id || JSON.stringify(fixed(dto)) !== JSON.stringify(data))
      throw Error('STORED_STORY_INVALID');
    return dto;
  }
  const versionNo = await scope.nextVersionNo(t.id);
  if (!Number.isSafeInteger(versionNo) || versionNo < 1 || versionNo > 2147483647) throw Error('REVISION_EXHAUSTED');
  return versionDTO(
    await scope.insertVersion({
      id: nextId(services),
      ownerId: owner.ownerId,
      characterTemplateId: t.id,
      versionNo,
      ...data,
      schemaVersion: 1,
      createdAt: now,
    }),
    owner,
  );
}
export async function prepareMain(
  scope: StoryDraftWriteScope,
  owner: InternalOwnerContext,
  rootId: string,
  input: MainCharacterInput | null,
  old: MainCharacterDTO | null,
  now: Date,
  services: RuntimeServices,
): Promise<{main: MainCharacterDTO | null; sameBinding: boolean}> {
  if (input === null) return {main: null, sameBinding: old === null};
  let version: CharacterVersionDTO,
    sameBinding = false;
  if (input.kind === 'bound') {
    if (!old || old.version.id !== input.characterVersionId) throw Error('INVALID_STORY_COMMAND');
    version = old.version;
    sameBinding = true;
  } else if (input.kind === 'library') {
    const t = await scope.findTemplate(input.templateId);
    if (!t || t.ownerId !== owner.ownerId || t.scope !== 'library' || t.deletedAt !== null || t.archivedAt !== null)
      throw Error('CHARACTER_NOT_FOUND');
    content(t, owner);
    if (t.revision !== input.expectedTemplateRevision) throw Error('TEMPLATE_REVISION_CONFLICT');
    version = await freeze(scope, owner, t, now, services);
    sameBinding = old?.version.id === version.id;
  } else {
    let t: StoryTemplateRecord | null = null;
    if (old) {
      const candidate = await scope.findTemplate(old.version.characterTemplateId);
      if (!candidate) throw Error('STORED_STORY_INVALID');
      content(candidate, owner);
      if (candidate.scope === 'story') {
        if (
          candidate.sourceStoryDraftId !== rootId ||
          candidate.deletedAt !== null ||
          candidate.archivedAt !== null ||
          JSON.stringify(content(candidate, owner)) !== JSON.stringify(fixed(old.version))
        )
          throw Error('STORED_STORY_INVALID');
        t = candidate;
        sameBinding = true;
      }
    }
    if (t) {
      const changed =
        JSON.stringify({name: input.name, settings: input.settings, portraitAssetId: input.portraitAssetId}) !==
        JSON.stringify({
          name: t.name,
          settings: parseCharacterFields(t.settings, false),
          portraitAssetId: t.portraitAssetId,
        });
      if (changed) {
        if (t.revision >= 2147483647) throw Error('REVISION_EXHAUSTED');
        if (
          (await scope.updateTemplate(t.id, t.revision, {
            name: input.name,
            settings: input.settings,
            portraitAssetId: input.portraitAssetId,
            updatedAt: now,
          })) !== 1
        )
          throw Error('REVISION_CONFLICT');
        t = {
          ...t,
          name: input.name,
          settings: input.settings,
          portraitAssetId: input.portraitAssetId,
          revision: t.revision + 1,
          updatedAt: now,
        };
      }
    } else {
      if (input.portraitAssetId !== null) throw Error('INVALID_STORY_COMMAND');
      t = await scope.insertTemplate({
        id: nextId(services),
        ownerId: owner.ownerId,
        scope: 'story',
        sourceStoryDraftId: rootId,
        name: input.name,
        settings: input.settings,
        portraitAssetId: null,
        schemaVersion: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        archivedAt: null,
      });
    }
    version = await freeze(scope, owner, t, now, services);
  }
  return {
    main: {version, overrides: input.overrides, effective: effectiveCharacter(version, input.overrides)},
    sameBinding,
  };
}
export async function validateReferences(
  scope: StoryDraftWriteScope,
  owner: InternalOwnerContext,
  old: DraftDTO | null,
  main: MainCharacterDTO | null,
  slots: StoryAssetSlots,
  sameBinding: boolean,
) {
  assertPortraitSlots(main, slots);
  for (const key of ['cover', 'opening', 'character'] as const) {
    const id = slots[key];
    if (id && (old?.assetSlots[key] !== id || (key === 'character' && !sameBinding)))
      await readyAsset(scope, owner, id);
  }
  const base = main?.version.portraitAssetId;
  if (base && (!sameBinding || old?.mainCharacter?.version.portraitAssetId !== base))
    await readyAsset(scope, owner, base);
}
