import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient,PlaybackSession} from '../generated/prisma/client.js';
import {parseCompletePlayback,parsePlaybackProgress,parsePlaybackSession,type BeginPlaybackInput,type PlaybackProgressInput,type PlaybackSessionDTO} from '../contracts/generation.js';
import {parsePrivateVideoMetadata} from '../contracts/private-video.js';
import type {PrivateVideoMetadata} from '../ports/private-video.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {currentTime,nextId,systemServices,type RuntimeServices} from './runtime-services.js';
import {currentGenerationTurn} from './generation-current.js';
import {parseOwner,parseId} from '../contracts/story-draft-validation.js';

export type VerifyPlaybackMedia=(metadata:PrivateVideoMetadata)=>Promise<void>;
/** These are bounded server-timed client playback reports, not proof that a human watched the screen. */
export function createPlaybackSessions(db:PrismaClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,services:RuntimeServices=systemServices,verifyMedia?:VerifyPlaybackMedia){
 parseOwner(owner);parseId(authority.storeEpoch);if(authority.ownerId!==owner.ownerId||authority.datasetId!==owner.datasetId)throw Error('OWNER_UNAVAILABLE');
 const dto=(row:PlaybackSession):PlaybackSessionDTO=>parsePlaybackSession({protocolVersion:1,datasetId:row.datasetId,experienceId:row.experienceId,id:row.id,turnId:row.turnId,mediaId:row.mediaId,
  experienceRevision:row.experienceRevision,durationMs:row.durationMs,coveredMs:row.coveredMs,sequence:row.sequence,status:row.status,expiresAt:row.expiresAt.toISOString()});
 const payload=(type:string,input:unknown)=>createHash('sha256').update(JSON.stringify([owner.ownerId,owner.datasetId,type,input])).digest('hex');
 async function replay(tx:Prisma.TransactionClient,type:string,input:{commandId:string}){
  const row=await tx.commandReceipt.findUnique({where:{ownerId_commandId:{ownerId:owner.ownerId,commandId:input.commandId}}});if(!row)return null;
  if(row.commandType!==type||row.payloadHash!==payload(type,input))throw Error('IDEMPOTENCY_CONFLICT');
  if(row.schemaVersion!==1)throw Error('COMMAND_RECEIPT_INVALID');return parsePlaybackSession(row.response);
 }
 async function receipt(tx:Prisma.TransactionClient,type:string,input:{commandId:string},data:PlaybackSessionDTO,now:Date){
  await tx.commandReceipt.create({data:{id:nextId(services),ownerId:owner.ownerId,commandId:input.commandId,commandType:type,payloadHash:payload(type,input),response:data as unknown as Prisma.InputJsonValue,schemaVersion:1,createdAt:now}});
 }
 async function active(tx:Prisma.TransactionClient,input:{experienceId:string;turnId:string;mediaId:string;expectedExperienceRevision:number}){
  const root=await tx.experience.findFirst({where:{id:input.experienceId,ownerId:owner.ownerId,deletedAt:null,archivedAt:null}});
  if(!root||root.status!=='playing'||root.revision!==input.expectedExperienceRevision)throw Error('GENERATION_NOT_PLAYABLE');
  const turn=await currentGenerationTurn(tx,owner.datasetId,root);
  if(!turn||turn.id!==input.turnId||turn.status!=='ready')throw Error('GENERATION_NOT_PLAYABLE');
  const media=parsePrivateVideoMetadata(turn.media);if(media.id!==input.mediaId)throw Error('GENERATION_NOT_PLAYABLE');return media;
 }
 return {
  async beginPlayback(input:BeginPlaybackInput):Promise<PlaybackSessionDTO>{
   const v=parseCompletePlayback(input);if(v.datasetId!==owner.datasetId)throw Error('DATASET_CHANGED');await authority.revalidate();
   const type='generation.begin-playback.v1';
   const prior=await db.$transaction(tx=>replay(tx,type,v));if(prior)return prior;
   const metadata=await db.$transaction(tx=>active(tx,v));
   if(!verifyMedia)throw Error('PLAYBACK_MEDIA_UNAVAILABLE');
   await verifyMedia(metadata);await authority.revalidate();
   return withOwnerWrite(db,owner.ownerId,async tx=>{
    const existing=await replay(tx,type,v);if(existing)return existing;
    const current=await active(tx,v);if(JSON.stringify(current)!==JSON.stringify(metadata))throw Error('PLAYBACK_MEDIA_UNAVAILABLE');
    const now=currentTime(services),row=await tx.playbackSession.create({data:{id:nextId(services),ownerId:owner.ownerId,datasetId:owner.datasetId,storeEpoch:authority.storeEpoch,
     experienceId:v.experienceId,experienceRevision:v.expectedExperienceRevision,turnId:v.turnId,mediaId:v.mediaId,mediaHash:metadata.sha256,durationMs:metadata.durationMs,startedAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+30*60000)}});
    const data=dto(row);await receipt(tx,type,v,data,now);return data;
   });
  },
  async reportPlayback(input:PlaybackProgressInput):Promise<PlaybackSessionDTO>{
   const v=parsePlaybackProgress(input);if(v.datasetId!==owner.datasetId)throw Error('DATASET_CHANGED');await authority.revalidate();
   return withOwnerWrite(db,owner.ownerId,async tx=>{
    const type='generation.playback-progress.v1',prior=await replay(tx,type,v);if(prior)return prior;
    const row=await tx.playbackSession.findFirst({where:{id:v.playbackSessionId,ownerId:owner.ownerId,datasetId:owner.datasetId,storeEpoch:authority.storeEpoch,experienceId:v.experienceId}});
    if(!row)throw Error('PLAYBACK_SESSION_UNAVAILABLE');
    const now=currentTime(services),media=await active(tx,{experienceId:row.experienceId,expectedExperienceRevision:row.experienceRevision,turnId:row.turnId,mediaId:row.mediaId});
    if(row.status!=='active'||row.expiresAt<=now||row.mediaHash!==media.sha256||row.durationMs!==media.durationMs)throw Error('PLAYBACK_SESSION_UNAVAILABLE');
    if(row.sequence>=2147483646||row.revision>=2147483647)throw Error('REVISION_EXHAUSTED');
    if(v.sequence!==row.sequence+1)throw Error('PLAYBACK_PROGRESS_CONFLICT');
    const elapsed=now.getTime()-row.updatedAt.getTime(),total=now.getTime()-row.startedAt.getTime(),covered=Math.min(v.coveredMs,row.durationMs);
    // Use the session's total wall time. Per-request deltas misclassify valid
    // playback when network jitter bunches two sequential reports together.
    if(v.positionMs>row.durationMs+250||v.coveredMs>row.durationMs+250||covered<row.coveredMs||elapsed<0||total<0||covered>total+350)
     throw Error('PLAYBACK_COVERAGE_INCOMPLETE');
    const status=covered>=row.durationMs-250&&total>=row.durationMs-250?'complete':'active';
    const updated=await tx.playbackSession.update({where:{id:row.id},data:{sequence:v.sequence,lastPositionMs:v.positionMs,coveredMs:covered,status,updatedAt:now,revision:{increment:1}}});
    const data=dto(updated);await receipt(tx,type,v,data,now);return data;
   });
  },
 };
}
