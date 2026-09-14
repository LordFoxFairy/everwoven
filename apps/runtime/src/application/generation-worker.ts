import {isDeepStrictEqual} from 'node:util';
import {readInputScene,type ConfirmedScene} from './saved-scene.js';
import {createHash} from 'node:crypto';
import {Prisma, type PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {StoryVersionDTO} from '../contracts/story-version.js';
import type {BindingRecord} from '../contracts/provider-binding.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import type {VideoJobAdapter, GeneratedVideo, VideoTaskReference} from '../ports/video-jobs.js';
import {isPermanentVideoFailure} from '../ports/private-video.js';
import {parseVideoJobSnapshot} from '../contracts/video-job-output.js';
import {canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import type {PinnedProfile} from '../ports/execution-profile-store.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {readExecutionProfile} from './execution-profiles.js';
import {fixedExperienceFacts} from './experience-opening-facts.js';
import {decodeStoredBinding} from './provider-binding-snapshots.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';
import {parseId} from '../contracts/story-draft-validation.js';
import type {QuoteDTO} from '../contracts/generation.js';

export type PreparedScene = {prompt: string};
export type PrivateSceneMedia = {id: string; sha256: string; duration: number};
import {parseSceneResult, type SceneResult} from '../contracts/generation-output.js';
export type {SceneResult} from '../contracts/generation-output.js';
export type GenerationContext = {confirmedScenes?:ConfirmedScene[];turnId: string; story: StoryVersionDTO; profile: PinnedProfile; quote: QuoteDTO; action: string; parentSummary: string; validatorImageLimit: number; signal?: AbortSignal};
/** Only trusted runtime adapters implement these operations; there is no request-time injection. */
export type GenerationExecutor = {
 /** Validate installed graph/prompt/schema and adapter versions before acquiring a paid stage. */
 assertProfile(profile: PinnedProfile): void;
 plan(context: GenerationContext): Promise<PreparedScene>;
 /** Resolve only quote-approved private assets; never accept frame URLs from model output. */
 frames?(context: GenerationContext): Promise<{first?: string; last?: string}>;
 jobs(binding: BindingRecord): VideoJobAdapter;
 materialize(context: GenerationContext, video: GeneratedVideo): Promise<PrivateSceneMedia>;
 validate(context: GenerationContext, media: PrivateSceneMedia): Promise<SceneResult>;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const paidInFlight = new Set(['planning', 'submitting', 'validating']);
const runnable = new Set(['queued', 'prepared', 'polling', 'materializing', 'checking', ...paidInFlight]);
const leaseMs = 120000;
/** A whole step, including sampling/text/observation, finishes before the 120s lease; timeout never authorizes a paid retry. */
const stepTimeoutMs = 100000;
async function boundedStep<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
 return new Promise((resolve, reject) => {
  const abort = () => {signal.removeEventListener('abort', abort);reject(Error('GENERATION_STEP_TIMEOUT'));};
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) {abort();return;}
  work().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
 });
}

/** One durable step per call. A scheduler may repeat tick; it must never retry a paid HTTP POST itself. */
export function createGenerationWorker(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 executor: GenerationExecutor, services: RuntimeServices = systemServices, lifetime?: AbortSignal) {
 if (owner.ownerId !== authority.ownerId || owner.datasetId !== authority.datasetId) throw Error('OWNER_UNAVAILABLE');
 const pending = new Set<Promise<unknown>>();
 return {async drain() {await Promise.allSettled([...pending]);}, async tick(): Promise<boolean> {
  if (lifetime?.aborted) return false;
  await authority.revalidate();
  const now = currentTime(services), token = nextId(services);
  const claimed = await withOwnerWrite(db, owner.ownerId, async tx => {
   lifetime?.throwIfAborted();
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
   const snapshot = q.snapshot as unknown as {inputSavepointId:string|null;inputSnapshotHash:string|null;confirmedScenes:ConfirmedScene[];quote: QuoteDTO; profileHash: string; storyHash: string; action: string; parentSummary: string; validatorImageLimit: number};
   if (q.contentHash !== hash([q.storeEpoch, q.interactionEventId, q.snapshot]) || snapshot.quote.id !== q.id || snapshot.quote.maxCostMicros !== q.maxCostMicros.toString()) throw Error('STORED_GENERATION_QUOTE_INVALID');
   const scope = createExperienceOpeningReadScope(tx, owner.ownerId), opening = await fixedExperienceFacts(scope, owner, root);
   const profile = await readExecutionProfile(createExecutionProfileReadScope(tx, owner.ownerId), owner, q.profileId);
   if (profile.contentHash !== snapshot.profileHash || opening.story.contentHash !== snapshot.storyHash || profile.videoBindingVersionId !== root.providerBindingVersionId) throw Error('GENERATION_QUEUE_INVALID');
   if(turn.inputSavepointId!==snapshot.inputSavepointId)throw Error('GENERATION_QUEUE_INVALID');
   if(snapshot.inputSavepointId){
    const input=await readInputScene(tx,owner,root,snapshot.inputSavepointId);
    if(input.snapshot.contentHash!==snapshot.inputSnapshotHash||!isDeepStrictEqual(input.state.confirmedScenes,snapshot.confirmedScenes))throw Error('GENERATION_QUEUE_INVALID');
   }else if(snapshot.inputSnapshotHash!==null||snapshot.confirmedScenes.length)throw Error('GENERATION_QUEUE_INVALID');
   executor.assertProfile(profile);
   const binding = await scope.findBinding(root.providerBindingVersionId);
   if (!binding) throw Error('GENERATION_QUEUE_INVALID');
   const stage = turn.status === 'queued' ? 'planning' : turn.status === 'prepared' ? 'submitting' : turn.status === 'checking' ? 'validating' : turn.status;
   // The persisted paid-stage marker serializes new sends across workers in a scope.
   // Unknown and still-running (including crashed, unrecovered) sends block only new paid work.
   if(paidInFlight.has(stage)&&await tx.generationTurn.count({where:{budgetScopeId:turn.budgetScopeId,id:{not:turn.id},status:{in:['unknown',...paidInFlight]}}})){
    await tx.runtimeOutbox.update({where:{id:wake.id},data:{availableAt:new Date(now.getTime()+3000),updatedAt:now,revision:{increment:1}}});
    return{stopped:true as const};
   }
   await tx.runtimeOutbox.update({where: {id: wake.id}, data: {status: 'leased', leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now, revision: {increment: 1}}});
   await tx.generationTurn.update({where: {id: turn.id}, data: {status: stage, updatedAt: now, revision: {increment: 1}}});
   return {stopped: false as const, stage, turn, binding: decodeStoredBinding(binding, owner),
    context: {confirmedScenes:snapshot.confirmedScenes,turnId: turn.id, story: opening.story, profile, quote: snapshot.quote, action: snapshot.action, parentSummary: snapshot.parentSummary, validatorImageLimit: snapshot.validatorImageLimit} satisfies GenerationContext};
  });
  if (!claimed) return false;
  if (claimed.stopped) return true;
  const {stage, turn, binding} = claimed;
  const elapsed = Math.max(0, currentTime(services).getTime() - now.getTime());
  const deadline = elapsed >= stepTimeoutMs ? AbortSignal.abort() : AbortSignal.timeout(stepTimeoutMs - elapsed);
  const signal = lifetime ? AbortSignal.any([deadline, lifetime]) : deadline;
  const context: GenerationContext = {...claimed.context, signal};
  const {id: bindingId, createdAt: _createdAt, ...bindingSpec} = binding;
  const bindingHash = hash(canonicalBindingJson(bindingSpec));
  function videoAdapter(): VideoJobAdapter {
   const adapter = executor.jobs(binding);
   if (adapter.mode !== 'job' || adapter.bindingId !== bindingId || adapter.bindingHash !== bindingHash) throw Error('GENERATION_ADAPTER_MISMATCH');
   return adapter;
  }
  function checkedReference(adapter: VideoJobAdapter, raw: unknown): VideoTaskReference {
   const ref = adapter.reference(raw), p = binding.parameters;
   if (ref.operationId !== turn.id || ref.bindingId !== bindingId || ref.bindingHash !== bindingHash ||
    ref.providerId !== binding.providerId || ref.modelId !== binding.modelId || ref.connectionId !== p.connectionId ||
    ref.accountScopeId !== p.providerAccountScopeId || ref.region !== p.region) throw Error('GENERATION_REFERENCE_MISMATCH');
   return ref;
  }
  function deliveredVideo(video: GeneratedVideo | undefined): GeneratedVideo {
   const approved = context.quote.summary;
   if (!video || video.duration !== approved.duration || video.resolution !== approved.resolution ||
    (approved.ratio !== 'adaptive' && video.ratio !== approved.ratio)) throw Error('GENERATION_MEDIA_INVALID');
   return video;
  }
  async function finish(status: string, patch: Prisma.GenerationTurnUpdateInput = {}, delayMs = 0, advancing = false) {
   await authority.revalidate();
   return withOwnerWrite(db, owner.ownerId, async tx => {
    // Recheck after authority/SQLite queue waits, and before returning the transaction.
    // Expired progress rolls back every write; the separate unknown transition remains allowed.
    const checkDeadline = () => {
     if (!advancing) return;
     signal.throwIfAborted();
     if (currentTime(services).getTime() >= now.getTime() + stepTimeoutMs) throw Error('GENERATION_STEP_TIMEOUT');
    };
    checkDeadline();
    const updatedAt = currentTime(services), wake = await tx.runtimeOutbox.findFirst({where: {id: turn.id, ownerId: owner.ownerId, status: 'leased', leaseToken: token}});
    if (!wake) return false; // A late callback must not replace recovery/another lease's result.
    const changed = await tx.generationTurn.updateMany({where: {id: turn.id, ownerId: owner.ownerId, status: stage}, data: {
     errorCode: null, ...patch, status, updatedAt, revision: {increment: 1}} as Prisma.GenerationTurnUpdateManyMutationInput});
    if (changed.count !== 1) return false;
    await tx.runtimeOutbox.update({where: {id: turn.id}, data: {status: status === 'ready' ? 'done' : ['unknown', 'failed'].includes(status) ? 'blocked' : 'pending',
     availableAt: new Date(updatedAt.getTime() + delayMs), leaseUntil: null, leaseToken: null, updatedAt, revision: {increment: 1}}});
    if (['ready', 'failed', 'unknown'].includes(status)) await tx.experience.update({where: {id: turn.experienceId}, data: {
     status: status === 'ready' ? 'playing' : status, schedulingPaused: true, updatedAt, rowRevision: {increment: 1}}});
    checkDeadline();
    return true;
   });
  }
  async function progress(status: string, patch: Record<string, unknown> = {}, delayMs = 0) {
   signal.throwIfAborted();return finish(status, patch, delayMs, true);
  }
  try {
   await boundedStep(signal, () => {
   const work = (async () => {
   if (stage === 'planning') {
    const adapter = videoAdapter();
    const plan = await executor.plan(context);
    signal.throwIfAborted();
    const frames = binding.parameters.operationKind === 'image-to-video' ? await executor.frames?.(context) : undefined;
    if (Boolean(frames) !== (binding.parameters.operationKind === 'image-to-video')) throw Error('GENERATION_PLAN_INVALID');
    const input = adapter.validatePrepared(adapter.prepare({prompt: plan.prompt, ...(frames ? {frames} : {})}));
    await progress('prepared', {prepared: json(input)});
   } else if (stage === 'submitting') {
    const adapter = videoAdapter(), input = adapter.validatePrepared(turn.prepared);
    const ref = checkedReference(adapter, await adapter.submit(turn.id, input, signal));
    await progress('polling', {providerReference: json(ref)});
   } else if (stage === 'polling') {
    const adapter = videoAdapter(), ref = checkedReference(adapter, turn.providerReference);
    const result = parseVideoJobSnapshot(await adapter.read(ref, signal));
    if (result.taskId !== ref.taskId) throw Error('GENERATION_REFERENCE_MISMATCH');
    if (result.status === 'succeeded') {
     deliveredVideo(result.video);
     await progress('materializing', {result: json(result)});
    } else if (['failed', 'cancelled'].includes(result.status)) await progress('failed', {errorCode: 'PROVIDER_GENERATION_FAILED', result: json(result)});
    else await progress('polling', {}, 3000);
   } else if (stage === 'materializing') {
    const adapter = videoAdapter(), ref = checkedReference(adapter, turn.providerReference);
    const result = parseVideoJobSnapshot(turn.result);
    if (ref.operationId !== turn.id || result.taskId !== ref.taskId || result.status !== 'succeeded') throw Error('GENERATION_REFERENCE_MISMATCH');
    const video = deliveredVideo(result.video);
    const media = await executor.materialize(context, video);
    parseId(media?.id);
    if (!media || typeof media.id !== 'string' || !/^[a-f0-9]{64}$/.test(media.sha256) || media.duration !== video.duration) throw Error('GENERATION_MEDIA_INVALID');
    await progress('checking', {media: json(media)});
   } else if (stage === 'validating') {
    const result = parseSceneResult(await executor.validate(context, turn.media as unknown as PrivateSceneMedia));
    // The media is playable; result remains a candidate until a separate playback-complete command.
    await progress('ready', {result: json(result)});
   }
   })();
   pending.add(work);void work.then(() => pending.delete(work), () => pending.delete(work));return work;
   });
  } catch (error) {
   // The conservative reservation stays held for failed/unknown usage too. No zero-cost inference.
   // A broken fixed identity cannot heal by repeatedly querying the same saved record.
   const code = error instanceof Error ? error.message : '';
   const invalidIdentity = ['INVALID_PROVIDER_TASK_REFERENCE', 'GENERATION_REFERENCE_MISMATCH', 'GENERATION_ADAPTER_MISMATCH'].includes(code);
   const invalidSavedResult = stage === 'materializing' && (['INVALID_VIDEO_JOB_RESULT', 'GENERATION_MEDIA_INVALID'].includes(code) || isPermanentVideoFailure(error));
   if (paidInFlight.has(stage) || invalidIdentity || invalidSavedResult) await finish('unknown', {errorCode: 'GENERATION_RESULT_UNKNOWN'});
   else await finish(stage, {errorCode: 'GENERATION_READ_INTERRUPTED'}, 10000);
  }
  return true;
 }};
}
