import {z} from 'zod';
import {parseGetPlay, parseCompletePlayback} from 'runtime/contracts/generation';
import {parsePlayDTO, parsePlaybackResult} from 'runtime/contracts/generation-output';
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
export const generationRouter = createTRPCRouter({
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
