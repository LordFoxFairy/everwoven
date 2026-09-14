import type {StoryVersionReadScope, StoryVersionWriteScope} from './story-version-store.js';
import type {BindingSpec} from '../contracts/provider-binding.js';
import type {ExperienceOpeningDTO} from '../contracts/experience-opening.js';

export type StoredBinding = Omit<BindingSpec, 'parameters' | 'capabilities' | 'mode' | 'schemaVersion'> & {
  id: string; createdAt: Date; parameters: unknown; capabilities: unknown; mode: string; schemaVersion: number;
};
export type ExperienceRecord = {
  id: string; ownerId: string; storyVersionId: string; providerBindingVersionId: string;
  budgetScopeId: string | null; budgetLimitMicros: bigint; budgetCurrency: string; status: string; schedulingPaused: boolean;
  dispatchEpoch: number; revision: number; rowRevision: number;
  deletedAt: Date | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date;
};
export type SetupRecord = {
  id: string; ownerId: string; experienceId: string; kind: string; experienceRevision: number;
  options: unknown; schemaVersion: number; createdAt: Date;
};
export type OpeningDraftRecord = {
  id: string; ownerId: string; experienceId: string; interactionEventId: string;
  text: string; revision: number; createdAt: Date; updatedAt: Date;
};
export type OpeningReceiptRecord = {
  id: string; ownerId: string; commandId: string; commandType: string; payloadHash: string;
  schemaVersion: number; response: unknown; createdAt: Date;
};
export interface ExperienceOpeningReadScope extends StoryVersionReadScope {
  listExperiences(input: {take: number; before?: {updatedAt: Date; id: string}}): Promise<ExperienceRecord[]>;
  findExperience(id: string): Promise<ExperienceRecord | null>;
  findBinding(id: string): Promise<StoredBinding | null>;
  findSetup(experienceId: string): Promise<SetupRecord | null>;
  findOpeningDrafts(interactionEventId: string): Promise<OpeningDraftRecord[]>;
  findOpeningReceiptById(id: string): Promise<OpeningReceiptRecord | null>;
}
export interface ExperienceOpeningWriteScope extends ExperienceOpeningReadScope, StoryVersionWriteScope {
  findOpeningReceipt(commandId: string): Promise<OpeningReceiptRecord | null>;
  findBindingByVersion(bindingKey: string, versionNo: number): Promise<StoredBinding | null>;
  insertBinding(binding: BindingSpec & {id: string; createdAt: Date}): Promise<void>;
  insertExperience(input: ExperienceRecord): Promise<void>;
  insertSetup(input: SetupRecord & {kind: 'setup'; options: []; schemaVersion: 1; experienceRevision: 1}): Promise<void>;
  insertResponseDraft(input: OpeningDraftRecord & {text: ''; revision: 1}): Promise<void>;
  insertOpeningReceipt(input: OpeningReceiptRecord & {response: ExperienceOpeningDTO; schemaVersion: 1}): Promise<void>;
}
export interface ExperienceOpeningStore {
  read<T>(ownerId: string, work: (scope: ExperienceOpeningReadScope) => Promise<T>): Promise<T>;
  write<T>(ownerId: string, work: (scope: ExperienceOpeningWriteScope) => Promise<T>): Promise<T>;
}
