import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Prisma,Experience} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {fields,parseId} from '../contracts/story-draft-validation.js';
import {parsePrivateVideoMetadata} from '../contracts/private-video.js';
import {parseSceneResult} from '../contracts/generation-output.js';

export type ConfirmedScene={turnId:string;mediaId:string;mediaHash:string;summary:string;inputAction:string};
const sha=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');return v;};
export const snapshotHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function parseSavedState(v:unknown){
 fields(v,['schemaVersion','ownerId','datasetId','experienceId','sourceTurnId','storyVersionId','storyHash','videoBindingVersionId','executionProfileId','executionProfileHash','parentSnapshotId','confirmedScenes','media','result','playbackSessionId']);
 if(v.schemaVersion!==1||!Array.isArray(v.confirmedScenes)||!v.confirmedScenes.length)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 const confirmedScenes:ConfirmedScene[]=v.confirmedScenes.map(x=>{
  fields(x,['turnId','mediaId','mediaHash','summary','inputAction']);
  if(typeof x.summary!=='string'||!x.summary||x.summary.length>2000||typeof x.inputAction!=='string'||x.inputAction.length>2000)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
  return{turnId:parseId(x.turnId),mediaId:parseId(x.mediaId),mediaHash:sha(x.mediaHash),summary:x.summary,inputAction:x.inputAction};
 });
 if(new Set(confirmedScenes.map(x=>x.turnId)).size!==confirmedScenes.length)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 return{schemaVersion:1 as const,ownerId:parseId(v.ownerId),datasetId:parseId(v.datasetId),experienceId:parseId(v.experienceId),sourceTurnId:parseId(v.sourceTurnId),storyVersionId:parseId(v.storyVersionId),storyHash:sha(v.storyHash),videoBindingVersionId:parseId(v.videoBindingVersionId),executionProfileId:parseId(v.executionProfileId),executionProfileHash:sha(v.executionProfileHash),parentSnapshotId:v.parentSnapshotId===null?null:parseId(v.parentSnapshotId),confirmedScenes,media:parsePrivateVideoMetadata(v.media),result:parseSceneResult(v.result),playbackSessionId:parseId(v.playbackSessionId)};
}
/** Reads immutable facts, never the source's current/future state or draft. */
export async function readPlayedScene(tx:Prisma.TransactionClient,owner:InternalOwnerContext,id:string){
 const point=await tx.savepoint.findFirst({where:{id,ownerId:owner.ownerId,datasetId:owner.datasetId,kind:'played_segment',schemaVersion:1}});
 if(!point||!point.sourceTurnId||!point.playbackSessionId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 const snapshot=await tx.stateSnapshot.findFirst({where:{id:point.stateSnapshotId,ownerId:owner.ownerId,datasetId:owner.datasetId,schemaVersion:1}});
 if(!snapshot||snapshot.contentHash!==snapshotHash(snapshot.state))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 const state=parseSavedState(snapshot.state),last=state.confirmedScenes.at(-1)!;
 const turn=await tx.generationTurn.findFirst({where:{id:point.sourceTurnId,ownerId:owner.ownerId,experienceId:point.experienceId,status:'viewed'}});
 const proof=await tx.playbackSession.findFirst({where:{id:point.playbackSessionId,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:point.experienceId,turnId:point.sourceTurnId,status:'consumed'}});
 const event=await tx.interactionEvent.findFirst({where:{id:point.interactionEventId,ownerId:owner.ownerId,experienceId:point.experienceId,kind:'decision',schemaVersion:1}});
 if(state.ownerId!==owner.ownerId||state.datasetId!==owner.datasetId||state.experienceId!==point.experienceId||state.sourceTurnId!==point.sourceTurnId||state.playbackSessionId!==point.playbackSessionId||
  !turn||!proof||!event||proof.mediaId!==state.media.id||proof.mediaHash!==state.media.sha256||proof.coveredMs<proof.durationMs-250||
  !isDeepStrictEqual(parsePrivateVideoMetadata(turn.media),state.media)||!isDeepStrictEqual(parseSceneResult(turn.result),state.result)||!isDeepStrictEqual(event.options,state.result.choices)||
  last.turnId!==turn.id||last.mediaId!==state.media.id||last.mediaHash!==state.media.sha256||last.summary!==state.result.summary)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 return{point,snapshot,state};
}
export async function readForkBase(tx:Prisma.TransactionClient,owner:InternalOwnerContext,root:Pick<Experience,'id'|'ownerId'|'storyVersionId'|'providerBindingVersionId'|'budgetScopeId'>){
 const origin=await tx.experienceFork.findFirst({where:{id:root.id,ownerId:owner.ownerId,datasetId:owner.datasetId}});
 if(!origin)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 const base=await tx.savepoint.findFirst({where:{id:origin.initialSavepointId,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:root.id,kind:'fork_base',schemaVersion:1}});
 const source=await readPlayedScene(tx,owner,origin.sourceSavepointId);
 const sourceRoot=await tx.experience.findFirst({where:{id:origin.sourceExperienceId,ownerId:owner.ownerId}});
 const ref=await tx.experienceSceneRef.findUnique({where:{experienceId_savepointId:{experienceId:root.id,savepointId:source.point.id}}});
 if(!base||base.sourceTurnId!==null||base.playbackSessionId!==null||base.parentSavepointId!==null||base.stateSnapshotId!==source.snapshot.id||source.point.experienceId!==origin.sourceExperienceId||
  source.snapshot.contentHash!==origin.snapshotHash||source.state.storyVersionId!==root.storyVersionId||source.state.videoBindingVersionId!==root.providerBindingVersionId||
  !sourceRoot||!root.budgetScopeId||sourceRoot.budgetScopeId!==root.budgetScopeId||!ref||ref.ownerId!==owner.ownerId||ref.datasetId!==owner.datasetId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 return{origin,base,...source};
}
/** The local savepoint can be a played segment or the inherited starting point. */
export async function readInputScene(tx:Prisma.TransactionClient,owner:InternalOwnerContext,root:Experience,id:string){
 const point=await tx.savepoint.findFirst({where:{id,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:root.id}});
 if(!point)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 if(point.kind==='fork_base'){
  const source=await readForkBase(tx,owner,root);if(source.base.id!==id)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');return{...source,point:source.base};
 }
 const scene=await readPlayedScene(tx,owner,id);
 if(scene.state.storyVersionId!==root.storyVersionId||scene.state.videoBindingVersionId!==root.providerBindingVersionId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 return scene;
}
