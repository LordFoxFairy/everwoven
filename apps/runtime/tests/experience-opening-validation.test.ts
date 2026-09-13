import {describe, expect, it} from 'vitest';
import {v7} from 'uuid';
import {parseCreateExperience, parseBudget} from '../src/contracts/experience-opening-validation.js';
import {parseBindingSpec, canonicalBindingJson} from '../src/contracts/provider-binding-validation.js';

import {binding} from './fixtures/provider-binding.js';
describe('opening command boundary', () => {
  it.each(['0', '1', '1000000', '9223372036854775807'])('preserves exact budget %s', limitMicros => {
    expect(parseBudget({limitMicros, currency: 'USD'})).toEqual({limitMicros, currency: 'USD'});
  });
  it.each(['-1', '01', '1.0', '1e6', ' 1', '', '9223372036854775808', 1, null, undefined])(
    'rejects noncanonical or overflow budget %s', limitMicros => {
      expect(() => parseBudget({limitMicros, currency: 'USD'})).toThrow('INVALID_EXPERIENCE_COMMAND');
    },
  );
  it('rejects implicit currency conversion and extra budget fields', () => {
    for (const value of [{limitMicros: '1', currency: 'usd'}, {limitMicros: '1', currency: 'EUR'}, {limitMicros: '1', currency: 'CNY', rate: 1}])
      expect(() => parseBudget(value)).toThrow('INVALID_EXPERIENCE_COMMAND');
  });
  it('canonical command ignores key order but never accepts client owner/key/url', () => {
    const value = {protocolVersion: 1, datasetId: v7(), commandId: v7(), storyDraftId: v7(), expectedStoryRevision: 1, bindingKey: 'video-primary', expectedBindingVersion: 1, budget: {limitMicros: '0', currency: 'CNY'}};
    expect(parseCreateExperience(value)).toEqual(value);
    for (const extra of ['ownerId', 'apiKey', 'baseUrl'])
      expect(() => parseCreateExperience({...value, [extra]: 'x'})).toThrow('INVALID_EXPERIENCE_COMMAND');
    expect(() => parseCreateExperience({...value, expectedStoryRevision: 0})).toThrow();
    expect(() => parseCreateExperience({...value, protocolVersion: 0})).toThrow('CLIENT_RELOAD_REQUIRED');
  });
});
describe('trusted binding is still strictly decoded', () => {
  it('normalizes nested JSON key order without changing arrays or exact remote model', () => {
    const a = binding(), b = structuredClone(a);
    b.parameters.generation = {aspectRatio: '16:9', resolution: '768P', duration: 5};
    expect(JSON.stringify(parseBindingSpec(a))).toBe(JSON.stringify(parseBindingSpec(b)));
    expect(parseBindingSpec(a).modelId).toBe('MiniMax-H3-Max');
  });
  it('requires explicit identity and a versioned bounded capability snapshot', () => {
    const a = binding();
    for (const bad of [
      {...a, ownerId: 'no'}, {...a, versionNo: 0}, {...a, modelId: ''},
      {...a, parameters: {...a.parameters, baseUrl: 'https://other.invalid'}},
      {...a, capabilities: {}}, {...a, capabilities: {schemaVersion: 1, cost: Infinity}},
      {...a, capabilities: {schemaVersion: 1, huge: 'x'.repeat(70000)}},
      {...a, parameters: {...a.parameters, generation: {x: undefined}}},
    ]) expect(() => parseBindingSpec(bad)).toThrow('INVALID_PROVIDER_BINDING');
  });
  it('rejects accessors and symbol/hidden state without evaluating them', () => {
    let reads = 0;
    const array = [1]; Object.defineProperty(array, '0', {get() { reads++; return 1; }, enumerable: true});
    expect(() => canonicalBindingJson(array)).toThrow('INVALID_PROVIDER_BINDING');
    const hidden = [1]; Object.defineProperty(hidden, Symbol('private'), {value: 1});
    expect(() => canonicalBindingJson(hidden)).toThrow('INVALID_PROVIDER_BINDING');
    const spec = binding(); Object.defineProperty(spec, 'modelId', {get() { reads++; return 'MiniMax-H3-Max'; }, enumerable: true});
    expect(() => parseBindingSpec(spec)).toThrow('INVALID_PROVIDER_BINDING');
    expect(reads).toBe(0);
  });
});
