import type {StoryProtocol, StorySettings, MainCharacterDTO, StoryAssetSlots} from './story-draft.js';

/** Internal step of an explicit opening transaction, not a separate public publish command. */
export type FreezeStoryInput = StoryProtocol & {storyDraftId: string; expectedRevision: number};
export type StoryVersionDTO = StoryProtocol & {
  id: string;
  storyDraftId: string;
  sourceRevision: number;
  versionNo: number;
  title: string;
  settings: StorySettings;
  mainCharacter: MainCharacterDTO | null;
  assetSlots: StoryAssetSlots;
  schemaVersion: 1;
  createdAt: string;
  sealedAt: string;
  contentHash: string;
};
