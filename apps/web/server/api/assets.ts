import {parseBeginUpload, parseGetUpload, parseCompleteUpload, parseUploadIntentDTO, parseAssetDTO} from 'runtime/contracts/asset-validation';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';
import {assetTRPCError} from '../asset-errors';
import {assetOutput, commandOutput} from '../asset-responses';

const assetProcedure = publicMetadataProcedure.use(async ({ctx, next, type}) => {
  if (!ctx.withAssets) throw assetTRPCError(Error('LOCAL_SESSION_INVALID'));
  try {
    // next() returns errors as data; examine its result outside the Host work callback.
    const result = await ctx.withAssets(assets => next({ctx: {...ctx, assets}}));
    if (!result.ok) {
      const error = assetTRPCError(result.error);
      // Raw JSON decoding fails before the input parser. Resolver/work exceptions have
      // already passed operation(), so an unissued BAD_REQUEST here is framework input failure.
      if (result.error.code === 'BAD_REQUEST' && error.code === 'INTERNAL_SERVER_ERROR')
        throw assetTRPCError(Error(type === 'query' ? 'INVALID_ASSET_QUERY' : 'INVALID_ASSET_COMMAND'));
      throw error;
    }
    return result;
  } catch (error) {throw assetTRPCError(error);}
});
function input<T>(parse: (value: unknown) => T, value: unknown, code: 'INVALID_ASSET_COMMAND' | 'INVALID_ASSET_QUERY'): T {
  try {return parse(value);} catch {throw assetTRPCError(Error(code));}
}
async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {return await work();} catch (error) {throw assetTRPCError(error);}
}
export const assetRouter = createTRPCRouter({
  beginUpload: assetProcedure.input(value => input(parseBeginUpload, value, 'INVALID_ASSET_COMMAND'))
    .mutation(({ctx, input}) => operation(async () => commandOutput(parseUploadIntentDTO, await ctx.assets.begin(input)))),
  getUpload: assetProcedure.input(value => input(parseGetUpload, value, 'INVALID_ASSET_QUERY'))
    .query(({ctx, input}) => operation(async () => assetOutput(parseUploadIntentDTO, await ctx.assets.getUpload(input)))),
  completeUpload: assetProcedure.input(value => input(parseCompleteUpload, value, 'INVALID_ASSET_COMMAND'))
    .mutation(({ctx, input}) => operation(async () => commandOutput(parseAssetDTO, await ctx.assets.complete(input)))),
});
