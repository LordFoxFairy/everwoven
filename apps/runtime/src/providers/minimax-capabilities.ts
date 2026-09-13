import {miniMaxRatios, miniMaxModelLimits, validateMiniMaxGeneration, miniMaxRegion, type MiniMaxRegion} from './minimax-constraints.js';
export {validateMiniMaxGeneration, miniMaxRegion} from './minimax-constraints.js';
import {isDeepStrictEqual} from 'node:util';
import type {BindingSpec, BindingJson} from '../contracts/provider-binding.js';
import {parseBindingSpec, canonicalBindingJson} from '../contracts/provider-binding-validation.js';
import {fields, parseId} from '../contracts/story-draft-validation.js';
import {getDeployment} from '../contracts/video-deployments.js';

export const MINIMAX_CAPABILITY_VERSION = 'minimax-video-v2.2026-09-13';
export const MINIMAX_ADAPTER_VERSION = 'minimax-v2-request.1';
export const minimaxEndpoints = {
  cn: {profileId: 'minimax-cn-v2', origin: 'https://api.minimax.cn', documentation: 'https://platform.minimax.cn/docs/api-reference/video-generation-v2-create'},
  international: {profileId: 'minimax-international-v2', origin: 'https://api.minimax.io', documentation: 'https://platform.minimax.io/docs/api-reference/video-generation-v2-create'},
} as const;
/** Document evidence plus actual implemented subset, never invented account verification. */
export function miniMaxCapabilities(modelId: string, region: MiniMaxRegion): BindingSpec['capabilities'] {
  if (!Object.hasOwn(miniMaxModelLimits, modelId)) throw Error('INVALID_MINIMAX_GENERATION');
  const limits = miniMaxModelLimits[modelId as keyof typeof miniMaxModelLimits];
  return canonicalBindingJson({
    schemaVersion: 1, policyId: MINIMAX_CAPABILITY_VERSION, modelId, mode: 'job',
    documented: {
      source: minimaxEndpoints[region].documentation, checkedAt: '2026-09-13',
      duration: {min: limits.minSeconds, max: limits.maxSeconds}, resolutions: [...limits.resolutions],
      textRatios: [...miniMaxRatios], imageRatio: 'adaptive', referenceInput: limits.documentedReferences,
      image: {minDimension: 256, maxDimension: 5760, minAspect: 0.4, maxAspect: 2.5,
        maxBytes: '30000000', roles: ['first_frame', 'last_frame'], perRole: 1},
    },
    implemented: {requestVersion: MINIMAX_ADAPTER_VERSION, inputModes: ['text-to-video', 'image-to-video'],
      referenceInput: false, mediaTransport: false, durableDispatch: false},
    verified: {status: 'unknown'},
  }) as BindingSpec['capabilities'];
}
export function validateMiniMaxBinding(input: unknown): BindingSpec {
  const spec = parseBindingSpec(input), p = spec.parameters;
  const region = miniMaxRegion(p.region), deployment = getDeployment(spec.providerId, p.catalogId);
  if (spec.providerId !== 'minimax' || spec.mode !== 'job' || spec.modelId !== deployment.endpoint ||
    p.endpointProfileId !== minimaxEndpoints[region].profileId || p.protocolVersion !== 'v2' ||
    spec.adapterVersion !== MINIMAX_ADAPTER_VERSION || spec.capabilityVersion !== MINIMAX_CAPABILITY_VERSION ||
    !isDeepStrictEqual(spec.capabilities, miniMaxCapabilities(spec.modelId, region))) throw Error('INVALID_MINIMAX_BINDING');
  validateMiniMaxGeneration(spec.modelId, p.operationKind, p.generation);
  return spec;
}
export type VideoInputCompatibility = {compatible: true; requiresImageTransport: boolean; accountVerification: 'unknown'; canDispatch: false};
/** Metadata compatibility only. Not a file-byte check, transport lease, price quote or dispatch grant. */
export function checkVideoCompatibility(binding: unknown, rawInput: unknown): VideoInputCompatibility {
  try {
    const spec = validateMiniMaxBinding(binding), input: BindingJson = canonicalBindingJson(rawInput);
    fields(input, ['prompt', 'images']);
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 7000 || !Array.isArray(input.images)) throw Error();
    const images = input.images;
    if (spec.parameters.operationKind === 'text-to-video' ? images.length !== 0 : images.length < 1 || images.length > 2) throw Error();
    const roles = new Set<string>();
    for (const image of images) {
      fields(image, ['assetId', 'role', 'mimeType', 'width', 'height', 'byteSize']);
      parseId(image.assetId);
      if (typeof image.role !== 'string' || !['first_frame', 'last_frame'].includes(image.role) || roles.has(image.role) ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(image.mimeType as string)) throw Error();
      roles.add(image.role);
      const w = image.width, h = image.height;
      if (typeof w !== 'number' || typeof h !== 'number' || !Number.isInteger(w) || !Number.isInteger(h) ||
        w < 256 || w > 5760 || h < 256 || h > 5760 || w / h < 0.4 || w / h > 2.5 ||
        typeof image.byteSize !== 'string' || !/^[1-9][0-9]{0,7}$/.test(image.byteSize) || BigInt(image.byteSize) > 30000000n) throw Error();
    }
    return {compatible: true, requiresImageTransport: images.length > 0, accountVerification: 'unknown', canDispatch: false};
  } catch { throw Error('VIDEO_INPUT_INCOMPATIBLE'); }
}
