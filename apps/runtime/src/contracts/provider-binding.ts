import type {InternalOwnerContext} from './story-draft.js';

export type BindingJson = null | boolean | number | string | BindingJson[] | {[key: string]: BindingJson};
export type BindingSpec = {
  ownerId: string; bindingKey: string; versionNo: number;
  providerId: string; modelId: string; adapterVersion: string; capabilityVersion: string;
  mode: 'job' | 'realtime'; credentialRef: string;
  parameters: {
    schemaVersion: 1; connectionId: string; region: string; endpointProfileId: string;
    providerAccountScopeId: string; catalogId: string; operationKind: string; protocolVersion: string;
    generation: {[key: string]: BindingJson};
  };
  /** Opaque here, not permission to execute. The version-specific policy must decode it before quoting. */
  capabilities: {schemaVersion: 1; [key: string]: BindingJson};
  schemaVersion: 1;
};
export type BindingRecord = BindingSpec & {id: string; createdAt: Date};
export type PublicBinding = {
  id: string; bindingKey: string; versionNo: number; providerId: string; modelId: string;
  mode: 'job' | 'realtime'; connectionId: string; region: string;
  adapterVersion: string; capabilityVersion: string; snapshotHash: string;
};
/** A synchronous bounded local registry; never read secrets or call networks in the WriteGate. */
export interface BindingResolver {
  resolve(owner: InternalOwnerContext, selection: {bindingKey: string; versionNo: number}): unknown;
}
