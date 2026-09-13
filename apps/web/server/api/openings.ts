import {z} from 'zod';
import {parseCreateExperience, parseGetPreparingExperience} from 'runtime/contracts/experience-opening-validation';
import {parseExperienceOpeningDTO, parseExperienceOpeningResult, parseBindingDirectory} from 'runtime/contracts/experience-opening-output';
import {fields, parseProtocol} from 'runtime/contracts/story-draft-validation';
import type {CreateExperience, GetPreparingExperience, ExperienceOpeningDTO, ExperienceOpeningResult} from 'runtime/contracts/experience-opening';
import type {BindingDirectory} from 'runtime/contracts/video-binding-registry';
import type {StoryProtocol} from 'runtime/contracts/story-draft';
import {localOpeningError} from '../local-openings';
import {createTRPCRouter, publicMetadataProcedure} from './trpc';

const openingProcedure = publicMetadataProcedure.use(async ({ctx, next, type}) => {
  if (!ctx.withOpenings) throw localOpeningError(Error('LOCAL_SESSION_INVALID'));
  try {
    const result = await ctx.withOpenings((openings, owner) => next({ctx: {...ctx, openings, owner}}));
    if (!result.ok) {
      const error = localOpeningError(result.error);
      if (result.error.code === 'BAD_REQUEST' && error.code === 'INTERNAL_SERVER_ERROR')
        throw localOpeningError(Error(type === 'query' ? 'INVALID_EXPERIENCE_QUERY' : 'INVALID_EXPERIENCE_COMMAND'));
      throw error;
    }
    return result;
  } catch (error) {throw localOpeningError(error);}
});
const parser = <T,>(parse: (value: unknown) => T) => z.custom<T>().transform(value => {
  try {return parse(value);} catch (error) {throw localOpeningError(error);}
});
function parseDirectoryQuery(value: unknown): StoryProtocol {
  const protocol = parseProtocol(value);
  try {fields(value, ['protocolVersion', 'datasetId']); return protocol;} catch {throw Error('INVALID_EXPERIENCE_QUERY');}
}
async function operation<T extends ExperienceOpeningDTO | ExperienceOpeningResult | BindingDirectory>(
  parse: (value: unknown) => T, request: StoryProtocol, datasetId: string, work: () => unknown,
): Promise<T> {
  try {
    if (request.datasetId !== datasetId) throw Error('DATASET_CHANGED');
    const result = parse(await work()), data = responseProtocol(result);
    if (data.datasetId !== datasetId) throw Error('INVALID_EXPERIENCE_DTO');
    return result;
  } catch (error) {throw localOpeningError(error);}
}
function responseProtocol(result: ExperienceOpeningDTO | ExperienceOpeningResult | BindingDirectory): StoryProtocol {
  return 'data' in result ? result.data : result;
}
function createOutput(input: CreateExperience) {
  return (raw: unknown) => {
    const result = parseExperienceOpeningResult(raw), d = result.data;
    if (d.story.storyDraftId !== input.storyDraftId || d.story.sourceRevision !== input.expectedStoryRevision ||
      d.binding.bindingKey !== input.bindingKey || d.binding.versionNo !== input.expectedBindingVersion ||
      d.budget.limitMicros !== input.budget.limitMicros || d.budget.currency !== input.budget.currency)
      throw Error('INVALID_EXPERIENCE_DTO');
    return result;
  };
}
export const openingRouter = createTRPCRouter({
  bindings: openingProcedure.input(parser<StoryProtocol>(parseDirectoryQuery))
    .query(({ctx, input}) => operation(parseBindingDirectory, input, ctx.owner.datasetId, () => ctx.openings.bindings())),
  create: openingProcedure.input(parser<CreateExperience>(parseCreateExperience))
    .mutation(({ctx, input}) => operation(createOutput(input), input, ctx.owner.datasetId, () => ctx.openings.create(ctx.owner, input))),
  getPreparing: openingProcedure.input(parser<GetPreparingExperience>(parseGetPreparingExperience))
    .query(({ctx, input}) => operation(raw => {
      const data = parseExperienceOpeningDTO(raw);
      if (data.id !== input.id) throw Error('INVALID_EXPERIENCE_DTO');
      return data;
    }, input, ctx.owner.datasetId, () => ctx.openings.getPreparing(ctx.owner, input))),
});
