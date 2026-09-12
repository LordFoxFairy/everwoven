import type {CharacterDTO, CharacterSettings} from '../contracts/character-template.js';
import type {StoryReceiptRecord} from './story-draft-store.js';

/** Storage JSON remains unknown until application validation; no owner/scope in public projections. */
export type CharacterRecord = {id: string; name: string; settings: unknown; portraitAssetId: string | null;
  schemaVersion: number; revision: number; createdAt: Date; updatedAt: Date; deletedAt: Date | null; archivedAt: Date | null};
export type CharacterInsert = Omit<CharacterRecord, 'settings' | 'schemaVersion' | 'revision'> & {settings: CharacterSettings; schemaVersion: 1; revision: 1};
export type CharacterFilter = {deleted: 'exclude' | 'only'; q: string};
export type CharacterListQuery = CharacterFilter & {take: number; before?: {updatedAt: Date; id: string}};
export type CharacterCAS = {id: string; expectedRevision: number; deleted: 'exclude' | 'only'; updatedAt: Date;
  patch: {name?: string; settings?: CharacterSettings; portraitAssetId?: string | null; deletedAt?: Date | null}};
export type CharacterReceiptInsert = {id: string; commandId: string; commandType: string; payloadHash: string; schemaVersion: 1; response: CharacterDTO; createdAt: Date};
export interface CharacterReadScope {
  findCharacter(id: string, includeDeleted?: boolean): Promise<CharacterRecord | null>;
  listCharacters(query: CharacterListQuery): Promise<CharacterRecord[]>;
  /** Same owner/library/deleted/q filter as list, but never restricted by cursor. */
  countCharacters(filter: CharacterFilter): Promise<number>;
}
export interface CharacterWriteScope extends CharacterReadScope {
  findReceipt(commandId: string): Promise<StoryReceiptRecord | null>;
  insertCharacter(input: CharacterInsert): Promise<CharacterRecord>;
  compareAndSwapCharacter(change: CharacterCAS): Promise<number>;
  /** Only an active, ready asset in this transaction's owner scope is eligible. No paths escape. */
  hasReadyPortrait(id: string): Promise<boolean>;
  insertReceipt(input: CharacterReceiptInsert): Promise<void>;
}
export interface CharacterStore {
  read<T>(ownerId: string, work: (scope: CharacterReadScope) => Promise<T>): Promise<T>;
  /** Acquire owner WriteGate before any receipt/CAS/reference lookup; all changes commit or roll back together. */
  write<T>(ownerId: string, work: (scope: CharacterWriteScope) => Promise<T>): Promise<T>;
}
