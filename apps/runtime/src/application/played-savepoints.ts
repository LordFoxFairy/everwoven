import {createHash} from 'node:crypto';
import type {Prisma,Experience,GenerationTurn,PlaybackSession} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {parsePrivateVideoMetadata} from '../contracts/private-video.js';
import {parseSceneResult} from '../contracts/generation-output.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {readExecutionProfile} from './execution-profiles.js';
import {openingFacts} from './experience-opening-facts.js';
import {nextId,type RuntimeServices} from './runtime-services.js';

/** Called only inside the same playback-completion writer transaction; never constructs a future scene. */
export async function recordPlayedSavepoint(tx:Prisma.TransactionClient,owner:InternalOwnerContext,root:Experience,turn:GenerationTurn,proof:PlaybackSession,eventId:string,now:Date,services:RuntimeServices){
 const media=parsePrivateVideoMetadata(turn.media),result=parseSceneResult(turn.result);
 const quote=await tx.generationQuote.findFirst({where:{id:turn.quoteId,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:root.id,acceptedTurnId:turn.id}});
 if(!quote)throw Error('STORED_GENERATION_INVALID');
 const opening=await openingFacts(createExperienceOpeningReadScope(tx,owner.ownerId),owner,root);
 const profile=await readExecutionProfile(createExecutionProfileReadScope(tx,owner.ownerId),owner,quote.profileId);
 const frozen=quote.snapshot as {storyHash?:unknown;profileHash?:unknown};
 if(quote.schemaVersion!==1||quote.contentHash!==createHash('sha256').update(JSON.stringify([quote.storeEpoch,quote.interactionEventId,quote.snapshot])).digest('hex')||frozen.storyHash!==opening.story.contentHash||frozen.profileHash!==profile.contentHash)throw Error('STORED_GENERATION_QUOTE_INVALID');
 const parent=turn.parentTurnId?await tx.savepoint.findUnique({where:{sourceTurnId:turn.parentTurnId}}):null;
 if(turn.parentTurnId&&(!parent||parent.ownerId!==owner.ownerId||parent.datasetId!==owner.datasetId||parent.experienceId!==root.id||parent.kind!=='played_segment'))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 const previous=parent?await tx.stateSnapshot.findFirst({where:{id:parent.stateSnapshotId,ownerId:owner.ownerId,datasetId:owner.datasetId,schemaVersion:1}}):null;
 let history:Array<{turnId:string;mediaId:string;mediaHash:string;summary:string;inputAction:string}>=[];
 if(parent){
  if(!previous||previous.contentHash!==createHash('sha256').update(JSON.stringify(previous.state)).digest('hex'))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
  const value=previous.state as {confirmedScenes?:unknown};
  if(!Array.isArray(value.confirmedScenes))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
  history=value.confirmedScenes as typeof history;
  for(const fact of history)if(!fact||typeof fact.turnId!=='string'||typeof fact.mediaId!=='string'||typeof fact.mediaHash!=='string'||typeof fact.summary!=='string'||typeof fact.inputAction!=='string')throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
 }
 const inputAction=(quote.snapshot as {action?:unknown}).action;if(typeof inputAction!=='string'||inputAction.length>2000)throw Error('STORED_GENERATION_QUOTE_INVALID');
 const confirmedScenes=[...history,{turnId:turn.id,mediaId:media.id,mediaHash:media.sha256,summary:result.summary,inputAction}];
 const state={schemaVersion:1,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:root.id,sourceTurnId:turn.id,
  storyVersionId:root.storyVersionId,storyHash:opening.story.contentHash,videoBindingVersionId:root.providerBindingVersionId,
  executionProfileId:profile.id,executionProfileHash:profile.contentHash,parentSnapshotId:parent?.stateSnapshotId??null,
  confirmedScenes,media,result,playbackSessionId:proof.id};
 const snapshotId=nextId(services),id=nextId(services);
 const contentHash=createHash('sha256').update(JSON.stringify(state)).digest('hex');
 await tx.stateSnapshot.create({data:{id:snapshotId,ownerId:owner.ownerId,datasetId:owner.datasetId,state:state as Prisma.InputJsonValue,contentHash,createdAt:now}});
 await tx.savepoint.create({data:{id,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:root.id,kind:'played_segment',parentSavepointId:parent?.id??null,
  sourceTurnId:turn.id,stateSnapshotId:snapshotId,interactionEventId:eventId,playbackSessionId:proof.id,createdAt:now}});
 await tx.playbackSession.update({where:{id:proof.id},data:{status:'consumed',updatedAt:now,revision:{increment:1}}});
 return {id,snapshotId,contentHash};
}
