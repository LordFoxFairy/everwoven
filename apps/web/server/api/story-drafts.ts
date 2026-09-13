import {localStoryError} from '../local-runtime';
import {z} from 'zod';
import {parseCreate, parseUpdate, parseLifecycle, parseGet, parseList} from 'runtime/contracts/story-draft-validation';
import {parseDraftDTO, parseDraftPage, parseDraftCommandResult} from 'runtime/contracts/story-draft-output';
import type {DraftCreate, DraftUpdate, DraftLifecycle, DraftGet, DraftListInput, StoryProtocol, DraftDTO, DraftPage, DraftCommandResult} from '../../../runtime/src/contracts/story-draft';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';

const storyProcedure = publicMetadataProcedure.use(async ({ctx, next, type}) => {
  if (!ctx.withStories) throw localStoryError(Error('LOCAL_SESSION_INVALID'));
  try {
    // Keep the returned error result outside Host; domain work errors are issued below.
    const result = await ctx.withStories((stories, owner) => next({ctx: {...ctx, stories, owner}}));
    if (!result.ok) {
      const error = localStoryError(result.error);
      if (result.error.code === 'BAD_REQUEST' && error.code === 'INTERNAL_SERVER_ERROR')
        throw localStoryError(Error(type === 'query' ? 'INVALID_STORY_QUERY' : 'INVALID_STORY_COMMAND'));
      throw error;
    }
    return result;
  } catch (error) {throw localStoryError(error);}
});
function input<T>(parse: (value: unknown) => T, value: unknown): T {
  try {return parse(value);} catch (error) {throw localStoryError(error);}
}
// Carry the one public DTO as tRPC's input type; all runtime validation still
// belongs to the shared unknown-accepting parser, including protocol-first errors.
const parser = <I, O = I>(parse: (value: unknown) => O) => z.custom<I>().transform(value => input(parse, value));
function responseData(result: DraftDTO | DraftPage | DraftCommandResult): StoryProtocol {
  return 'data' in result ? result.data : result;
}
async function operation<T extends DraftDTO | DraftPage | DraftCommandResult>(
  parse: (value: unknown) => T, request: StoryProtocol, datasetId: string, work: () => Promise<unknown>,
): Promise<T> {
  try {
    if (request.datasetId !== datasetId) throw Error('DATASET_CHANGED');
    const parsed = parse(await work());
    const data = responseData(parsed);
    if (data.datasetId !== datasetId) throw Error('INVALID_STORY_DTO');
    return parsed;
  } catch (error) {throw localStoryError(error);}
}
export const storyDraftRouter = createTRPCRouter({
  create: storyProcedure.input(parser<DraftCreate>(parseCreate))
    .mutation(({ctx, input}) => operation(parseDraftCommandResult, input, ctx.owner.datasetId, () => ctx.stories.create(ctx.owner, input))),
  get: storyProcedure.input(parser<DraftGet, ReturnType<typeof parseGet>>(parseGet))
    .query(({ctx, input}) => operation(parseDraftDTO, input, ctx.owner.datasetId, () => ctx.stories.get(ctx.owner, input))),
  list: storyProcedure.input(parser<DraftListInput, ReturnType<typeof parseList>>(parseList))
    .query(({ctx, input}) => operation(parseDraftPage, input, ctx.owner.datasetId, () => ctx.stories.list(ctx.owner, input))),
  update: storyProcedure.input(parser<DraftUpdate>(parseUpdate))
    .mutation(({ctx, input}) => operation(parseDraftCommandResult, input, ctx.owner.datasetId, () => ctx.stories.update(ctx.owner, input))),
  delete: storyProcedure.input(parser<DraftLifecycle>(parseLifecycle))
    .mutation(({ctx, input}) => operation(parseDraftCommandResult, input, ctx.owner.datasetId, () => ctx.stories.delete(ctx.owner, input))),
  restore: storyProcedure.input(parser<DraftLifecycle>(parseLifecycle))
    .mutation(({ctx, input}) => operation(parseDraftCommandResult, input, ctx.owner.datasetId, () => ctx.stories.restore(ctx.owner, input))),
});
