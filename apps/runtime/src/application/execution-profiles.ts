import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseExecutionProfile} from '../contracts/execution-profile.js';
import {canonicalBindingJson, parseExecutionBinding} from '../contracts/provider-binding-validation.js';
import type {ExecutionBindingSpec, ExecutionBindingRecord} from '../contracts/provider-binding.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {parseOwner, parseId} from '../contracts/story-draft-validation.js';
import {isTimestamp} from '../contracts/primitives.js';
import type {ExecutionProfileReadScope, ExecutionProfileWriteScope, PinnedProfile, ProfileRecord} from '../ports/execution-profile-store.js';
import type {StoredBinding} from '../ports/experience-opening-store.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

function hash(row: Omit<ProfileRecord, 'contentHash'>, owner: InternalOwnerContext): string {
  // The already bounded snapshot must not lose depth/size allowance merely because
  // fixed metadata wraps it. Canonicalize the snapshot alone; hash a fixed tuple.
  return createHash('sha256').update(JSON.stringify([
    'everwoven.execution-profile.v1', owner.datasetId, row.id, row.ownerId, row.profileKey, row.versionNo,
    row.plannerBindingVersionId, row.videoBindingVersionId, row.validatorBindingVersionId,
    canonicalBindingJson(row.snapshot), row.schemaVersion, row.createdAt.toISOString(),
  ])).digest('hex');
}
function decodeBinding(row: StoredBinding, owner: InternalOwnerContext): ExecutionBindingRecord {
  try {
    const {id, createdAt, ...raw} = row, spec = parseExecutionBinding(raw);
    parseId(id);
    if (spec.ownerId !== owner.ownerId || !(createdAt instanceof Date) || !isTimestamp(createdAt.toISOString())) throw Error();
    return {...spec, id, createdAt};
  } catch {throw Error('STORED_PROVIDER_BINDING_INVALID');}
}
async function pinStage(scope: ExecutionProfileWriteScope, owner: InternalOwnerContext, spec: ExecutionBindingSpec,
  now: Date, services: RuntimeServices): Promise<ExecutionBindingRecord> {
  const old = await scope.findBindingByVersion(spec.bindingKey, spec.versionNo);
  if (old) {
    const decoded = decodeBinding(old, owner), {id, createdAt, ...existing} = decoded;
    if (!isDeepStrictEqual(existing, spec)) throw Error('PROVIDER_BINDING_CONFLICT');
    return decoded;
  }
  const row = {...spec, id: nextId(services), createdAt: now};
  await scope.insertBinding(row);
  const stored = await scope.findBinding(row.id);
  if (!stored || !isDeepStrictEqual(decodeBinding(stored, owner), row)) throw Error('STORED_PROVIDER_BINDING_INVALID');
  return row;
}
/** Narrow in-scope read for Quote: no current resolver or draft access. */
export async function readExecutionProfile(scope: ExecutionProfileReadScope, owner: InternalOwnerContext, id: string): Promise<PinnedProfile> {
  parseOwner(owner); parseId(id);
  const row = await scope.findProfile(id);
  if (!row) throw Error('EXECUTION_PROFILE_NOT_FOUND');
  try {
    const {contentHash, ...body} = row;
    const snapshot = parseExecutionProfile(row.snapshot);
    if (row.id !== id || row.ownerId !== owner.ownerId || snapshot.ownerId !== owner.ownerId || row.schemaVersion !== 1 ||
      row.profileKey !== snapshot.profileKey || row.versionNo !== snapshot.versionNo ||
      !(row.createdAt instanceof Date) || !isTimestamp(row.createdAt.toISOString()) || contentHash !== hash(body, owner)) throw Error();
    for (const [key, bindingId] of [['planner', row.plannerBindingVersionId], ['video', row.videoBindingVersionId], ['validator', row.validatorBindingVersionId]] as const) {
      parseId(bindingId);
      const stored = await scope.findBinding(bindingId);
      if (!stored) throw Error();
      const {id: _, createdAt, ...binding} = decodeBinding(stored, owner);
      if (!isDeepStrictEqual(binding, snapshot[key].binding) || createdAt > row.createdAt) throw Error();
    }
    return {...row, snapshot, schemaVersion: 1};
  } catch {throw Error('STORED_EXECUTION_PROFILE_INVALID');}
}
/** Must run inside the same WriteGate as its eventual Quote. Does not grant spending authority. */
export async function pinExecutionProfile(scope: ExecutionProfileWriteScope, owner: InternalOwnerContext,
  input: unknown, services: RuntimeServices = systemServices): Promise<PinnedProfile> {
  parseOwner(owner);
  const spec = parseExecutionProfile(input);
  if (spec.ownerId !== owner.ownerId) throw Error('EXECUTION_PROFILE_OWNER_MISMATCH');
  const old = await scope.findProfileByVersion(spec.profileKey, spec.versionNo);
  if (old) {
    const existing = await readExecutionProfile(scope, owner, old.id);
    if (!isDeepStrictEqual(existing.snapshot, spec)) throw Error('EXECUTION_PROFILE_CONFLICT');
    return existing;
  }
  let now = currentTime(services);
  const planner = await pinStage(scope, owner, spec.planner.binding, now, services);
  const video = await pinStage(scope, owner, spec.video.binding, now, services);
  const validator = await pinStage(scope, owner, spec.validator.binding, now, services);
  now = new Date(Math.max(now.getTime(), planner.createdAt.getTime(), video.createdAt.getTime(), validator.createdAt.getTime()));
  const body = {id: nextId(services), ownerId: owner.ownerId, profileKey: spec.profileKey, versionNo: spec.versionNo,
    plannerBindingVersionId: planner.id, videoBindingVersionId: video.id, validatorBindingVersionId: validator.id,
    snapshot: spec, schemaVersion: 1 as const, createdAt: now};
  const row = {...body, contentHash: hash(body, owner)};
  await scope.insertProfile(row);
  const stored = await readExecutionProfile(scope, owner, row.id);
  if (!isDeepStrictEqual(stored, row)) throw Error('STORED_EXECUTION_PROFILE_INVALID');
  return stored;
}
