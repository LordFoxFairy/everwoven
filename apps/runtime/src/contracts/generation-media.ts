import {fields, parseId} from './story-draft-validation.js';
export type GetGenerationMedia = {datasetId: string; experienceId: string; turnId: string; mediaId: string};
export function parseGetGenerationMedia(value: unknown): GetGenerationMedia {
  try {
    fields(value, ['datasetId', 'experienceId', 'turnId', 'mediaId']);
    return {datasetId: parseId(value.datasetId), experienceId: parseId(value.experienceId), turnId: parseId(value.turnId), mediaId: parseId(value.mediaId)};
  } catch {throw Error('INVALID_GENERATION_MEDIA_QUERY');}
}
