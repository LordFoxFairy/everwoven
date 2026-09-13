import {fields} from '../contracts/story-draft-validation.js';

export const miniMaxRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const miniMaxModelLimits = {
  'MiniMax-H3': {resolutions: ['768P', '2K'], minSeconds: 4, maxSeconds: 15, documentedReferences: true},
  'MiniMax-H3-Max': {resolutions: ['480P', '768P'], minSeconds: 5, maxSeconds: 15, documentedReferences: false},
} as const;
export function validateMiniMaxGeneration(modelId: string, operation: string, input: unknown) {
  fields(input, ['duration', 'resolution', 'ratio']);
  if (!Object.hasOwn(miniMaxModelLimits, modelId)) throw Error('INVALID_MINIMAX_GENERATION');
  const limits = miniMaxModelLimits[modelId as keyof typeof miniMaxModelLimits];
  if (typeof input.duration !== 'number' || !Number.isInteger(input.duration) || input.duration < limits.minSeconds || input.duration > limits.maxSeconds ||
    !(limits.resolutions as readonly unknown[]).includes(input.resolution) ||
    (operation === 'text-to-video' ? !(miniMaxRatios as readonly unknown[]).includes(input.ratio) :
      operation !== 'image-to-video' || input.ratio !== 'adaptive')) throw Error('INVALID_MINIMAX_GENERATION');
  return {duration: input.duration, resolution: input.resolution as string, ratio: input.ratio as string};
}

export type MiniMaxRegion = 'cn' | 'international';
export function miniMaxRegion(value: unknown): MiniMaxRegion {
  if (value !== 'cn' && value !== 'international') throw Error('INVALID_MINIMAX_REGION');
  return value;
}
