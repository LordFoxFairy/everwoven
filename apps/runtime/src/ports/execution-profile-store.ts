import type {ExecutionBindingRecord} from '../contracts/provider-binding.js';
import type {ExecutionProfileSpec} from '../contracts/execution-profile.js';
import type {StoredBinding} from './experience-opening-store.js';

export type ProfileRecord = {
  id: string; ownerId: string; profileKey: string; versionNo: number;
  plannerBindingVersionId: string; videoBindingVersionId: string; validatorBindingVersionId: string;
  snapshot: unknown; contentHash: string; schemaVersion: number; createdAt: Date;
};
export type PinnedProfile = Omit<ProfileRecord, 'snapshot' | 'schemaVersion'> & {snapshot: ExecutionProfileSpec; schemaVersion: 1};
export interface ExecutionProfileReadScope {
  findBinding(id: string): Promise<StoredBinding | null>;
  findProfile(id: string): Promise<ProfileRecord | null>;
}
export interface ExecutionProfileWriteScope extends ExecutionProfileReadScope {
  findBindingByVersion(bindingKey: string, versionNo: number): Promise<StoredBinding | null>;
  insertBinding(binding: ExecutionBindingRecord): Promise<void>;
  findProfileByVersion(profileKey: string, versionNo: number): Promise<ProfileRecord | null>;
  insertProfile(profile: PinnedProfile): Promise<void>;
}
export interface ExecutionProfileStore {
  read<T>(ownerId: string, work: (scope: ExecutionProfileReadScope) => Promise<T>): Promise<T>;
  write<T>(ownerId: string, work: (scope: ExecutionProfileWriteScope) => Promise<T>): Promise<T>;
}
