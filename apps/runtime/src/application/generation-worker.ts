import {createHash} from 'node:crypto';
import {Prisma, type PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {StoryVersionDTO} from '../contracts/story-version.js';
import type {BindingRecord} from '../contracts/provider-binding.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import type {MiniMaxRequestInput} from '../providers/minimax-request.js';
import {buildMiniMaxRequest} from '../providers/minimax-request.js';
import type {OfficialJobSnapshot, ProviderTaskReference, createMiniMaxVideoJobs} from '../providers/minimax-jobs.js';
import type {PinnedProfile} from '../ports/execution-profile-store.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {readExecutionProfile} from './execution-profiles.js';
import {openingFacts} from './experience-opening-facts.js';
import {decodeStoredBinding} from './provider-binding-snapshots.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';
import {parseId} from '../contracts/story-draft-validation.js';
import type {QuoteDTO} from '../contracts/generation.js';

export type PreparedScene = {prompt: string};
export type PrivateSceneMedia = {id: string; sha256: string; duration: number};
export type SceneResult = {summary: string; choices: Array<{id: string; title: string; text: string}>};
export type GenerationContext = {turnId: string; story: StoryVersionDTO; profile: PinnedProfile; quote: QuoteDTO; action: string; parentSummary: string; validatorImageLimit: number};
/** Only trusted runtime adapters implement these operations; there is no request-time injection. */
export type GenerationExecutor = {
 /** Validate installed graph/prompt/schema and adapter versions before acquiring a paid stage. */
 assertProfile(profile: PinnedProfile): void;
 plan(context: GenerationContext): Promise<PreparedScene>;
 /** Resolve only quote-approved private assets; never accept frame URLs from model output. */
 frames?(context: GenerationContext): Promise<{first?: string; last?: string}>;
 jobs(binding: BindingRecord): ReturnType<typeof createMiniMaxVideoJobs>;
 materialize(context: GenerationContext, video: NonNullable<OfficialJobSnapshot['video']>): Promise<PrivateSceneMedia>;
 validate(context: GenerationContext, media: PrivateSceneMedia): Promise<SceneResult>;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const paidInFlight = new Set(['planning', 'submitting', 'validating']);
const runnable = new Set(['queued', 'prepared', 'polling', 'materializing', 'checking', ...paidInFlight]);
const leaseMs = 120000;

/** One durable step per call. A scheduler may repeat tick; it must never retry a paid HTTP POST itself. */
export function createGenerationWorker(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 executor: GenerationExecutor, services: RuntimeServices = systemServices) {
 if (owner.ownerId !== authority.ownerId || owner.datasetId !== authority.datasetId) throw Error('OWNER_UNAVAILABLE');
 return {async tick(): Promise<boolean> {
  await authority.revalidate();
  const now = currentTime(services), token = nextId(services);
  const claimed = await withOwnerWrite(db, owner.ownerId, async tx => {
   const wake = await tx.runtimeOutbox.findFirst({where: {ownerId: owner.ownerId, kind: 'generation.start', availableAt: {lte: now},
    OR: [{status: 'pending'}, {status: 'leased', leaseUntil: {lte: now}}]}, orderBy: [{availableAt: 'asc'}, {id: 'asc'}]});
   if (!wake) return null;
   const turn = await tx.generationTurn.findFirst({where: {id: wake.id, ownerId: owner.ownerId}});
   if (!turn || !runnable.has(turn.status)) throw Error('GENERATION_QUEUE_INVALID');
   // A crashed paid stage may already have been billed. Never turn it back into a new send.
   if (paidInFlight.has(turn.status)) {
    await tx.generationTurn.update({where: {id: turn.id}, data: {status: 'unknown', errorCode: 'GENERATION_RESULT_UNKNOWN', updatedAt: now, revision: {increment: 1}}});
    await tx.runtimeOutbox.update({where: {id: wake.id}, data: {status: 'blocked', leaseToken: null, leaseUntil: null, updatedAt: now, revision: {increment: 1}}});
    await tx.experience.updateMany({where: {id: turn.experienceId, ownerId: owner.ownerId, status: 'generating'}, data: {status: 'unknown', schedulingPaused: true, updatedAt: now, rowRevision: {increment: 1}}});
    return {stopped: true as const};
   }
   const q = await tx.generationQuote.findFirst({where: {id: turn.quoteId, ownerId: owner.ownerId}}),
    reservation = await tx.budgetReservation.findFirst({where: {id: turn.id, ownerId: owner.ownerId}}),
    root = await tx.experience.findFirst({where: {id: turn.experienceId, ownerId: owner.ownerId}});
   if (!q || !root || !reservation || q.acceptedTurnId !== turn.id || q.experienceId !== turn.experienceId ||
    q.datasetId !== owner.datasetId || q.storeEpoch !== authority.storeEpoch || root.deletedAt || root.archivedAt || root.schedulingPaused ||
    root.status !== 'generating' || root.budgetScopeId !== turn.budgetScopeId || reservation.budgetScopeId !== turn.budgetScopeId ||
    reservation.experienceId !== turn.experienceId || reservation.currency !== q.currency || reservation.status !== 'held' ||
    reservation.reservedMicros < q.maxCostMicros || turn.interactionEventId !== q.interactionEventId) throw Error('GENERATION_QUEUE_INVALID');
   const snapshot = q.snapshot as unknown as {quote: QuoteDTO; profileHash: string; storyHash: string; action: string; parentSummary: string; validatorImageLimit: number};
   if (q.contentHash !== hash([q.storeEpoch, q.interactionEventId, q.snapshot]) || snapshot.quote.id !== q.id || snapshot.quote.maxCostMicros !== q.maxCostMicros.toString()) throw Error('STORED_GENERATION_QUOTE_INVALID');
   const scope = createExperienceOpeningReadScope(tx, owner.ownerId), opening = await openingFacts(scope, owner, root);
   const profile = await readExecutionProfile(createExecutionProfileReadScope(tx, owner.ownerId), owner, q.profileId);
   if (profile.contentHash !== snapshot.profileHash || opening.story.contentHash !== snapshot.storyHash || profile.videoBindingVersionId !== root.providerBindingVersionId) throw Error('GENERATION_QUEUE_INVALID');
   executor.assertProfile(profile);
   const binding = await scope.findBinding(root.providerBindingVersionId);
   if (!binding) throw Error('GENERATION_QUEUE_INVALID');
   const stage = turn.status === 'queued' ? 'planning' : turn.status === 'prepared' ? 'submitting' : turn.status === 'checking' ? 'validating' : turn.status;
   await tx.runtimeOutbox.update({where: {id: wake.id}, data: {status: 'leased', leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now, revision: {increment: 1}}});
   await tx.generationTurn.update({where: {id: turn.id}, data: {status: stage, updatedAt: now, revision: {increment: 1}}});
   return {stopped: false as const, stage, turn, binding: decodeStoredBinding(binding, owner),
    context: {turnId: turn.id, story: opening.story, profile, quote: snapshot.quote, action: snapshot.action, parentSummary: snapshot.parentSummary, validatorImageLimit: snapshot.validatorImageLimit} satisfies GenerationContext};
  });
  if (!claimed) return false;
  if (claimed.stopped) return true;
  const {stage, turn, context, binding} = claimed;
  async function finish(status: string, patch: Prisma.GenerationTurnUpdateInput = {}, delayMs = 0) {
   await authority.revalidate();
   return withOwnerWrite(db, owner.ownerId, async tx => {
    const updatedAt = currentTime(services), wake = await tx.runtimeOutbox.findFirst({where: {id: turn.id, ownerId: owner.ownerId, status: 'leased', leaseToken: token}});
    if (!wake) return false; // A late callback must not replace recovery/another lease's result.
    const changed = await tx.generationTurn.updateMany({where: {id: turn.id, ownerId: owner.ownerId, status: stage}, data: {
     errorCode: null, ...patch, status, updatedAt, revision: {increment: 1}} as Prisma.GenerationTurnUpdateManyMutationInput});
    if (changed.count !== 1) return false;
    await tx.runtimeOutbox.update({where: {id: turn.id}, data: {status: status === 'ready' ? 'done' : ['unknown', 'failed'].includes(status) ? 'blocked' : 'pending',
     availableAt: new Date(updatedAt.getTime() + delayMs), leaseUntil: null, leaseToken: null, updatedAt, revision: {increment: 1}}});
    if (['ready', 'failed', 'unknown'].includes(status)) await tx.experience.update({where: {id: turn.experienceId}, data: {
     status: status === 'ready' ? 'playing' : status, schedulingPaused: true, updatedAt, rowRevision: {increment: 1}}});
    return true;
   });
  }
  try {
   if (stage === 'planning') {
    const prepared = await executor.plan(context), g = binding.parameters.generation;
    // Build the real provider body before persisting; prevents planner overrides of bound specs.
    const frames = binding.parameters.operationKind === 'image-to-video' ? await executor.frames?.(context) : undefined;
    const input = {prompt: prepared.prompt, ...(frames ? {frames} : {}),
     duration: g.duration, resolution: g.resolution, ratio: g.ratio} as Omit<MiniMaxRequestInput, 'model'>;
    buildMiniMaxRequest({...input, model: binding.modelId as MiniMaxRequestInput['model']});
    if (Boolean(frames) !== (binding.parameters.operationKind === 'image-to-video')) throw Error('GENERATION_PLAN_INVALID');
    await finish('prepared', {prepared: json(input)});
   } else if (stage === 'submitting') {
    const ref = await executor.jobs(binding).submit(turn.id, turn.prepared as unknown as Omit<MiniMaxRequestInput, 'model'>);
    await finish('polling', {providerReference: json(ref)});
   } else if (stage === 'polling') {
    const result = await executor.jobs(binding).read(turn.providerReference as unknown as ProviderTaskReference);
    if (result.status === 'succeeded') {
     if (!result.video || result.video.duration !== context.quote.summary.duration || result.video.resolution !== context.quote.summary.resolution ||
      (context.quote.summary.ratio !== 'adaptive' && result.video.ratio !== context.quote.summary.ratio)) throw Error('GENERATION_MEDIA_INVALID');
     await finish('materializing', {result: json(result)});
    } else if (['failed', 'cancelled'].includes(result.status)) await finish('failed', {errorCode: 'PROVIDER_GENERATION_FAILED', result: json(result)});
    else await finish('polling', {}, 3000);
   } else if (stage === 'materializing') {
    const result = turn.result as unknown as OfficialJobSnapshot;
    if (!result.video) throw Error('GENERATION_MEDIA_INVALID');
    const media = await executor.materialize(context, result.video);
    parseId(media?.id);
    if (!media || typeof media.id !== 'string' || !/^[a-f0-9]{64}$/.test(media.sha256) || !Number.isFinite(media.duration) || media.duration <= 0) throw Error('GENERATION_MEDIA_INVALID');
    await finish('checking', {media: json(media)});
   } else if (stage === 'validating') {
    const result = await executor.validate(context, turn.media as unknown as PrivateSceneMedia);
    if (!result || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 2000 || !Array.isArray(result.choices) || result.choices.length < 2 || result.choices.length > 4 ||
     new Set(result.choices.map(c => c.id)).size !== result.choices.length || result.choices.some(c => typeof c.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(c.id) ||
      typeof c.title !== 'string' || !c.title.trim() || c.title.length > 100 || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000)) throw Error('GENERATION_CONTENT_UNCONFIRMED');
    // The media is playable; result remains a candidate until a separate playback-complete command.
    await finish('ready', {result: json(result)});
   }
  } catch {
   // The conservative reservation stays held for failed/unknown usage too. No zero-cost inference.
   if (paidInFlight.has(stage)) await finish('unknown', {errorCode: 'GENERATION_RESULT_UNKNOWN'});
   else await finish(stage, {errorCode: 'GENERATION_READ_INTERRUPTED'}, 10000);
  }
  return true;
 }};
}
