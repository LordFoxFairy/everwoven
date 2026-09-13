import type {FreezeStoryInput, StoryVersionDTO} from './story-version.js';
import {
  fields, parseProtocol, parseId, parseRevision, parseTitle,
  parseSettings, parseSlots, assertPortraitSlots,
} from './story-draft-validation.js';
import {parseMainCharacterDTO} from './story-draft-output.js';
import {isTimestamp} from './primitives.js';

export function parseFreezeStory(value: unknown): FreezeStoryInput {
  const protocol = parseProtocol(value);
  fields(value, ['protocolVersion', 'datasetId', 'storyDraftId', 'expectedRevision']);
  return {...protocol, storyDraftId: parseId(value.storyDraftId), expectedRevision: parseRevision(value.expectedRevision)};
}

export function parseStoryVersionDTO(value: unknown): StoryVersionDTO {
  try {
    fields(value, [
      'protocolVersion', 'datasetId', 'id', 'storyDraftId', 'sourceRevision', 'versionNo',
      'title', 'settings', 'mainCharacter', 'assetSlots', 'schemaVersion', 'createdAt', 'sealedAt', 'contentHash',
    ]);
    const mainCharacter = parseMainCharacterDTO(value.mainCharacter), assetSlots = parseSlots(value.assetSlots);
    assertPortraitSlots(mainCharacter, assetSlots);
    if (
      value.schemaVersion !== 1 || !isTimestamp(value.createdAt) || !isTimestamp(value.sealedAt) ||
      value.sealedAt < value.createdAt || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash)
    ) throw Error();
    return {
      ...parseProtocol(value),
      id: parseId(value.id),
      storyDraftId: parseId(value.storyDraftId),
      sourceRevision: parseRevision(value.sourceRevision),
      versionNo: parseRevision(value.versionNo),
      title: parseTitle(value.title),
      settings: parseSettings(value.settings),
      mainCharacter,
      assetSlots,
      schemaVersion: 1,
      createdAt: value.createdAt,
      sealedAt: value.sealedAt,
      contentHash: value.contentHash,
    };
  } catch {
    throw Error('INVALID_STORY_VERSION_DTO');
  }
}
