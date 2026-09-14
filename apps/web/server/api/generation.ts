import {parseGetResponseDraft,parseSaveResponseDraft,parseResponseDraft} from 'runtime/contracts/generation';
import {z} from 'zod';
import {parseGetPlay, parseCompletePlayback, parseGenerationQuote, parseAcceptGeneration, parseGetQuote} from 'runtime/contracts/generation';
import {parsePlayDTO, parsePlaybackResult, parseQuoteResult, parseAcceptResult, parseQuoteState} from 'runtime/contracts/generation-output';
import {localGenerationError} from '../local-generation';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';

const playbackProcedure = publicMetadataProcedure.use(async ({ctx, next, type}) => {
  if (!ctx.withPlayback) throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
  try {
    const result = await ctx.withPlayback((playback, owner) => next({ctx: {...ctx, playback, owner}}));
    if (!result.ok) {
      const error = localGenerationError(result.error);
      if (result.error.code === 'BAD_REQUEST' && error.code === 'INTERNAL_SERVER_ERROR')
        throw localGenerationError(Error(type === 'query' ? 'INVALID_GENERATION_QUERY' : 'INVALID_GENERATION_COMMAND'));
      throw error;
    }
    return result;
  } catch (error) {throw localGenerationError(error);}
});
const parser = <T,>(parse: (value: unknown) => T) => z.custom<T>().transform(value => {
  try {return parse(value);} catch (error) {throw localGenerationError(error);}
});
const generationProcedure = publicMetadataProcedure.use(async ({ctx, next, type}) => {
 if (!ctx.withGeneration) throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
 try {
  const result = await ctx.withGeneration((generation, owner) => next({ctx: {...ctx, generation, owner}}));
  if (!result.ok) {
   const error = localGenerationError(result.error);
   if (result.error.code === 'BAD_REQUEST' && error.code === 'INTERNAL_SERVER_ERROR') throw localGenerationError(Error(type === 'query' ? 'INVALID_GENERATION_QUERY' : 'INVALID_GENERATION_COMMAND'));
   throw error;
  }return result;
 } catch (error) {throw localGenerationError(error);}
});
export const generationRouter = createTRPCRouter({
 getDraft:generationProcedure.input(parser(parseGetResponseDraft)).query(async({ctx,input})=>{
  try {if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const data=parseResponseDraft(await ctx.generation.getDraft(input));
   if(data.datasetId!==input.datasetId||data.experienceId!==input.experienceId||data.interactionEventId!==input.interactionEventId)throw Error('INVALID_GENERATION_DTO');return data;
  }catch(error){throw localGenerationError(error);}
 }),
 saveDraft:generationProcedure.input(parser(parseSaveResponseDraft)).mutation(async({ctx,input})=>{
  try {if(input.datasetId!==ctx.owner.datasetId)throw Error('DATASET_CHANGED');const data=parseResponseDraft(await ctx.generation.saveDraft(input));
   if(data.datasetId!==input.datasetId||data.experienceId!==input.experienceId||data.interactionEventId!==input.interactionEventId||data.text!==input.text||data.revision!==input.expectedDraftRevision+1)throw Error('INVALID_GENERATION_DTO');return data;
  }catch(error){throw localGenerationError(error);}
 }),
 quote: generationProcedure.input(parser(parseGenerationQuote)).mutation(async ({ctx, input}) => {
  try {if (input.datasetId !== ctx.owner.datasetId) throw Error('DATASET_CHANGED');return parseQuoteResult(await ctx.generation.quote(input), input);}
  catch (error) {throw localGenerationError(error);}
 }),
 accept: generationProcedure.input(parser(parseAcceptGeneration)).mutation(async ({ctx, input}) => {
  try {if (input.datasetId !== ctx.owner.datasetId) throw Error('DATASET_CHANGED');return parseAcceptResult(await ctx.generation.accept(input), input);}
  catch (error) {throw localGenerationError(error);}
 }),
 getQuote: generationProcedure.input(parser(parseGetQuote)).query(async ({ctx, input}) => {
  try {
   if (input.datasetId !== ctx.owner.datasetId) throw Error('DATASET_CHANGED');const result = parseQuoteState(await ctx.generation.getQuote(input));
   if (result.quote.id !== input.quoteId || result.quote.datasetId !== input.datasetId || result.quote.experienceId !== input.experienceId) throw Error('INVALID_GENERATION_DTO');return result;
  } catch (error) {throw localGenerationError(error);}
 }),
  get: playbackProcedure.input(parser(parseGetPlay)).query(async ({ctx, input}) => {
    try {
      if (input.datasetId !== ctx.owner.datasetId) throw Error('DATASET_CHANGED');
      const data = parsePlayDTO(await ctx.playback.get(input));
      if (data.datasetId !== input.datasetId || data.experienceId !== input.experienceId) throw Error('INVALID_GENERATION_DTO');
      return data;
    } catch (error) {throw localGenerationError(error);}
  }),
  completePlayback: playbackProcedure.input(parser(parseCompletePlayback)).mutation(async ({ctx, input}) => {
    try {
      if (input.datasetId !== ctx.owner.datasetId) throw Error('DATASET_CHANGED');
      return parsePlaybackResult(await ctx.playback.completePlayback(input), input);
    } catch (error) {throw localGenerationError(error);}
  }),
});
