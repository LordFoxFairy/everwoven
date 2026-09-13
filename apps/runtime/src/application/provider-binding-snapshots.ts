import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {BindingRecord, BindingResolver, PublicBinding} from '../contracts/provider-binding.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {ExperienceOpeningWriteScope, StoredBinding} from '../ports/experience-opening-store.js';
import {parseBindingSpec} from '../contracts/provider-binding-validation.js';
import {parseId} from '../contracts/story-draft-validation.js';
import {isTimestamp} from '../contracts/primitives.js';
import {nextId, type RuntimeServices} from './runtime-services.js';

export function decodeStoredBinding(row: StoredBinding, owner: InternalOwnerContext): BindingRecord {
  try {
    const {id, createdAt, ...rawSpec} = row;
    parseId(id);
    if (!(createdAt instanceof Date) || !isTimestamp(createdAt.toISOString())) throw Error();
    const spec = parseBindingSpec(rawSpec);
    if (spec.ownerId !== owner.ownerId) throw Error();
    return {...spec, id, createdAt};
  } catch { throw Error('STORED_PROVIDER_BINDING_INVALID'); }
}
export function publicBinding(row: BindingRecord, owner: InternalOwnerContext): PublicBinding {
  const {id, bindingKey, versionNo, providerId, modelId, mode, adapterVersion, capabilityVersion, parameters} = row;
  // Integrity fingerprint only, not a signature or authorization. No secret value enters this record.
  const snapshotHash = createHash('sha256').update(JSON.stringify([
    'everwoven.provider-binding.v1', owner.datasetId, row,
  ])).digest('hex');
  return {id, bindingKey, versionNo, providerId, modelId, mode, connectionId: parameters.connectionId,
    region: parameters.region, adapterVersion, capabilityVersion, snapshotHash};
}
export async function pinBinding(
  scope: ExperienceOpeningWriteScope, owner: InternalOwnerContext,
  selection: {bindingKey: string; versionNo: number}, resolver: BindingResolver,
  now: Date, services: RuntimeServices,
): Promise<BindingRecord> {
  const spec = parseBindingSpec(resolver.resolve(owner, selection));
  if (spec.ownerId !== owner.ownerId || spec.bindingKey !== selection.bindingKey || spec.versionNo !== selection.versionNo)
    throw Error('PROVIDER_BINDING_MISMATCH');
  const old = await scope.findBindingByVersion(selection.bindingKey, selection.versionNo);
  if (old) {
    const {id, createdAt, ...existing} = decodeStoredBinding(old, owner);
    if (!isDeepStrictEqual(existing, spec)) throw Error('PROVIDER_BINDING_CONFLICT');
    return {...existing, id, createdAt};
  }
  const row = {...spec, id: nextId(services), createdAt: now};
  await scope.insertBinding(row);
  const stored = await scope.findBinding(row.id);
  if (!stored) throw Error('STORED_PROVIDER_BINDING_INVALID');
  const decoded = decodeStoredBinding(stored, owner);
  if (!isDeepStrictEqual(decoded, row)) throw Error('STORED_PROVIDER_BINDING_INVALID');
  return decoded;
}
