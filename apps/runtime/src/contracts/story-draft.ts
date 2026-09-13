import type {CharacterSettings} from './character-template.js';
import type {AssetDTO} from './asset.js';
export const STORY_MUTATION_MAX_BYTES = 2 * 1024 * 1024;
export type StoryProtocol = {protocolVersion: 1; datasetId: string};
export type StorySettings = {
  world: string;
  opening: string;
  genre: string;
  playerRole: string;
  worldRules: string[];
  tone: string;
};
export type PortraitOverride = {mode: 'inherit'} | {mode: 'none'} | {mode: 'asset'; assetId: string};
export type CharacterOverrides = {
  portrait: PortraitOverride;
  relationship: string;
  name?: string;
  settings?: Partial<CharacterSettings>;
};
export type StoryAssetSlots = {cover: string | null; opening: string | null; character: string | null};
export type MainCharacterInput =
  | {kind: 'library'; templateId: string; expectedTemplateRevision: number; overrides: CharacterOverrides}
  | {kind: 'bound'; characterVersionId: string; overrides: CharacterOverrides}
  | {
      kind: 'inline';
      name: string;
      settings: CharacterSettings;
      portraitAssetId: string | null;
      overrides: CharacterOverrides;
    };
export type DraftCreate = StoryProtocol & {
  commandId: string;
  title: string;
  settings: StorySettings;
  mainCharacter: Exclude<MainCharacterInput, {kind: 'bound'}> | null;
  assetSlots: StoryAssetSlots;
};
export type DraftUpdate = StoryProtocol & {
  commandId: string;
  id: string;
  expectedRevision: number;
  patch: {
    title?: string;
    settings?: StorySettings;
    mainCharacter?: MainCharacterInput | null;
    assetSlots?: StoryAssetSlots;
  };
};
export type DraftGet = StoryProtocol & {id: string; includeDeleted?: boolean};
export type DraftLifecycle = StoryProtocol & {commandId: string; id: string; expectedRevision: number};
export type DraftListInput = StoryProtocol & {
  limit?: number;
  deleted?: 'exclude' | 'only';
  q?: string;
  genre?: string;
  cursor?: string;
};
export type CharacterVersionDTO = {
  id: string;
  characterTemplateId: string;
  versionNo: number;
  sourceRevision: number;
  name: string;
  settings: CharacterSettings;
  portraitAssetId: string | null;
  schemaVersion: 1;
  createdAt: string;
};
export type MainCharacterDTO = {
  version: CharacterVersionDTO;
  overrides: CharacterOverrides;
  effective: {name: string; settings: CharacterSettings; relationship: string; portraitAssetId: string | null};
};
export type StoryAssetView = {state: 'present'; data: AssetDTO} | {state: 'missing'; id: string; datasetId: string};
export type DraftDTO = StoryProtocol & {
  id: string;
  title: string;
  settings: StorySettings;
  mainCharacter: MainCharacterDTO | null;
  assetSlots: StoryAssetSlots;
  assets: StoryAssetView[];
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
};
export type DraftSummaryDTO = StoryProtocol & {
  id: string;
  title: string;
  genre: string;
  mainCharacterName: string | null;
  coverAssetId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
};
export type DraftPage = StoryProtocol & {items: DraftSummaryDTO[]; nextCursor: string | null; totalMatching: number};
export type DraftCommandResult = {data: DraftDTO; replayed: boolean};
/** Trusted internal caller only, never an HTTP authority claim. */
export type InternalOwnerContext = {readonly ownerId: string; readonly datasetId: string};
