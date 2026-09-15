import {fields} from '../contracts/story-draft-validation.js';
/** Browser-safe public constraints; no transport, credentials or Node imports. */
export const POLLO_MODEL = 'minimax-hailuo-03-max';
export type PolloRegion = 'test' | 'production';
export function polloRegion(value: unknown): PolloRegion {
 if (value !== 'test' && value !== 'production') throw Error('INVALID_POLLO_BINDING');
 return value;
}
export const polloRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export function validatePolloGeneration(model: string, operation: string, input: unknown) {
 fields(input, ['duration', 'resolution', 'ratio']);
 if (model !== POLLO_MODEL || operation !== 'text-to-video' || !Number.isSafeInteger(input.duration) ||
  (input.duration as number) < 5 || (input.duration as number) > 15 ||
  !['480P', '768P'].includes(input.resolution as string) || !polloRatios.includes(input.ratio as string)) throw Error('INVALID_POLLO_GENERATION');
 return {duration: input.duration as number, resolution: input.resolution as string, ratio: input.ratio as string};
}
