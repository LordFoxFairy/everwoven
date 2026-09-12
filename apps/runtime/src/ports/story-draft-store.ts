import type {DraftDTO, DraftSettings} from '../contracts/story-draft.js';

/** Storage records are not DTOs: JSON must pass application schema validation. */
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
export type StoryReceiptRecord = {
  commandType: string;
  payloadHash: string;
  schemaVersion: number;
  response: unknown;
};
export type StoryDraftInsert = Omit<StoryDraftRecord, 'settings' | 'schemaVersion' | 'revision'> & {
  settings: DraftSettings;
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
export type StoryDraftListQuery = {
  deleted: 'exclude' | 'only';
  take: number;
  before?: {updatedAt: Date; id: string};
};
export type StoryDraftCAS = {
  id: string;
  expectedRevision: number;
  deleted: 'exclude' | 'only';
  patch: {title?: string; settings?: DraftSettings; deletedAt?: Date | null};
  updatedAt: Date;
};

/** Every operation is bound to the owner and transaction supplied by Store. */
export interface StoryDraftReadScope {
  findDraft(id: string, includeDeleted?: boolean): Promise<StoryDraftRecord | null>;
  /** Descending (updatedAt, id), strictly after `before`, returning at most `take`. */
  listDrafts(query: StoryDraftListQuery): Promise<StoryDraftRecord[]>;
}
export interface StoryDraftWriteScope extends StoryDraftReadScope {
  findReceipt(commandId: string): Promise<StoryReceiptRecord | null>;
  insertDraft(draft: StoryDraftInsert): Promise<StoryDraftRecord>;
  /** Match owner, ID, revision and deletion state; increment revision once; return affected count. */
  compareAndSwapDraft(change: StoryDraftCAS): Promise<number>;
  insertReceipt(receipt: StoryReceiptInsert): Promise<void>;
}
export interface StoryDraftStore {
  /** Validate active owner and run all reads in one snapshot. Scope must not escape the callback. */
  read<T>(ownerId: string, work: (scope: StoryDraftReadScope) => Promise<T>): Promise<T>;
  /** Acquire WriteGate first. Drafts, receipts and Gate commit/roll back together on callback completion. */
  write<T>(ownerId: string, work: (scope: StoryDraftWriteScope) => Promise<T>): Promise<T>;
}
