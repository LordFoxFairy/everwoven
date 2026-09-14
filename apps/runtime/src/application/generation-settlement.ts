import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Prisma,StageCostEvidence} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import type {TextObservation} from '../ports/structured-text.js';
import type {VideoJobSnapshot,VideoTaskReference} from '../ports/video-jobs.js';
import type {GenerationPolicy} from '../ports/generation-policy.js';
import type {GenerationMeters} from './generation-pricing.js';
import {calculateGenerationCost} from './generation-pricing.js';
import {canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {costMicros,parseAccountCost} from '../contracts/account-cost.js';
import {readExecutionProfile} from './execution-profiles.js';
import {createExecutionProfileReadScope} from '../infrastructure/db/prisma-execution-profile-store.js';
import {currentTime,nextId,type RuntimeServices} from './runtime-services.js';
const stages=['planner','video','validator'] as const;
type Stage=typeof stages[number];
type Evidence={kind:'text';observation:TextObservation}|{kind:'video';reference:VideoTaskReference;snapshot:Omit<VideoJobSnapshot,'video'>};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digest=(r:Omit<StageCostEvidence,'contentHash'>)=>hash(['everwoven.stage-cost.v1',r.id,r.ownerId,r.datasetId,r.storeEpoch,r.turnId,r.quoteId,r.stage,r.bindingHash,r.basis,r.amountMicros?.toString()??null,r.currency,canonicalBindingJson(r.evidence),r.createdAt.toISOString(),r.schemaVersion]);
type Snapshot={profileHash:string;prices:ReturnType<GenerationPolicy['resolve']>['prices'];meters:Record<Stage,GenerationMeters>};
async function facts(tx:Prisma.TransactionClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,turnId:string){
 const turn=await tx.generationTurn.findFirst({where:{id:turnId,ownerId:owner.ownerId}});
 const quote=turn&&await tx.generationQuote.findFirst({where:{id:turn.quoteId,ownerId:owner.ownerId}});
 const reservation=turn&&await tx.budgetReservation.findFirst({where:{id:turn.id,ownerId:owner.ownerId}});
 const root=turn&&await tx.experience.findFirst({where:{id:turn.experienceId,ownerId:owner.ownerId}});
 if(!turn||!quote||!reservation||!root||quote.datasetId!==owner.datasetId||quote.storeEpoch!==authority.storeEpoch||quote.schemaVersion!==1||quote.acceptedTurnId!==turn.id||quote.experienceId!==turn.experienceId||quote.interactionEventId!==turn.interactionEventId||reservation.experienceId!==turn.experienceId||reservation.budgetScopeId!==turn.budgetScopeId||root.budgetScopeId!==turn.budgetScopeId||reservation.currency!==quote.currency||quote.contentHash!==hash([quote.storeEpoch,quote.interactionEventId,quote.snapshot]))throw Error('COST_CONTEXT_INVALID');
 const snapshot=quote.snapshot as unknown as Snapshot;
 const profile=await readExecutionProfile(createExecutionProfileReadScope(tx,owner.ownerId),owner,quote.profileId);
 if(snapshot.profileHash!==profile.contentHash||profile.videoBindingVersionId!==root.providerBindingVersionId)throw Error('COST_CONTEXT_INVALID');
 const limits={} as Record<Stage,bigint>;
 for(const stage of stages){if(snapshot.prices[stage].bindingHash!==hash(canonicalBindingJson(profile.snapshot[stage].binding)))throw Error('COST_CONTEXT_INVALID');limits[stage]=calculateGenerationCost(snapshot.prices[stage],snapshot.meters[stage],profile.snapshot.currency,quote.createdAt);}
 if(stages.reduce((sum,stage)=>sum+limits[stage],0n)!==quote.maxCostMicros)throw Error('COST_CONTEXT_INVALID');
 return{turn,quote,reservation,snapshot,profile,limits};
}
function charge(evidence:Evidence,price:Snapshot['prices'][Stage]):{amount:bigint|null;minimum:bigint}{
 if(evidence.kind==='text'){
  if(evidence.observation.accountCost===undefined)return{amount:null,minimum:0n};
  const cost=parseAccountCost(evidence.observation.accountCost);
  if(cost.currency!==price.currency)return{amount:null,minimum:0n};
  const value=costMicros(cost.amount);return{amount:value,minimum:value};
 }
 const usage=evidence.snapshot.usage;
 if(evidence.snapshot.status!=='succeeded'||!usage)return{amount:null,minimum:0n};
 // Missing billed dimensions prevent settlement but do not erase known liability.
 const seconds=usage.output_seconds===undefined?0n:costMicros(String(usage.output_seconds),BigInt(price.outputSecondMicros));
 const images=BigInt(usage.input_image_count??0)*BigInt(price.inputImageMicros),minimum=seconds+images;
 if(minimum>9223372036854775807n)throw Error('INVALID_COST_EVIDENCE');
 const complete=usage.output_seconds!==undefined&&(price.inputImageMicros==='0'||usage.input_image_count!==undefined);
 return{amount:complete?minimum:null,minimum};
}
/** Called inside the same writer transaction as the accepted stage result; no provider I/O. */
export async function recordStageCost(tx:Prisma.TransactionClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,turnId:string,stage:Stage,evidence:Evidence,services:RuntimeServices){
 const f=await facts(tx,owner,authority,turnId),binding=f.profile.snapshot[stage].binding,bindingHash=hash(canonicalBindingJson(binding));
 if(stage==='video'){
  if(evidence.kind!=='video'||!isDeepStrictEqual(f.turn.providerReference,evidence.reference)||evidence.reference.operationId!==turnId||evidence.reference.bindingHash!==bindingHash||evidence.reference.taskId!==evidence.snapshot.taskId||!['succeeded','failed','cancelled'].includes(evidence.snapshot.status))throw Error('COST_CONTEXT_INVALID');
 }else if(evidence.kind!=='text'||evidence.observation.bindingHash!==bindingHash||evidence.observation.providerId!==binding.providerId||evidence.observation.modelId!==binding.modelId)throw Error('COST_CONTEXT_INVALID');
 const normalized=canonicalBindingJson(evidence),value=charge(evidence,f.snapshot.prices[stage]).amount,basis=evidence.kind==='text'?'account-charge':'metered-tariff';
 const prior=await tx.stageCostEvidence.findUnique({where:{turnId_stage:{turnId,stage}}});
 if(prior){if(prior.contentHash!==digest(prior)||prior.ownerId!==owner.ownerId||prior.datasetId!==owner.datasetId||prior.storeEpoch!==authority.storeEpoch||prior.quoteId!==f.quote.id||prior.bindingHash!==bindingHash||prior.amountMicros!==value||prior.basis!==basis||!isDeepStrictEqual(prior.evidence,normalized))throw Error('COST_EVIDENCE_CONFLICT');return;}
 const now=currentTime(services,f.turn.createdAt),row={id:nextId(services),ownerId:owner.ownerId,datasetId:owner.datasetId,storeEpoch:authority.storeEpoch,turnId,quoteId:f.quote.id,stage,bindingHash,basis,amountMicros:value,currency:f.quote.currency,evidence:normalized as Prisma.InputJsonValue,createdAt:now,schemaVersion:1};
 await tx.stageCostEvidence.create({data:{...row,contentHash:digest(row as Omit<StageCostEvidence,'contentHash'>)}});
 const costs=await tx.stageCostEvidence.findMany({where:{turnId}}),known=costs.reduce((sum,c)=>sum+charge(c.evidence as unknown as Evidence,f.snapshot.prices[c.stage as Stage]).minimum,0n);
 if(known>9223372036854775807n)throw Error('INVALID_COST_EVIDENCE');
 if(charge(evidence,f.snapshot.prices[stage]).minimum>f.limits[stage]||known>f.quote.maxCostMicros){
  // Preserve the full known liability even when a provider exceeded its approved bound.
  await tx.budgetReservation.update({where:{id:turnId},data:{reviewRequired:true,reservedMicros:known>f.reservation.reservedMicros?known:f.reservation.reservedMicros,updatedAt:now,revision:{increment:1}}});
 }
}
/** First settlement is the reservation transition, committed with immutable evidence and final turn state. */
export async function settleTurnCost(tx:Prisma.TransactionClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,turnId:string,services:RuntimeServices){
 const f=await facts(tx,owner,authority,turnId);
 if(!['ready','viewed','failed','unknown'].includes(f.turn.status))return;
 const rows=await tx.stageCostEvidence.findMany({where:{turnId}});
 if(rows.length!==3)return;
 for(const stage of stages){const row=rows.find(r=>r.stage===stage);if(!row||row.ownerId!==owner.ownerId||row.datasetId!==owner.datasetId||row.storeEpoch!==authority.storeEpoch||row.quoteId!==f.quote.id||row.schemaVersion!==1||row.bindingHash!==hash(canonicalBindingJson(f.profile.snapshot[stage].binding))||row.currency!==f.quote.currency||row.contentHash!==digest(row))throw Error('STORED_COST_EVIDENCE_INVALID');if(row.amountMicros===null)return;}
 const total=rows.reduce((sum,r)=>sum+r.amountMicros!,0n);
 if(f.reservation.reviewRequired)return;
 if(total>f.quote.maxCostMicros||rows.some(r=>r.amountMicros!>f.limits[r.stage as Stage]))throw Error('STORED_COST_EVIDENCE_INVALID');
 if(f.reservation.status!=='held'){if(f.reservation.reservedMicros!==0n||f.reservation.settledMicros!==total||f.reservation.status!==(total===0n?'released':'settled'))throw Error('STORED_COST_EVIDENCE_INVALID');return;}
 if(f.reservation.settledMicros!==0n||f.reservation.reservedMicros!==f.quote.maxCostMicros)throw Error('STORED_COST_EVIDENCE_INVALID');
 await tx.budgetReservation.update({where:{id:turnId},data:{reservedMicros:0n,settledMicros:total,status:total===0n?'released':'settled',updatedAt:currentTime(services,f.turn.createdAt),revision:{increment:1}}});
}
/** Historical accounting reads require no installed provider and never settle as a GET side effect. */
export async function readCostEvidence(tx:Prisma.TransactionClient,owner:InternalOwnerContext,authority:LocalStoreAuthority,turnId:string){
 const f=await facts(tx,owner,authority,turnId),rows=await tx.stageCostEvidence.findMany({where:{turnId}});
 for(const row of rows)if(row.ownerId!==owner.ownerId||row.datasetId!==owner.datasetId||row.storeEpoch!==authority.storeEpoch||row.quoteId!==f.quote.id||row.schemaVersion!==1||!stages.includes(row.stage as Stage)||row.currency!==f.quote.currency||row.bindingHash!==hash(canonicalBindingJson(f.profile.snapshot[row.stage as Stage].binding))||row.contentHash!==digest(row))throw Error('STORED_COST_EVIDENCE_INVALID');
 return{...f,rows};
}
