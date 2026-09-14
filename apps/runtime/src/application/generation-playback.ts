import {createGenerationCostReader} from './generation-cost.js';
import {readForkBase} from './saved-scene.js';
import {createPlaybackSessions,type VerifyPlaybackMedia} from './playback-sessions.js';
import {recordPlayedSavepoint} from './played-savepoints.js';
import {createHash} from 'node:crypto';
import {Prisma, type PrismaClient} from '../generated/prisma/client.js';
import {parseGetPlay, parseCompletePlayback, type GetPlayInput, type PlayDTO, type CompletePlaybackInput} from '../contracts/generation.js';
import {parsePlayDTO, parsePlaybackResult, parseSceneResult} from '../contracts/generation-output.js';
import {parseOwner, parseId} from '../contracts/story-draft-validation.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {fixedExperienceFacts} from './experience-opening-facts.js';
import {currentTime, nextId, systemServices, type RuntimeServices} from './runtime-services.js';
import {currentGenerationTurn} from './generation-current.js';

/** Playback is available from persisted facts without loading today's provider configuration. */
export function createGenerationPlayback(db: PrismaClient, owner: InternalOwnerContext, authority: LocalStoreAuthority,
 services: RuntimeServices = systemServices, verifyMedia?:VerifyPlaybackMedia) {
 parseOwner(owner); parseId(authority.storeEpoch);
 if (authority.ownerId !== owner.ownerId || authority.datasetId !== owner.datasetId) throw Error('OWNER_UNAVAILABLE');
 const MAX_REVISION = 2147483647;
 const json = (value: unknown) => value as Prisma.InputJsonValue;
 const dataset = (input: {datasetId: string}) => {if (input.datasetId !== owner.datasetId) throw Error('DATASET_CHANGED');};
 const commandHash = (type: string, input: unknown) => createHash('sha256').update(JSON.stringify([type, owner.ownerId, owner.datasetId, input])).digest('hex');
 async function replay(tx: Prisma.TransactionClient, type: string, input: CompletePlaybackInput) {
  const receipt = await tx.commandReceipt.findUnique({where: {ownerId_commandId: {ownerId: owner.ownerId, commandId: input.commandId}}});
  if (!receipt) return null;
  if (receipt.commandType !== type || receipt.payloadHash !== commandHash(type, input)) throw Error('IDEMPOTENCY_CONFLICT');
  try {
   if (receipt.schemaVersion !== 1) throw Error();
   const data = parsePlaybackResult({data: receipt.response, replayed: true}, input).data;
   if (data.datasetId !== owner.datasetId) throw Error();
   return data;
  } catch {throw Error('COMMAND_RECEIPT_INVALID');}
 }
 async function saveReceipt(tx: Prisma.TransactionClient, type: string, input: CompletePlaybackInput, response: PlayDTO, now: Date) {
  await tx.commandReceipt.create({data: {id: nextId(services), ownerId: owner.ownerId, commandId: input.commandId,
   commandType: type, payloadHash: commandHash(type, input), response: json(response), schemaVersion: 1, createdAt: now}});
 }
 async function readPlay(tx: Prisma.TransactionClient, experienceId: string): Promise<PlayDTO> {
  if (!await tx.localProfile.findFirst({where: {id: owner.ownerId, deletedAt: null}})) throw Error('OWNER_UNAVAILABLE');
  const root = await tx.experience.findFirst({where: {id: experienceId, ownerId: owner.ownerId, deletedAt: null, archivedAt: null}});
  if (!root) throw Error('EXPERIENCE_NOT_FOUND');
  const opening = await fixedExperienceFacts(createExperienceOpeningReadScope(tx, owner.ownerId), owner, root);
  const turn = await currentGenerationTurn(tx, owner.datasetId, root);
  const inherited=!turn&&root.status!=='preparing'?await readForkBase(tx,owner,root):null;
  const event = root.status === 'awaiting' ? await tx.interactionEvent.findFirst({where: {ownerId: owner.ownerId, experienceId, experienceRevision: root.revision, kind: 'decision'}}) : null;
  const media = turn && ['ready', 'viewed'].includes(turn.status) ? turn.media as {id: string; duration: number} | null : null;
  return parsePlayDTO({protocolVersion: 1, datasetId: owner.datasetId, experienceId, title: opening.story.title, revision: root.revision, status: root.status,...(inherited?{inherited:{savepointId:inherited.point.id,turnId:inherited.state.sourceTurnId,mediaId:inherited.state.media.id,duration:inherited.state.media.duration}}:{}),
   turn: turn ? {id: turn.id, status: turn.status, errorCode: turn.errorCode, media: media ? {id: media.id, duration: media.duration} : null} : null,
   interaction: event && (turn?.status === 'viewed'||inherited) ? {id: event.id, summary: inherited?.state.result.summary??(turn!.result as {summary: string}).summary, choices: event.options as NonNullable<PlayDTO['interaction']>['choices']} : null});
 }
 return {
  cost:createGenerationCostReader(db,owner,authority),
  ...createPlaybackSessions(db,owner,authority,services,verifyMedia),
  async get(input: GetPlayInput): Promise<PlayDTO> {
   const v = parseGetPlay(input); dataset(v); await authority.revalidate();
   return db.$transaction(tx => readPlay(tx, v.experienceId));
  },
  async completePlayback(input: CompletePlaybackInput): Promise<{data: PlayDTO; replayed: boolean}> {
   const v = parseCompletePlayback(input); dataset(v); await authority.revalidate();
   return withOwnerWrite(db, owner.ownerId, async tx => {
    const type = 'generation.playback.v1', prior = await replay(tx, type, v);
    if (prior) return {data: prior, replayed: true};
    const root = await tx.experience.findFirst({where: {id: v.experienceId, ownerId: owner.ownerId, deletedAt: null, archivedAt: null}});
    if (!root) throw Error('EXPERIENCE_NOT_FOUND');
    if (root.revision !== v.expectedExperienceRevision) throw Error('REVISION_CONFLICT');
    if (root.revision >= MAX_REVISION || root.rowRevision >= MAX_REVISION) throw Error('REVISION_EXHAUSTED');
    if (root.status !== 'playing') throw Error('GENERATION_NOT_PLAYABLE');
    const turn = await currentGenerationTurn(tx, owner.datasetId, root);
    if (turn && turn.revision >= MAX_REVISION) throw Error('REVISION_EXHAUSTED');
    if (!turn || turn.id !== v.turnId || turn.status !== 'ready' || (turn.media as {id?: string} | null)?.id !== v.mediaId) throw Error('GENERATION_NOT_PLAYABLE');
    const now = currentTime(services, root.updatedAt), eventId = nextId(services), revision = root.revision + 1;
    let result: ReturnType<typeof parseSceneResult>;
    try {result = parseSceneResult(turn.result);} catch {throw Error('GENERATION_CONTENT_UNCONFIRMED');}
    const proof=await tx.playbackSession.findFirst({where:{ownerId:owner.ownerId,datasetId:owner.datasetId,storeEpoch:authority.storeEpoch,
     experienceId:root.id,experienceRevision:root.revision,turnId:turn.id,mediaId:v.mediaId,status:'complete'},orderBy:{updatedAt:'desc'}});
    if(!proof||proof.expiresAt<=now||proof.coveredMs<proof.durationMs-250||proof.mediaHash!==(turn.media as {sha256?:unknown})?.sha256)throw Error('PLAYBACK_COVERAGE_INCOMPLETE');
    if(proof.revision>=MAX_REVISION)throw Error('REVISION_EXHAUSTED');
    await recordPlayedSavepoint(tx,owner,root,turn,proof,eventId,now,services);
    await tx.generationTurn.update({where: {id: turn.id}, data: {status: 'viewed', updatedAt: now, revision: {increment: 1}}});
    await tx.experience.update({where: {id: root.id}, data: {status: 'awaiting', revision, rowRevision: {increment: 1}, schedulingPaused: true, updatedAt: now}});
    await tx.interactionEvent.create({data: {id: eventId, ownerId: owner.ownerId, experienceId: root.id, kind: 'decision', experienceRevision: revision, options: json(result.choices), createdAt: now}});
    await tx.responseDraft.create({data: {id: nextId(services), ownerId: owner.ownerId, experienceId: root.id, interactionEventId: eventId, text: '', createdAt: now, updatedAt: now}});
    const data = await readPlay(tx, root.id);
    await saveReceipt(tx, type, v, data, now);
    return {data, replayed: false};
   });
  },
 };
}
