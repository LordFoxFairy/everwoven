import {fields} from '../contracts/story-draft-validation.js';
import {parseRecoverFork,type RecoverForkQuery} from '../contracts/history.js';
import {isDeepStrictEqual} from 'node:util';
import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import {parseOwner} from '../contracts/story-draft-validation.js';
import {parseFork,parseForkReceipt,parseHistoryQuery,parseHistoryPage,parseSavedSceneQuery,parseSavedSceneDetail,parseResumeFork,type HistoryQuery,type SavedSceneQuery,type ForkCommand,type ForkReceipt,type ResumeForkCommand} from '../contracts/history.js';
import type {PrivateVideoMetadata} from '../ports/private-video.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {withOwnerWrite} from '../infrastructure/db/write-gate.js';
import {createExperienceOpeningReadScope} from '../infrastructure/db/prisma-experience-opening-store.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {readExecutionProfile} from './execution-profiles.js';
import {fixedExperienceFacts} from './experience-opening-facts.js';
import {readPlayedScene,readForkBase,snapshotHash} from './saved-scene.js';
import {systemServices,currentTime,nextId,type RuntimeServices} from './runtime-services.js';

export type HistoryFiles={verifyVideo(media:PrivateVideoMetadata):Promise<void>;verifyAsset(id:string):Promise<void>};
/** All history reads are free. The only new route write is an explicit idempotent fork. */
export function createExperienceHistory(db:PrismaClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,files:HistoryFiles,services:RuntimeServices=systemServices){
 parseOwner(owner);if(owner.ownerId!==authority.ownerId||owner.datasetId!==authority.datasetId)throw Error('OWNER_UNAVAILABLE');
 async function scope(datasetId:string){if(datasetId!==owner.datasetId)throw Error('DATASET_CHANGED');await authority.revalidate();}
 async function root(tx:Prisma.TransactionClient,id:string){const row=await tx.experience.findFirst({where:{id,ownerId:owner.ownerId,deletedAt:null,archivedAt:null}});if(!row)throw Error('EXPERIENCE_NOT_FOUND');return row;}
 async function allowed(tx:Prisma.TransactionClient,experienceId:string,savepointId:string){
  const active=await root(tx,experienceId),scene=await readPlayedScene(tx,owner,savepointId);
  if(scene.point.experienceId!==experienceId){
   const ref=await tx.experienceSceneRef.findUnique({where:{experienceId_savepointId:{experienceId,savepointId}}});
   if(!ref||ref.ownerId!==owner.ownerId||ref.datasetId!==owner.datasetId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
   await readForkBase(tx,owner,active);
  }
  return{active,...scene};
 }
 const brief=(scene:Awaited<ReturnType<typeof readPlayedScene>>,experienceId:string)=>({id:scene.point.id,sourceExperienceId:scene.point.experienceId,createdAt:scene.point.createdAt.toISOString(),snapshotHash:scene.snapshot.contentHash,summary:scene.state.result.summary.slice(0,300),inherited:scene.point.experienceId!==experienceId});
 const payload=(type:string,v:unknown)=>snapshotHash([type,owner.ownerId,owner.datasetId,v]);
 async function replay(tx:Prisma.TransactionClient,type:string,v:{commandId:string}){
  const row=await tx.commandReceipt.findUnique({where:{ownerId_commandId:{ownerId:owner.ownerId,commandId:v.commandId}}});if(!row)return null;
  if(row.commandType!==type||row.payloadHash!==payload(type,v))throw Error('IDEMPOTENCY_CONFLICT');if(row.schemaVersion!==1)throw Error('COMMAND_RECEIPT_INVALID');return row.response;
 }
 async function record(tx:Prisma.TransactionClient,type:string,v:{commandId:string},response:unknown,now:Date){await tx.commandReceipt.create({data:{id:nextId(services),ownerId:owner.ownerId,commandId:v.commandId,commandType:type,payloadHash:payload(type,v),response:response as Prisma.InputJsonValue,createdAt:now}});}
 function forkReceipt(value:unknown){fields(value,['input','data']);parseFork(value.input);return parseForkReceipt({data:value.data,replayed:true});}
 async function facts(tx:Prisma.TransactionClient,v:ForkCommand){
  const selected=await allowed(tx,v.experienceId,v.savepointId),source=await root(tx,selected.point.experienceId);
  if(selected.snapshot.contentHash!==v.expectedSnapshotHash)throw Error('SNAPSHOT_MISMATCH');
  const fixed=await fixedExperienceFacts(createExperienceOpeningReadScope(tx,owner.ownerId),owner,source);
  if(fixed.story.contentHash!==selected.state.storyHash||fixed.story.id!==selected.state.storyVersionId||source.providerBindingVersionId!==selected.state.videoBindingVersionId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
  const profile=await readExecutionProfile(createExecutionProfileReadScope(tx,owner.ownerId),owner,selected.state.executionProfileId);
  if(profile.contentHash!==selected.state.executionProfileHash||profile.videoBindingVersionId!==source.providerBindingVersionId)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
  const budget=source.budgetScopeId&&await tx.budgetScope.findFirst({where:{id:source.budgetScopeId,ownerId:owner.ownerId}});
  if(!budget||budget.currency!==v.currency||source.budgetCurrency!==v.currency||BigInt(v.branchBudgetLimitMicros)>budget.limitMicros)throw Error('GENERATION_BUDGET_INVALID');
  const origin=await tx.experienceFork.findUnique({where:{id:source.id}});
  if(origin)await readForkBase(tx,owner,source);
  // Explicit admission bound; never claim a truncated inherited prefix is complete.
  if(selected.state.confirmedScenes.length>1000)throw Error('HISTORY_PREFIX_LIMIT');
  const prefix=[];
  for(const fact of selected.state.confirmedScenes){
   const point=await tx.savepoint.findUnique({where:{sourceTurnId:fact.turnId}});if(!point)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
   const scene=await allowed(tx,source.id,point.id);
   if(scene.state.media.id!==fact.mediaId||scene.state.media.sha256!==fact.mediaHash||scene.state.result.summary!==fact.summary||scene.state.confirmedScenes.at(-1)?.inputAction!==fact.inputAction)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
   prefix.push({id:scene.point.id,media:scene.state.media,hash:scene.snapshot.contentHash});
  }
  const assetIds=[...new Set([...Object.values(fixed.story.assetSlots),fixed.story.mainCharacter?.effective.portraitAssetId].filter((id):id is string=>Boolean(id)))];
  const assets=[];
  for(const id of assetIds){const asset=await tx.asset.findFirst({where:{id,ownerId:owner.ownerId,status:'ready',deletedAt:null}});if(!asset)throw Error('STORY_ASSET_NOT_READY');assets.push({id,revision:asset.revision,sha256:asset.sha256});}
  return{source,selected,profile,budget,rootExperienceId:origin?.rootExperienceId??source.id,prefix,assets};
 }
 return{
  async recover(input:RecoverForkQuery){const v=parseRecoverFork(input);await scope(v.datasetId);return db.$transaction(async tx=>{
   const row=await tx.commandReceipt.findUnique({where:{ownerId_commandId:{ownerId:owner.ownerId,commandId:v.commandId}}});
   if(!row)return null;
   if(row.commandType!=='experience.fork.v1')throw Error('IDEMPOTENCY_CONFLICT');
   fields(row.response,['input','data']);const original=parseFork(row.response.input);
   if(row.commandType!=='experience.fork.v1'||row.schemaVersion!==1||original.datasetId!==v.datasetId||original.experienceId!==v.experienceId||original.commandId!==v.commandId||row.payloadHash!==payload(row.commandType,original))throw Error('IDEMPOTENCY_CONFLICT');
   return forkReceipt(row.response);
  });},
  async list(input:HistoryQuery){const v=parseHistoryQuery(input);await scope(v.datasetId);return db.$transaction(async tx=>{
   await root(tx,v.experienceId);
   const refs=await tx.experienceSceneRef.findMany({where:{experienceId:v.experienceId,ownerId:owner.ownerId,datasetId:owner.datasetId},select:{savepointId:true}});
   const rows=await tx.savepoint.findMany({where:{ownerId:owner.ownerId,datasetId:owner.datasetId,kind:'played_segment',...(v.beforeId?{id:{lt:v.beforeId}}:{}),OR:[{experienceId:v.experienceId},{id:{in:refs.map(r=>r.savepointId)}}]},orderBy:{id:'desc'},take:v.limit+1});
   const items=[];for(const point of rows.slice(0,v.limit))items.push(brief(await allowed(tx,v.experienceId,point.id),v.experienceId));
   return parseHistoryPage({protocolVersion:1,datasetId:owner.datasetId,experienceId:v.experienceId,items,nextBeforeId:rows.length>v.limit?items.at(-1)!.id:null});
  });},
  async get(input:SavedSceneQuery){const v=parseSavedSceneQuery(input);await scope(v.datasetId);return db.$transaction(async tx=>{
   const scene=await allowed(tx,v.experienceId,v.savepointId),source=await tx.experience.findFirst({where:{id:scene.point.experienceId,ownerId:owner.ownerId}});
   const budget=scene.active.budgetScopeId&&await tx.budgetScope.findFirst({where:{id:scene.active.budgetScopeId,ownerId:owner.ownerId}});
   if(!budget)throw Error('GENERATION_BUDGET_INVALID');
   return parseSavedSceneDetail({protocolVersion:1,datasetId:owner.datasetId,experienceId:v.experienceId,savepoint:brief(scene,v.experienceId),scene:scene.state.result,
    media:{turnId:scene.state.sourceTurnId,id:scene.state.media.id,duration:scene.state.media.duration},canFork:Boolean(source&&!source.deletedAt&&!source.archivedAt),budget:{limitMicros:budget.limitMicros.toString(),currency:budget.currency}});
  });},
  async fork(input:ForkCommand):Promise<ForkReceipt>{
   const v=parseFork(input);await scope(v.datasetId);const type='experience.fork.v1';
   const prior=await db.$transaction(tx=>replay(tx,type,v));if(prior)return forkReceipt(prior);
   let prepared:Awaited<ReturnType<typeof facts>>;
   try{
    prepared=await db.$transaction(tx=>facts(tx,v));
    for(const scene of prepared.prefix)await files.verifyVideo(scene.media);
    for(const asset of prepared.assets)await files.verifyAsset(asset.id);
    await authority.revalidate();
   }catch(error){const committed=await db.$transaction(tx=>replay(tx,type,v));if(committed)return forkReceipt(committed);throw error;}
   return withOwnerWrite(db,owner.ownerId,async tx=>{
    const committed=await replay(tx,type,v);if(committed)return forkReceipt(committed);
    const current=await facts(tx,v);
    if(!isDeepStrictEqual(current.prefix,prepared.prefix)||!isDeepStrictEqual(current.assets,prepared.assets))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
    const now=currentTime(services,current.selected.point.createdAt),id=nextId(services),baseId=nextId(services),eventId=nextId(services);
    const choices=current.selected.state.result.choices.map(choice=>({...choice,id:nextId(services)}));
    await tx.experience.create({data:{id,ownerId:owner.ownerId,storyVersionId:current.source.storyVersionId,providerBindingVersionId:current.source.providerBindingVersionId,budgetScopeId:current.budget.id,budgetLimitMicros:BigInt(v.branchBudgetLimitMicros),budgetCurrency:v.currency,status:'paused',schedulingPaused:true,createdAt:now,updatedAt:now}});
    await tx.experienceFork.create({data:{id,ownerId:owner.ownerId,datasetId:owner.datasetId,rootExperienceId:current.rootExperienceId,sourceExperienceId:current.source.id,sourceSavepointId:current.selected.point.id,initialSavepointId:baseId,snapshotHash:current.selected.snapshot.contentHash,createdAt:now}});
    await tx.savepoint.create({data:{id:baseId,ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:id,kind:'fork_base',stateSnapshotId:current.selected.snapshot.id,interactionEventId:eventId,createdAt:now}});
    await tx.interactionEvent.create({data:{id:eventId,ownerId:owner.ownerId,experienceId:id,kind:'decision',experienceRevision:1,options:choices,createdAt:now}});
    await tx.responseDraft.create({data:{id:nextId(services),ownerId:owner.ownerId,experienceId:id,interactionEventId:eventId,text:'',createdAt:now,updatedAt:now}});
    for(const scene of current.prefix)await tx.experienceSceneRef.create({data:{id:nextId(services),ownerId:owner.ownerId,datasetId:owner.datasetId,experienceId:id,savepointId:scene.id,createdAt:now}});
    const data={protocolVersion:1 as const,datasetId:owner.datasetId,experienceId:id,rootExperienceId:current.rootExperienceId,sourceExperienceId:current.source.id,sourceSavepointId:current.selected.point.id,initialSavepointId:baseId,initialInteractionEventId:eventId,budgetScopeId:current.budget.id,acceptedAt:now.toISOString()};
    await readForkBase(tx,owner,await root(tx,id));await record(tx,type,v,{input:v,data},now);return parseForkReceipt({data,replayed:false});
   });
  },
  async resume(input:ResumeForkCommand){const v=parseResumeFork(input);await scope(v.datasetId);const type='experience.resume-fork.v1';return withOwnerWrite(db,owner.ownerId,async tx=>{
   const prior=await replay(tx,type,v);if(prior)return prior as unknown as {protocolVersion:1;datasetId:string;experienceId:string};
   const row=await root(tx,v.experienceId);if(row.status!=='paused'||row.revision!==v.expectedExperienceRevision||row.revision!==1||row.rowRevision>=2147483647)throw Error('REVISION_CONFLICT');
   const {base}=await readForkBase(tx,owner,row);
   if(await tx.generationQuote.count({where:{experienceId:row.id,acceptedTurnId:{not:null}}}))throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
   const event=await tx.interactionEvent.findFirst({where:{id:base.interactionEventId,experienceId:row.id,ownerId:owner.ownerId,experienceRevision:1,kind:'decision'}});if(!event)throw Error('SAVEPOINT_SOURCE_UNAVAILABLE');
   const now=currentTime(services,row.updatedAt);await tx.experience.update({where:{id:row.id},data:{status:'awaiting',updatedAt:now,rowRevision:{increment:1}}});
   const data={protocolVersion:1 as const,datasetId:owner.datasetId,experienceId:row.id};await record(tx,type,v,data,now);return data;
  });},
 };
}
