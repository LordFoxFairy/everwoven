import {fields,parseId,parseProtocol} from './story-draft-validation.js';
import type {StoryProtocol} from './story-draft.js';
export type CostQuery=StoryProtocol&{experienceId:string;turnId:string};
export type CostDTO=CostQuery&{currency:'USD'|'CNY';quotedMicros:string;reservedMicros:string;settledMicros:string;status:'held'|'settled'|'released';reviewRequired:boolean;stages:{stage:'planner'|'video'|'validator';basis:'account-charge'|'metered-tariff';amountMicros:string|null}[]};
const money=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(v)||BigInt(v)>9223372036854775807n)throw Error();return v;};
export function parseCostQuery(v:unknown):CostQuery{try{fields(v,['protocolVersion','datasetId','experienceId','turnId']);return{...parseProtocol(v),experienceId:parseId(v.experienceId),turnId:parseId(v.turnId)};}catch(error){if(error instanceof Error&&error.message==='CLIENT_RELOAD_REQUIRED')throw error;throw Error('INVALID_GENERATION_QUERY');}}
export function parseCostDTO(v:unknown):CostDTO{try{
 fields(v,['protocolVersion','datasetId','experienceId','turnId','currency','quotedMicros','reservedMicros','settledMicros','status','reviewRequired','stages']);
 if(!['USD','CNY'].includes(v.currency as string)||!['held','settled','released'].includes(v.status as string)||typeof v.reviewRequired!=='boolean'||!Array.isArray(v.stages)||v.stages.length!==3)throw Error();
 const stages=v.stages.map((row,i)=>{fields(row,['stage','basis','amountMicros']);if(row.stage!==['planner','video','validator'][i]||row.basis!==(row.stage==='video'?'metered-tariff':'account-charge'))throw Error();return{stage:row.stage,basis:row.basis,amountMicros:row.amountMicros===null?null:money(row.amountMicros)} as CostDTO['stages'][number];});
 const quotedMicros=money(v.quotedMicros),reservedMicros=money(v.reservedMicros),settledMicros=money(v.settledMicros);
 if(v.status!=='held'&&(reservedMicros!=='0'||v.reviewRequired||stages.some(s=>s.amountMicros===null)||stages.reduce((s,r)=>s+BigInt(r.amountMicros!),0n)!==BigInt(settledMicros)))throw Error();
 if(v.status==='released'&&settledMicros!=='0'||v.status==='held'&&settledMicros!=='0')throw Error();
 return{...parseProtocol(v),experienceId:parseId(v.experienceId),turnId:parseId(v.turnId),currency:v.currency as CostDTO['currency'],quotedMicros,reservedMicros,settledMicros,status:v.status as CostDTO['status'],reviewRequired:v.reviewRequired,stages};
 }catch{throw Error('INVALID_GENERATION_DTO');}}
