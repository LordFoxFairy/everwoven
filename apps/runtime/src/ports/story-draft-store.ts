import type {
  DraftDTO,
  StorySettings,
  CharacterOverrides,
  StoryAssetSlots,
} from '../contracts/story-draft.js';
import type {CharacterSettings} from '../contracts/character-template.js';
import type {AssetRecord} from './asset-store.js';
export type StoryDraftRecord = {
  id: string;
  title: string;
  settings: unknown;
  schemaVersion: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
};
/** Shared receipt metadata is also used by the existing character port. */
export type StoryReceiptRecord = {commandType: string; payloadHash: string; schemaVersion: number; response: unknown};
/** Aggregate create identity comes from this independently selected receipt primary key. */
export type DraftReceiptRecord = StoryReceiptRecord & {id: string};
export type StoryDraftInsert = Omit<StoryDraftRecord, 'settings' | 'schemaVersion' | 'revision'> & {
  settings: StorySettings;
  schemaVersion: 1;
  revision: 1;
};
export type StoryReceiptInsert = {
  id: string;
  commandId: string;
  commandType: string;
  payloadHash: string;
  schemaVersion: 1;
  response: DraftDTO;
  createdAt: Date;
};
export type StoryDraftFilter = {deleted: 'exclude' | 'only'; q: string; genre?: string};
export type StoryDraftListQuery = StoryDraftFilter & {take: number; before?: {updatedAt: Date; id: string}};
export type StorySummaryRecord = {
  id: string;
  title: string;
  genre: unknown;
  mainCharacterName: unknown;
  coverAssetId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
  schemaVersion: number;
};
export type StoryDraftCAS = {
  id: string;
  expectedRevision: number;
  deleted: 'exclude' | 'only';
  patch: {title?: string; settings?: StorySettings; deletedAt?: Date | null};
  updatedAt: Date;
};
export type StoryTemplateRecord = {
  id: string;
  ownerId: string;
  scope: string;
  sourceStoryDraftId: string | null;
  name: string;
  settings: unknown;
  portraitAssetId: string | null;
  schemaVersion: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archivedAt: Date | null;
};
export type StoryTemplateInsert = Omit<StoryTemplateRecord, 'settings'> & {settings: CharacterSettings};
export type StoryCharacterVersionRecord = {
  id: string;
  ownerId: string;
  characterTemplateId: string;
  versionNo: number;
  sourceRevision: number;
  name: string;
  settings: unknown;
  portraitAssetId: string | null;
  schemaVersion: number;
  createdAt: Date;
};
export type StoryCharacterVersionInsert = Omit<StoryCharacterVersionRecord, 'settings'> & {settings: CharacterSettings};
export type StoryCastRecord = {
  id: string;
  ownerId: string;
  storyDraftId: string;
  characterVersionId: string;
  slotKey: string;
  overrides: unknown;
  schemaVersion: number;
  createdAt: Date;
};
export type StoryAssetSlotRecord = {
  id: string;
  ownerId: string;
  storyDraftId: string;
  assetId: string;
  slotKey: string;
  purpose: string;
  createdAt: Date;
};
export interface StoryDraftReadScope {
  findDraft(id: string, includeDeleted?: boolean): Promise<StoryDraftRecord | null>;
  listDrafts(query: StoryDraftListQuery): Promise<StorySummaryRecord[]>;
  countDrafts(filter: StoryDraftFilter): Promise<number>;
  findCast(storyDraftId: string): Promise<StoryCastRecord[]>;
  findSlots(storyDraftId: string): Promise<StoryAssetSlotRecord[]>;
  findVersion(id: string): Promise<StoryCharacterVersionRecord | null>;
  findAsset(id: string): Promise<AssetRecord | null>;
}
export interface StoryDraftWriteScope extends StoryDraftReadScope {
  findReceipt(commandId: string): Promise<DraftReceiptRecord | null>;
  insertDraft(input: StoryDraftInsert): Promise<StoryDraftRecord>;
  compareAndSwapDraft(input: StoryDraftCAS): Promise<number>;
  insertReceipt(input: StoryReceiptInsert): Promise<void>;
  findTemplate(id: string): Promise<StoryTemplateRecord | null>;
  findVersionBySource(templateId: string, revision: number): Promise<StoryCharacterVersionRecord | null>;
  nextVersionNo(templateId: string): Promise<number>;
  insertVersion(input: StoryCharacterVersionInsert): Promise<StoryCharacterVersionRecord>;
  insertTemplate(input: StoryTemplateInsert): Promise<StoryTemplateRecord>;
  updateTemplate(
    id: string,
    expectedRevision: number,
    input: {name: string; settings: CharacterSettings; portraitAssetId: string | null; updatedAt: Date},
  ): Promise<number>;
  writeCast(
    storyId: string,
    cast: {id: string; characterVersionId: string; overrides: CharacterOverrides; createdAt: Date} | null,
  ): Promise<void>;
  writeSlots(storyId: string, slots: StoryAssetSlots, newId: () => string, createdAt: Date): Promise<void>;
}
export interface StoryDraftStore {
  /** An active owner and a single snapshot for root, cast, versions and asset metadata. */
  read<T>(ownerId: string, work: (scope: StoryDraftReadScope) => Promise<T>): Promise<T>;
  /** Gate before any receipt/CAS/ref query; all aggregate mutations share one transaction. */
  write<T>(ownerId: string, work: (scope: StoryDraftWriteScope) => Promise<T>): Promise<T>;
}
