import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {LocalStoreAuthority} from '../host/store-epoch.js';
import {parseCostQuery,parseCostDTO,type CostQuery,type CostDTO} from '../contracts/generation-cost.js';
import {readCostEvidence} from './generation-settlement.js';
export function createGenerationCostReader(db:PrismaClient,owner:InternalOwnerContext,authority:LocalStoreAuthority){
 return async(input:CostQuery):Promise<CostDTO>=>{
  const v=parseCostQuery(input);if(v.datasetId!==owner.datasetId)throw Error('DATASET_CHANGED');await authority.revalidate();
  return db.$transaction(async tx=>{
   const turn=await tx.generationTurn.findFirst({where:{id:v.turnId,experienceId:v.experienceId,ownerId:owner.ownerId}});if(!turn)throw Error('EXPERIENCE_NOT_FOUND');
   const {quote,reservation,rows}=await readCostEvidence(tx,owner,authority,turn.id);
   return parseCostDTO({...v,currency:quote.currency,quotedMicros:quote.maxCostMicros.toString(),reservedMicros:reservation.reservedMicros.toString(),settledMicros:reservation.settledMicros.toString(),status:reservation.status,reviewRequired:reservation.reviewRequired,
    stages:['planner','video','validator'].map(stage=>({stage,basis:stage==='video'?'metered-tariff':'account-charge',amountMicros:rows.find(row=>row.stage===stage)?.amountMicros?.toString()??null}))});
  });
 };
}
