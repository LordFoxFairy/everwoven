import {z} from 'zod';
import {parseRecoverFork,parseHistoryQuery,parseSavedSceneQuery,parseFork,parseResumeFork,parseHistoryPage,parseSavedSceneDetail,parseForkReceipt} from 'runtime/contracts/history';
import {parseGetPlay} from 'runtime/contracts/generation';
import {createTRPCRouter,publicMetadataProcedure} from './trpc';
import {localGenerationError} from '../local-generation';
const parser=<T,>(parse:(v:unknown)=>T)=>z.custom<T>().transform(v=>{try{return parse(v);}catch(e){throw localGenerationError(e);}});
const historyProcedure=publicMetadataProcedure.use(async({ctx,next})=>{
 if(!ctx.withHistory)throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
 try{const result=await ctx.withHistory((history,owner)=>next({ctx:{...ctx,history,owner}}));if(!result.ok)throw localGenerationError(result.error);return result;}catch(error){throw localGenerationError(error);}
});
export const historyRouter=createTRPCRouter({
 recover:historyProcedure.input(parser(parseRecoverFork)).query(async({ctx,input})=>{try{if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const r=await ctx.history.recover(input);if(r===null)return null;const data=parseForkReceipt(r);if(data.data.datasetId!==input.datasetId)throw Error('INVALID_GENERATION_DTO');return data;}catch(e){throw localGenerationError(e);}}),
 list:historyProcedure.input(parser(parseHistoryQuery)).query(async({ctx,input})=>{try{if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const r=parseHistoryPage(await ctx.history.list(input));if(r.datasetId!==input.datasetId||r.experienceId!==input.experienceId)throw Error('INVALID_GENERATION_DTO');return r;}catch(e){throw localGenerationError(e);}}),
 get:historyProcedure.input(parser(parseSavedSceneQuery)).query(async({ctx,input})=>{try{if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const r=parseSavedSceneDetail(await ctx.history.get(input));if(r.datasetId!==input.datasetId||r.experienceId!==input.experienceId||r.savepoint.id!==input.savepointId)throw Error('INVALID_GENERATION_DTO');return r;}catch(e){throw localGenerationError(e);}}),
 fork:historyProcedure.input(parser(parseFork)).mutation(async({ctx,input})=>{try{if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const r=parseForkReceipt(await ctx.history.fork(input));if(r.data.datasetId!==input.datasetId||r.data.sourceSavepointId!==input.savepointId)throw Error('INVALID_GENERATION_DTO');return r;}catch(e){throw localGenerationError(e);}}),
 resume:historyProcedure.input(parser(parseResumeFork)).mutation(async({ctx,input})=>{try{if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const r=parseGetPlay(await ctx.history.resume(input));if(r.datasetId!==input.datasetId||r.experienceId!==input.experienceId)throw Error('INVALID_GENERATION_DTO');return r;}catch(e){throw localGenerationError(e);}}),
});
