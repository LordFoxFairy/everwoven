import {isDeepStrictEqual} from 'node:util';
import type {BindingSpec} from '../contracts/provider-binding.js';
import {canonicalBindingJson, parseBindingSpec} from '../contracts/provider-binding-validation.js';
import {POLLO_MODEL, polloRegion, polloRatios, validatePolloGeneration} from './pollo-constraints.js';
export {POLLO_MODEL, polloRegion, validatePolloGeneration} from './pollo-constraints.js';

/** Internal platform protocol used by general_agent. This is not Pollo's public v1 API. */
export const POLLO_ADAPTER_VERSION = 'pollo-platform.1';
export const POLLO_CAPABILITY_VERSION = 'pollo-h3-max.2026-09-14';
export const polloEndpoints = {
 test: {profileId: 'pollo-test-platform', base: 'https://test123.pollo.ai/api/platform'},
 production: {profileId: 'pollo-production-platform', base: 'https://pollo.ai/api/platform'},
} as const;
export function polloCapabilities(): BindingSpec['capabilities'] {
 return canonicalBindingJson({schemaVersion: 1, policyId: POLLO_CAPABILITY_VERSION, modelId: POLLO_MODEL, mode: 'job',
  documented: {source: 'minimax-h3-max-request-schema-handoff', checkedAt: '2026-09-14', duration: {min: 5, max: 15}, resolutions: ['480P', '768P']},
  implemented: {requestVersion: POLLO_ADAPTER_VERSION, inputModes: ['text-to-video'], ratios: polloRatios, outputs: 1, automaticPaidRetry: false},
  verified: {status: 'unknown'},
 }) as BindingSpec['capabilities'];
}
export function validatePolloBinding(input: unknown): BindingSpec {
 const spec = parseBindingSpec(input), p = spec.parameters, region = polloRegion(p.region);
 if (spec.providerId !== 'pollo' || spec.modelId !== POLLO_MODEL || spec.mode !== 'job' ||
  p.catalogId !== 'minimax-h3-max' || p.protocolVersion !== 'platform' || p.endpointProfileId !== polloEndpoints[region].profileId ||
  spec.adapterVersion !== POLLO_ADAPTER_VERSION || spec.capabilityVersion !== POLLO_CAPABILITY_VERSION ||
  !isDeepStrictEqual(spec.capabilities, polloCapabilities())) throw Error('INVALID_POLLO_BINDING');
 validatePolloGeneration(spec.modelId, p.operationKind, p.generation);
 return spec;
}
