import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Prisma, type PrismaClient, type TextUsageObservation} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {fields, parseId, parseOwner} from '../contracts/story-draft-validation.js';
import {bindingLabel, canonicalBindingJson, modelIdentifier} from '../contracts/provider-binding-validation.js';
import type {GenerationContext} from './generation-worker.js';
import type {TextObservation} from '../ports/structured-text.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {readExecutionProfile} from './execution-profiles.js';
import {generationBindingHash} from './generation.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';

type Stage = 'planner' | 'validator';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalized(input: TextObservation): TextObservation {
 try {
  const v = canonicalBindingJson(input);fields(v, ['providerId', 'modelId', 'bindingHash', 'responseId', 'usage']);
  const providerId = bindingLabel(v.providerId), modelId = modelIdentifier(v.modelId);
  if (typeof v.bindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.bindingHash) ||
   typeof v.responseId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(v.responseId)) throw Error();
  fields(v.usage, [], ['inputTokens', 'outputTokens', 'totalTokens']);
  const usage: TextObservation['usage'] = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
   if (!Object.hasOwn(v.usage, key)) continue;
   const value = v.usage[key];if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error();usage[key] = value;
  }
  return {providerId, modelId, bindingHash: v.bindingHash, responseId: v.responseId, usage};
 } catch {throw Error('INVALID_TEXT_OBSERVATION');}
}
function digest(row: Omit<TextUsageObservation, 'contentHash'>): string {
 return sha(['everwoven.text-observation.v1', row.id, row.ownerId, row.datasetId, row.storeEpoch, row.turnId,
  row.quoteId, row.profileId, row.stage, row.bindingHash, canonicalBindingJson(row.observation), row.schemaVersion, row.createdAt.toISOString()]);
}
/** Internal durable sink; no supplier calls and no HTTP credential/response payload surface. */
export function createTextObservationRecorder(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 services: RuntimeServices = systemServices) {
 parseOwner(owner);parseId(authority.storeEpoch);
 if (owner.ownerId !== authority.ownerId || owner.datasetId !== authority.datasetId) throw Error('OWNER_UNAVAILABLE');
 return async (context: GenerationContext, stage: Stage, input: TextObservation, signal = context.signal): Promise<void> => {
  parseId(context.turnId);
  if (stage !== 'planner' && stage !== 'validator') throw Error('INVALID_TEXT_OBSERVATION');
  const observation = normalized(input);
  signal?.throwIfAborted();await authority.revalidate();
  await withOwnerWrite(db, owner.ownerId, async tx => {
   signal?.throwIfAborted();
   const turn = await tx.generationTurn.findFirst({where: {id: context.turnId, ownerId: owner.ownerId}});
   if (!turn) throw Error('TEXT_OBSERVATION_CONTEXT_INVALID');
   const quote = await tx.generationQuote.findFirst({where: {id: turn.quoteId, ownerId: owner.ownerId}});
   const root = await tx.experience.findFirst({where: {id: turn.experienceId, ownerId: owner.ownerId}});
   const reservation = await tx.budgetReservation.findFirst({where: {id: turn.id, ownerId: owner.ownerId}});
   if (!quote || !root || !reservation || quote.datasetId !== owner.datasetId || quote.storeEpoch !== authority.storeEpoch || quote.schemaVersion !== 1 ||
    quote.acceptedTurnId !== turn.id || quote.experienceId !== turn.experienceId || quote.interactionEventId !== turn.interactionEventId ||
    reservation.experienceId !== turn.experienceId || reservation.budgetScopeId !== turn.budgetScopeId || root.budgetScopeId !== turn.budgetScopeId ||
    reservation.currency !== quote.currency) throw Error('TEXT_OBSERVATION_CONTEXT_INVALID');
   const snapshot = quote.snapshot as unknown as {quote: unknown; profileHash: string; storyHash: string; action: string; parentSummary: string; validatorImageLimit: number};
   if (quote.contentHash !== sha([quote.storeEpoch, quote.interactionEventId, quote.snapshot]) || !isDeepStrictEqual(snapshot.quote, context.quote) ||
    context.quote.id !== quote.id || context.quote.experienceId !== root.id || context.quote.profileId !== quote.profileId ||
    context.quote.maxCostMicros !== quote.maxCostMicros.toString() || context.quote.currency !== quote.currency ||
    context.story.datasetId !== owner.datasetId || context.story.id !== root.storyVersionId || context.story.contentHash !== snapshot.storyHash ||
    context.action !== snapshot.action || context.parentSummary !== snapshot.parentSummary || context.validatorImageLimit !== snapshot.validatorImageLimit)
    throw Error('TEXT_OBSERVATION_CONTEXT_INVALID');
   const profile = await readExecutionProfile(createExecutionProfileReadScope(tx, owner.ownerId), owner, quote.profileId);
   const binding = profile.snapshot[stage].binding;
   if (!isDeepStrictEqual(profile, context.profile) || profile.contentHash !== snapshot.profileHash || profile.videoBindingVersionId !== root.providerBindingVersionId ||
    profile.snapshot[stage].maxCalls !== 1 || observation.providerId !== binding.providerId || observation.modelId !== binding.modelId ||
    observation.bindingHash !== generationBindingHash(binding)) throw Error('TEXT_OBSERVATION_CONTEXT_INVALID');
   const prior = await tx.textUsageObservation.findUnique({where: {turnId_stage: {turnId: turn.id, stage}}});
   if (prior) {
    try {
     parseId(prior.id);
     if (prior.ownerId !== owner.ownerId || prior.datasetId !== owner.datasetId || prior.storeEpoch !== authority.storeEpoch || prior.quoteId !== quote.id ||
      prior.profileId !== profile.id || prior.bindingHash !== observation.bindingHash || prior.schemaVersion !== 1 ||
      prior.contentHash !== digest(prior) || !isDeepStrictEqual(normalized(prior.observation as unknown as TextObservation), prior.observation)) throw Error();
    } catch {throw Error('STORED_TEXT_OBSERVATION_INVALID');}
    if (!isDeepStrictEqual(prior.observation, observation)) throw Error('TEXT_OBSERVATION_CONFLICT');
    signal?.throwIfAborted();return;
   }
   const wake = await tx.runtimeOutbox.findFirst({where: {id: turn.id, ownerId: owner.ownerId}});
   const checkActive = () => {
    signal?.throwIfAborted();
    if (turn.status !== (stage === 'planner' ? 'planning' : 'validating') || root.status !== 'generating' || root.schedulingPaused || root.deletedAt || root.archivedAt ||
     reservation.status !== 'held' || reservation.reservedMicros < quote.maxCostMicros || wake?.kind !== 'generation.start' || wake.status !== 'leased' ||
     !wake.leaseToken || !wake.leaseUntil || wake.leaseUntil.getTime() <= currentTime(services).getTime()) throw Error('TEXT_OBSERVATION_STAGE_INACTIVE');
   };
   checkActive();
   const row = {id: nextId(services), ownerId: owner.ownerId, datasetId: owner.datasetId, storeEpoch: authority.storeEpoch, turnId: turn.id,
    quoteId: quote.id, profileId: profile.id, stage, bindingHash: observation.bindingHash, observation: observation as unknown as Prisma.InputJsonValue,
    schemaVersion: 1, createdAt: currentTime(services, turn.createdAt)};
   await tx.textUsageObservation.create({data: {...row, contentHash: digest(row as Omit<TextUsageObservation, 'contentHash'>)}});
   checkActive();
  });
 };
}
